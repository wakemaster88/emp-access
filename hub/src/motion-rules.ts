/**
 * Bewegungs-Regeln, die der Hub bei laufender Cloud direkt ausfuehrt: Die
 * Cloud markiert im Plan, welche er ausfuehren darf (`hubLocal`, siehe
 * src/lib/rule-executor.ts). Der Hub schaltet sie beim Beginn eines
 * Kamera-Ereignisses selbst und nennt die gelungenen mit dem Ereignis
 * (`hubRules`); die Cloud laesst genau diese aus.
 *
 * Nie doppelt, nie gar nicht:
 *  - Aeltere Cloud: Sie markiert nichts, der Hub fuehrt nichts aus.
 *  - Aelterer Hub: Er nennt nichts, die Cloud fuehrt alles aus.
 *  - Scheitert die Ereignis-Meldung, kennt die Cloud den Beginn nicht und
 *    fuehrt dazu nichts aus: Es bleibt beim Lauf des Hubs.
 *  - Scheitert das Schalten im Hub, nennt er die Regel nicht, und die Cloud
 *    fuehrt sie aus wie bisher. Dauert der Lauf laenger als die Frist,
 *    startet der Hub keine weitere Aktion mehr (`directRunOutcome`). Was er
 *    bis dahin geschaltet hat, steht im Verlauf, als an die Cloud abgegeben;
 *    die Cloud schaltet es noch einmal (Ein, Aus, Szene: derselbe Zustand).
 *
 * Abklingzeit und Zeitraeume wie in der Cloud (gleiche Testfaelle,
 * motion-local-cases.ts). Was der Hub nicht ausfuehrt, obwohl die Regel
 * passt, merkt er als gelaufen: Die Cloud fuehrt sie dann aus, und ein
 * folgendes Ereignis faellt in ihre Abklingzeit. Reine Logik.
 */

/** Ist die Abklingzeit vorbei? Wie `claimRule` in der Cloud. */
export function cooldownFree(lastRunAt: number | null, cooldownSeconds: number, at: number): boolean {
  if (lastRunAt === null) return true;
  return lastRunAt < at - Math.max(0, cooldownSeconds) * 1000;
}

/** Liegt `at` in einem der Zeitraeume [from, to)? */
export function allowedAt(intervals: Array<{ from: string; to: string }>, at: number): boolean {
  return intervals.some((i) => {
    const from = Date.parse(i.from);
    const to = Date.parse(i.to);
    return Number.isFinite(from) && Number.isFinite(to) && at >= from && at < to;
  });
}

/** Regel aus dem Plan, so weit die Entscheidung sie braucht. */
export interface LocalPlanRule {
  id: number;
  name: string;
  trigger: string;
  eventType: string | null;
  cooldownSeconds: number;
  hubLocal?: boolean;
  hubCameraIds?: number[];
  allowedExact?: Array<{ from: string; to: string }>;
  lastRunAt?: string | null;
  hubConfigAt?: string;
  actions: Array<{ kind: string; deviceId: number | null; deviceAction: string | null; targetCameraId?: number | null }>;
}

/** Geraet aus den Raumdaten der Cloud (rooms.ts). */
export interface LocalDevice {
  type: string;
  category: string | null;
  ipAddress: string | null;
  hueBridgeId?: string | null;
  hueLightId?: string | null;
  isActive?: boolean;
}

export interface LocalMotionInput {
  cameraId: number;
  type: string;
  /** Zeit des Ereignisses (ms), dieselbe, die an die Cloud geht. */
  at: number;
  /** HUB_RULES_LOCAL_MOTION. */
  enabled: boolean;
  /** Ereignis einer Reolink-Kamera (nicht DoorBird). */
  fromCamera: boolean;
  /** Plan in diesem Lauf geholt, Regel-Version wie im letzten Lebenszeichen, noch gueltig. */
  planFresh: boolean;
  /** Letzter bekannter Lauf (ms) der Regel im Hub; null = keiner. */
  lastRun: (ruleId: number) => number | null;
  device: (deviceId: number) => LocalDevice | null;
  cameraKnown: (cameraId: number) => boolean;
}

export interface LocalMotionDecision<R extends LocalPlanRule = LocalPlanRule> {
  /** Selbst ausfuehren. */
  run: R[];
  /** Passt, aber die Cloud fuehrt sie aus (mit Grund fuer das Log). */
  declined: Array<{ rule: R; reason: string }>;
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const LOCAL_CATEGORIES = new Set(["BELEUCHTUNG", "SCHALTER"]);
const LOCAL_ACTIONS = new Set(["open", "deactivate"]);

/** Kann der Hub diese Aktion selbst schalten? null = ja, sonst der Grund. */
function actionBlocked(a: LocalPlanRule["actions"][number], input: LocalMotionInput): string | null {
  if (a.kind === "CAMERA") {
    return a.targetCameraId && input.cameraKnown(a.targetCameraId) ? null : "Kamera der Szene nicht am Hub";
  }
  if (a.kind !== "DEVICE" || !a.deviceId || !a.deviceAction || !LOCAL_ACTIONS.has(a.deviceAction)) {
    return "Aktion nur über die Cloud";
  }
  const d = input.device(a.deviceId);
  if (!d || d.isActive === false) return "Gerät unbekannt – Räume neu laden";
  if (d.type === "HUE_LIGHT") return d.hueBridgeId && d.hueLightId ? null : "Hue-Licht ohne Bridge";
  if (d.type !== "SHELLY" || !LOCAL_CATEGORIES.has(d.category ?? "")) return "Gerät nur über die Cloud";
  return d.ipAddress && IPV4_RE.test(d.ipAddress) ? null : "Shelly ohne IP im LAN";
}

/** Letzter Lauf: der juengere aus dem Hub und laut Plan. */
function lastRunOf(rule: LocalPlanRule, input: LocalMotionInput): number | null {
  const own = input.lastRun(rule.id);
  const plan = rule.lastRunAt ? Date.parse(rule.lastRunAt) : NaN;
  if (!Number.isFinite(plan)) return own;
  return own === null ? plan : Math.max(own, plan);
}

/**
 * Welche markierten Regeln passen zum Beginn dieses Ereignisses, und welche
 * davon fuehrt der Hub selbst aus? Eine Regel passt, wenn Kamera und
 * Ereignisart stimmen, die Zeit in ihren Zeitraeumen liegt und die
 * Abklingzeit vorbei ist; sonst laeuft sie auch in der Cloud nicht.
 */
export function localMotionDecision<R extends LocalPlanRule>(rules: R[], input: LocalMotionInput): LocalMotionDecision<R> {
  const out: LocalMotionDecision<R> = { run: [], declined: [] };
  for (const rule of rules) {
    if (rule.trigger !== "MOTION" || rule.hubLocal !== true) continue;
    if (rule.eventType && rule.eventType !== input.type) continue;
    if (!(rule.hubCameraIds ?? []).includes(input.cameraId)) continue;
    if (!allowedAt(rule.allowedExact ?? [], input.at)) continue;
    if (!cooldownFree(lastRunOf(rule, input), rule.cooldownSeconds, input.at)) continue;
    let reason: string | null = null;
    if (!input.enabled) reason = "abgeschaltet (HUB_RULES_LOCAL_MOTION)";
    else if (!input.fromCamera) reason = "Ereignis der DoorBird";
    else if (!input.planFresh) reason = "Plan nicht auf dem Stand der Cloud";
    else if (!rule.hubConfigAt) reason = "Plan ohne Stand der Regel";
    else if (rule.actions.length === 0) reason = "keine Aktion";
    else for (const a of rule.actions) reason ??= actionBlocked(a, input);
    if (reason) out.declined.push({ rule, reason });
    else out.run.push(rule);
  }
  return out;
}

const TYPE_LABEL: Record<string, string> = {
  PERSON: "Person",
  VEHICLE: "Fahrzeug",
  MOTION: "Bewegung",
  DOORBELL: "Klingel",
  ANIMAL: "Tier",
};

function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace(".", ",")} s`;
}

/** „Regel „Licht Hof“ vom Hub ausgeführt: Einfahrt, Person, 0,4 s vom Ereignis bis geschaltet (Lauf 0,2 s)“ */
export function directRunLine(name: string, camera: string, type: string, eventToSwitchMs: number, runMs: number): string {
  return `Regel „${name}“ vom Hub ausgeführt: ${camera}, ${TYPE_LABEL[type] ?? (type || "Ereignis")}, ${seconds(
    eventToSwitchMs,
  )} vom Ereignis bis geschaltet (Lauf ${seconds(runMs)})`;
}

/**
 * Aktionen nacheinander ausfuehren, bis `stopped` gilt (Frist abgelaufen):
 * Danach startet keine mehr, jede weitere steht als `aborted` im Lauf. Eine
 * laufende Aktion endet noch.
 */
export async function runActionsUntil<A, D>(
  actions: A[],
  stopped: () => boolean,
  run: (a: A) => Promise<D>,
  aborted: (a: A) => D,
): Promise<D[]> {
  const out: D[] = [];
  for (const a of actions) out.push(stopped() ? aborted(a) : await run(a));
  return out;
}

/** Aktion eines direkten Laufs, die nach Ablauf der Frist nicht mehr startet. */
export const DIRECT_ABORTED_ERROR = "Nicht gestartet: Frist abgelaufen, die Cloud führt die Regel aus";

export interface DirectRunOutcome {
  /** Mit dem Ereignis melden (`hubRules`): Die Cloud laesst die Regel aus. */
  report: boolean;
  /** Lauf in den Verlauf (POST /api/hub/rules). */
  record: boolean;
  /** Die Cloud fuehrt die Regel aus: Der Lauf zaehlt nicht fuer ihre Abklingzeit. */
  handedOver: boolean;
}

/**
 * Was aus einem direkten Lauf wird. Gelang jede Aktion in der Frist, meldet
 * der Hub die Regel mit dem Ereignis. Sonst fuehrt die Cloud sie aus; hat der
 * Hub bis dahin etwas geschaltet (auch noch nach der Frist), steht sein Lauf
 * im Verlauf.
 */
export function directRunOutcome(details: Array<{ ok: boolean }>, late: boolean): DirectRunOutcome {
  if (!late && details.length > 0 && details.every((d) => d.ok)) return { report: true, record: true, handedOver: false };
  return { report: false, record: details.some((d) => d.ok), handedOver: true };
}
