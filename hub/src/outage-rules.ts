/**
 * Notbetrieb der Regeln (rules.ts): wann er gilt, welche Termine des Plans
 * der Hub dann ausfuehrt, welche Aktion er dabei selbst schalten darf und
 * wie der Lauf an die Cloud geht. Reine Logik, ohne Netz und ohne Platte.
 *
 * Kontakt zur Cloud ist jeder gelungene Aufruf (config.ts, `api`), nicht nur
 * das Lebenszeichen. Der Notbetrieb beginnt erst, wenn so lange keiner
 * gelang (Karenz, 180 s), damit ein Ruckler nichts ausloest.
 *
 * Termine: Beim Eintritt in den Notbetrieb zaehlen auch die Termine, die seit
 * dem letzten Kontakt faellig wurden, also in der Karenz (`dueInOutage`).
 * Bis zum Ende ihrer Nachholfrist (laut Plan, sonst 6 Minuten) holt der Hub
 * sie nach. Was er ausgefuehrt hat, merkt er sich in hub/.cache, damit ein
 * Neustart keinen Termin ein zweites Mal ausfuehrt.
 *
 * Termine kurz vor dem letzten Kontakt (bis 6 Minuten) holt er ebenfalls
 * nach, aber nur in sicherer Richtung: Aus an Licht, Schaltern und Hue, Zu am
 * Rolltor (`outageDue`, „before-contact“). Fuer sie war die Cloud zustaendig,
 * doch sie schaltet erst mit ihrem naechsten Cron-Lauf; faellt das Netz am
 * Standort dazwischen aus, erreicht sie die Geraete nicht mehr, und ein „zu“
 * am Rolltor ginge verloren. Ein zweites Aus oder Zu schadet nicht. Ein und
 * Kamera-Szenen aus diesem Fenster laesst der Hub aus: Die Cloud kann sie
 * schon geschaltet haben, und seither kann jemand von Hand umgeschaltet haben.
 *
 * Mehrere Termine in einem Takt fuehrt der Hub der Zeit nach aus, aeltester
 * zuerst (`dueOutageTerms`): Schalten zwei Regeln dasselbe Geraet, gilt am
 * Ende der juengere Termin, gleich wie die Regeln im Plan stehen. Aus
 * demselben Grund holt er ein Aus oder Zu von kurz vor dem letzten Kontakt
 * nicht nach und wiederholt keines, wenn der Plan dasselbe Geraet danach und
 * bis jetzt noch einmal schaltet (`laterTermDevices`, `SKIP_SUPERSEDED`):
 * Sonst stuende das Licht nach „aus 22:00“ und „an 22:05“ am Ende aus.
 *
 * Im Notbetrieb oeffnet der Hub nie etwas. Was er schaltet, steht in einer
 * Erlaubnisliste (`outageActionStep`): Ein und Aus an Licht, Schaltern und
 * Hue, Kamera-Szenen und „zu“ am Rolltor. Das alles laesst sich wiederholen,
 * ohne etwas zu aendern, auch wenn die Cloud einen Termin aus der Karenz
 * schon geschaltet hat (nur der Weg vom Hub zur Cloud gestoert). Tueroeffner,
 * Drehkreuze, Taster und Shellys ohne Kategorie schaltet er gar nicht, weder
 * zu einem Termin noch auf ein Ereignis hin; sie stehen als gescheitert im
 * Lauf, und die Cloud holt sie nach ihrer Rueckkehr in der Frist nach oder
 * meldet den Termin.
 *
 * Rolltore: Nur „zu“ einer Zeit-Regel, mit derselben Verriegelung wie die
 * Cloud (cover-rules.ts) und nur bei Status-Antwort im LAN; Auf und Stopp
 * bleiben der Cloud vorbehalten. Schalter HUB_EMERGENCY_COVER_CLOSE.
 *
 * Scheitert ein Aus oder Zu eines Termins im LAN, versucht der Hub genau diese
 * Aktionen in der Nachholfrist noch einmal (`nextOutageRetry`): hoechstens
 * drei Versuche, mindestens eine Minute auseinander. Was gelang, laeuft nicht
 * noch einmal; Ein und Kamera-Szenen wiederholt er nie, und ein Geraet, das
 * inzwischen ein spaeterer Termin geschaltet hat, auch nicht
 * (`outageRetryStep`).
 */

/** Ohne gelungenen Aufruf an die Cloud so lange: Notbetrieb. */
export const OUTAGE_AFTER_MS = 180_000;

/**
 * Nachholfrist, wenn der Plan keine nennt (aeltere Cloud): so lange, wie die
 * Cloud mindestens nachholt (Takt 5 Minuten plus Verzug). Ein Termin direkt
 * nach dem letzten Kontakt ist zu Beginn des Notbetriebs gut 3 Minuten alt.
 */
export const OUTAGE_DEFAULT_CATCH_UP_MS = 6 * 60_000;

/** Merker fuer ausgefuehrte Termine so lange behalten (Plan und Nachholfrist sind kuerzer). */
export const FIRED_KEEP_MS = 24 * 3_600_000;

/**
 * Termine bis so lange vor dem letzten Kontakt holt der Hub im Notbetrieb nur
 * in sicherer Richtung nach (siehe oben): so lange, wie die Cloud fuer ihren
 * ersten Versuch braucht (Takt 5 Minuten plus Verzug).
 */
export const OUTAGE_CONTACT_GAP_MS = 6 * 60_000;

/** Notbetrieb? `lastContact` null: seit dem Start kein Kontakt, die Karenz laeuft ab dem Start. */
export function outageActive(lastContact: number | null, startedAt: number, now: number, afterMs = OUTAGE_AFTER_MS): boolean {
  const last = lastContact ?? startedAt;
  return now - last > afterMs;
}

/** Wo ein Termin im Notbetrieb liegt: nach dem letzten Kontakt oder kurz davor (nur Aus und Zu). */
export type OutageWindow = "after-contact" | "before-contact";

/**
 * Termin `fireAt` im Notbetrieb jetzt ausfuehren, und in welchem Fenster?
 * Ja, wenn er erreicht ist, seine Nachholfrist `until` noch laeuft, der Hub
 * ihn noch nicht ausgefuehrt hat (`fired`) und er nach dem letzten Kontakt
 * zur Cloud faellig wurde (`lastContact`, ohne Kontakt seit dem Start der
 * Start des Hubs): „after-contact“. Lag er bis `OUTAGE_CONTACT_GAP_MS` davor,
 * war die Cloud zustaendig; der Hub holt ihn dann nur in sicherer Richtung
 * nach: „before-contact“. Sonst null.
 */
export function outageDue(
  fireAt: number,
  lastContact: number,
  now: number,
  fired: boolean,
  until?: number | null,
): OutageWindow | null {
  if (fired || !Number.isFinite(fireAt)) return null;
  if (fireAt <= lastContact - OUTAGE_CONTACT_GAP_MS || fireAt > now) return null;
  if (now >= outageWindowEnd(fireAt, until)) return null;
  return fireAt > lastContact ? "after-contact" : "before-contact";
}

/** Ende der Nachholfrist eines Termins im Notbetrieb: laut Plan, sonst `OUTAGE_DEFAULT_CATCH_UP_MS`. */
export function outageWindowEnd(fireAt: number, until?: number | null): number {
  return until != null && Number.isFinite(until) && until > fireAt ? until : fireAt + OUTAGE_DEFAULT_CATCH_UP_MS;
}

/** Termin im Notbetrieb jetzt ausfuehren, in einem der beiden Fenster (`outageDue`)? */
export function dueInOutage(
  fireAt: number,
  lastContact: number,
  now: number,
  fired: boolean,
  until?: number | null,
): boolean {
  return outageDue(fireAt, lastContact, now, fired, until) !== null;
}

/** Schluessel eines Termins im Merker. */
export function firedKey(ruleId: number, fireAt: string): string {
  return `${ruleId}@${fireAt}`;
}

/* --------------------------------------------------------- Merker (.cache) */

export interface OutageStore {
  /** Letzter gelungener Aufruf an die Cloud (ms), auch aus einem frueheren Lauf des Hubs. */
  lastContactAt: number | null;
  /** Ausgefuehrte Termine: Schluessel (`firedKey`) -> Termin (ms). */
  fired: Record<string, number>;
}

/** Gespeicherten Stand lesen; Unbrauchbares ergibt einen leeren Stand. */
export function parseOutageStore(raw: unknown): OutageStore {
  const out: OutageStore = { lastContactAt: null, fired: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as { lastContactAt?: unknown; fired?: unknown };
  if (typeof r.lastContactAt === "number" && Number.isFinite(r.lastContactAt) && r.lastContactAt > 0) {
    out.lastContactAt = r.lastContactAt;
  }
  if (r.fired && typeof r.fired === "object" && !Array.isArray(r.fired)) {
    for (const [key, at] of Object.entries(r.fired as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at) && /^\d+@/.test(key)) out.fired[key] = at;
    }
  }
  return out;
}

/** Merker ohne Termine, die aelter als `FIRED_KEEP_MS` sind. */
export function pruneFired(fired: Record<string, number>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, at] of Object.entries(fired)) if (now - at <= FIRED_KEEP_MS) out[key] = at;
  return out;
}

/* ------------------------------------------------- Aktionen im Notbetrieb */

/** Aktion aus dem Plan, so weit die Entscheidung sie braucht. */
export interface OutagePlanAction {
  kind: string;
  deviceId: number | null;
  deviceAction: string | null;
  targetCameraId?: number | null;
}

/** Geraet aus den Raumdaten der Cloud (rooms.ts), so weit die Entscheidung es braucht. */
export interface OutageDevice {
  type: string;
  category: string | null;
  ipAddress: string | null;
  hueBridgeId?: string | null;
  hueLightId?: string | null;
}

export interface OutageContext {
  /** Zeit-Regel mit Termin aus dem Plan; fehlt oder false: Ereignis (Bewegung, Klingel, Schaltvorgang, Ruhe). */
  timed?: boolean;
  /** Rolltore im Notbetrieb schliessen (HUB_EMERGENCY_COVER_CLOSE). */
  coverClose?: boolean;
  /**
   * Der Termin lag kurz vor dem letzten Kontakt (`outageDue`,
   * „before-contact“): nur Aus an Licht, Schaltern und Hue und Zu am Rolltor.
   */
  beforeContact?: boolean;
  /**
   * Geraete, die der Plan nach diesem Termin und bis jetzt noch einmal
   * schaltet (`laterTermDevices`): Dort entfaellt das Nachholen kurz vor dem
   * letzten Kontakt und jede Wiederholung (`SKIP_SUPERSEDED`).
   */
  laterTerm?: ReadonlySet<number>;
}

export type OutageStep =
  /** Kamera-Szene (cameras.ts, `cameraScene`). */
  | { run: "camera" }
  /** Licht, Schalter oder Hue ein- oder ausschalten im LAN (rooms.ts, `deviceAction` mit `localOnly`). */
  | { run: "device" }
  /** Rolltor zufahren im LAN mit Verriegelung (rooms.ts, `closeCoverLocal`). */
  | { run: "cover-close" }
  /** Nicht selbst ausfuehren; steht als gescheiterte Aktion im Lauf. */
  | { skip: string };

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
/** Shellys, die der Hub im Notbetrieb schalten darf: Licht und Schalter. */
const LATCHING = new Set(["SCHALTER", "BELEUCHTUNG"]);
const COVER = new Set(["MARKISE", "ROLLTOR"]);
/**
 * Befehle an Licht, Schalter und Hue (rooms.ts, `deviceAction`): open und
 * emergency schalten ein, deactivate und reset aus. Alles andere nicht.
 */
const SWITCH_ACTIONS = new Set(["open", "emergency", "deactivate", "reset"]);
/** Davon die, die ausschalten: sichere Richtung, ein zweites Mal schadet nicht. */
const OFF_ACTIONS = new Set(["deactivate", "reset"]);

export const SKIP_NEEDS_CLOUD = "Im Notbetrieb nicht möglich (braucht die Cloud)";
export const SKIP_CLOUD_ONLY = "Nur über die Cloud schaltbar";
export const SKIP_EVENT_LATCHING_ONLY =
  "Bei Ereignissen schaltet der Hub im Notbetrieb nur Licht und Schalter, keine Türen, Tore oder Drehkreuze";
export const SKIP_NEVER_OPENS =
  "Im Notbetrieb öffnet der Hub nichts: Türöffner, Drehkreuze, Taster und Shellys ohne Kategorie schaltet nur die Cloud";
export const SKIP_BEFORE_CONTACT =
  "Nicht nachgeholt: Termin lag vor dem letzten Kontakt, die Cloud kann ihn schon geschaltet haben; der Hub holt dafür nur Aus und Zu nach";
export const SKIP_SUPERSEDED = "Entfällt: Ein späterer Termin im Plan schaltet dasselbe Gerät";

function isHue(d: OutageDevice): boolean {
  return d.type === "HUE_LIGHT" && !!d.hueBridgeId && !!d.hueLightId;
}

/** Wie rooms.ts `isLocalDevice`: Hue ueber die Bridge, Shellys mit IP ausser Antrieben. */
function isLocalSwitch(d: OutageDevice): boolean {
  if (isHue(d)) return true;
  return d.type === "SHELLY" && !!d.ipAddress && IPV4_RE.test(d.ipAddress) && !COVER.has(d.category ?? "");
}

/** Rolltor an einem Shelly mit IP: Der Hub darf es im Notbetrieb zufahren. */
function isLocalGate(d: OutageDevice): boolean {
  return d.type === "SHELLY" && d.category === "ROLLTOR" && !!d.ipAddress && IPV4_RE.test(d.ipAddress);
}

/**
 * Darf der Hub diese Plan-Aktion im Notbetrieb selbst ausfuehren? Eine
 * Erlaubnisliste, im Zweifel nein: Dann steht die Aktion als gescheitert im
 * Lauf, und die Cloud holt sie nach ihrer Rueckkehr nach oder meldet den
 * Termin. Der Hub oeffnet im Notbetrieb nie etwas.
 *
 *  - Kamera-Szene: ja (die Kamera haengt im LAN).
 *  - Benachrichtigung, Audio und alles andere: nein, das braucht die Cloud.
 *  - Hue und Shellys der Kategorie Schalter oder Beleuchtung mit IP: Ein und
 *    Aus (`SWITCH_ACTIONS`), zu einem Termin wie auf ein Ereignis hin. Zu,
 *    Stopp und unbekannte Befehle nur ueber die Cloud.
 *  - Tueroeffner, Drehkreuze, Taster, Shellys ohne Kategorie und andere
 *    Shellys: nie, mit keinem Befehl. Ihr Einschalten ist ein Impuls, der
 *    etwas oeffnet oder umkehrt (ein zweiter Torimpuls faehrt das Tor
 *    zurueck); was ein Ausschalten dort bewirkt, haengt an der Verdrahtung,
 *    die der Hub nicht kennt.
 *  - Rolltor mit IP: nur „zu“ und nur bei einer Zeit-Regel, wenn
 *    `coverClose` an ist. Zu ist wiederholbar, auch bei einem Termin aus
 *    der Karenz. Auf und Stopp nie.
 *  - Markise, Schloesser, Ventile, Pis: nein.
 *  - Termin kurz vor dem letzten Kontakt (`beforeContact`): davon nur Aus
 *    und Zu; Ein und Kamera-Szene nicht (`SKIP_BEFORE_CONTACT`).
 *  - Schaltet ein spaeterer Termin dasselbe Geraet (`laterTerm`): nicht
 *    (`SKIP_SUPERSEDED`).
 */
export function outageActionStep(action: OutagePlanAction, device: OutageDevice | null, ctx: OutageContext): OutageStep {
  if (action.kind === "CAMERA") {
    if (!action.targetCameraId) return { skip: "Kamera fehlt" };
    return ctx.beforeContact ? { skip: SKIP_BEFORE_CONTACT } : { run: "camera" };
  }
  if (action.kind !== "DEVICE") return { skip: SKIP_NEEDS_CLOUD };
  if (!action.deviceId || !action.deviceAction) return { skip: "Gerät oder Aktion fehlt" };
  if (!device) return { skip: "Gerät unbekannt – Räume neu laden" };
  const act = action.deviceAction;
  const superseded = ctx.laterTerm?.has(action.deviceId) ?? false;
  if (isLocalGate(device)) {
    if (act !== "close" || !ctx.timed || !ctx.coverClose) return { skip: SKIP_CLOUD_ONLY };
    return superseded ? { skip: SKIP_SUPERSEDED } : { run: "cover-close" };
  }
  if (!isLocalSwitch(device) || !SWITCH_ACTIONS.has(act)) return { skip: SKIP_CLOUD_ONLY };
  if (!isHue(device) && !LATCHING.has(device.category ?? "")) return { skip: ctx.timed ? SKIP_NEVER_OPENS : SKIP_EVENT_LATCHING_ONLY };
  if (ctx.beforeContact && !OFF_ACTIONS.has(act)) return { skip: SKIP_BEFORE_CONTACT };
  if (superseded) return { skip: SKIP_SUPERSEDED };
  return { run: "device" };
}

/* --------------------------------------------------------- Termine im Takt */

/** Regel aus dem Plan, so weit die Termine im Notbetrieb sie brauchen. */
export interface OutagePlanRule {
  id: number;
  fireAt: string[];
  /** Ende der Nachholfrist je Termin (gleiche Reihenfolge); fehlt bei aelterer Cloud. */
  fireUntil?: string[];
  actions: Array<OutagePlanAction & { id: number; key?: string }>;
}

/**
 * Geraete, die der Plan nach dem Termin `fireAt` und bis `now` noch einmal
 * schaltet, gleich in welcher Regel und mit welchem Befehl: Fuer sie gilt
 * der spaetere Termin (`OutageContext.laterTerm`).
 */
export function laterTermDevices(rules: OutagePlanRule[], fireAt: number, now: number): Set<number> {
  const out = new Set<number>();
  for (const rule of rules) {
    const later = rule.fireAt.some((at) => {
      const t = Date.parse(at);
      return t > fireAt && t <= now;
    });
    if (!later) continue;
    for (const a of rule.actions) if (a.kind === "DEVICE" && a.deviceId) out.add(a.deviceId);
  }
  return out;
}

/** Termin, den der Hub in diesem Takt im Notbetrieb ausfuehrt (`dueOutageTerms`). */
export interface OutageTerm<R extends OutagePlanRule> {
  rule: R;
  /** Termin laut Plan, wie die Cloud ihn schreibt. */
  at: string;
  /** Schluessel im Merker (`firedKey`). */
  key: string;
  /** Termin (ms). */
  fireAt: number;
  /** Ende der Nachholfrist (ms, `outageWindowEnd`). */
  until: number;
  ctx: OutageContext;
}

/**
 * Termine, die der Hub in diesem Takt im Notbetrieb ausfuehrt, aeltester
 * zuerst (bei gleichem Termin in der Reihenfolge des Plans). Faellig laut
 * `outageDue`; ein Termin kurz vor dem letzten Kontakt nur, wenn danach ein
 * Aus oder Zu zu schalten bleibt, das kein spaeterer Termin ueberholt hat,
 * sonst gibt es keinen Lauf.
 */
export function dueOutageTerms<R extends OutagePlanRule>(
  rules: R[],
  opts: {
    lastContact: number;
    now: number;
    fired: Readonly<Record<string, number>>;
    coverClose: boolean;
    device: (id: number) => OutageDevice | null;
  },
): Array<OutageTerm<R>> {
  const out: Array<OutageTerm<R>> = [];
  for (const rule of rules) {
    rule.fireAt.forEach((at, i) => {
      const t = Date.parse(at);
      const end = rule.fireUntil?.[i] ? Date.parse(rule.fireUntil[i]) : null;
      const key = firedKey(rule.id, at);
      const window = outageDue(t, opts.lastContact, opts.now, key in opts.fired, end);
      if (!window) return;
      const beforeContact = window === "before-contact";
      const ctx: OutageContext = {
        timed: true,
        coverClose: opts.coverClose,
        beforeContact,
        ...(beforeContact ? { laterTerm: laterTermDevices(rules, t, opts.now) } : {}),
      };
      const device = (a: OutagePlanAction) => (a.deviceId ? opts.device(a.deviceId) : null);
      if (beforeContact && !rule.actions.some((a) => "run" in outageActionStep(a, device(a), ctx))) return;
      out.push({ rule, at, key, fireAt: t, until: outageWindowEnd(t, end), ctx });
    });
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

/* ------------------------------------------------------ Lauf fuer die Cloud */

/** Ergebnis einer Aktion im Lauf (`RoomRuleRun.details`). */
export interface RunDetail {
  actionId: number;
  /** Schluessel der Aktion laut Plan (src/lib/rule-due.ts, `actionKeys`); fehlt bei aelterer Cloud. */
  key?: string;
  kind: string;
  target: string;
  ok: boolean;
  error?: string;
  /** Dauer der Aktion (ms). */
  ms?: number;
}

/** Lauf, wie ihn der Hub an die Cloud meldet (`POST /api/hub/rules`). */
export interface HubRun {
  ruleId: number;
  /** Beginn des Laufs. */
  at: string;
  /** Zeit-Regeln: Termin laut Plan; die Cloud vermerkt ihn als gelaufen, wenn der Lauf gelang. */
  fireAt?: string;
  /** Zeit des ausloesenden Ereignisses (Kamera); bei Zeit-Regeln der Termin. */
  eventAt?: string;
  /** Ende des Laufs. */
  finishedAt?: string;
  triggerKind: string;
  success: boolean;
  details: RunDetail[];
  errorMessage: string | null;
  /**
   * Bewegung direkt vom Hub, nicht in der Frist oder nicht ganz gelungen: Die
   * Cloud fuehrt die Regel aus, der Lauf zaehlt nicht fuer ihre Abklingzeit.
   */
  handedOver?: true;
}

/** So viele ausstehende Termine nennt das Lebenszeichen hoechstens (die juengsten). */
export const ANNOUNCED_FIRES_MAX = 100;

/**
 * Termine, die der Hub im Notbetrieb ausgefuehrt und der Cloud noch nicht
 * gemeldet hat, fuer das Lebenszeichen: Bis sein Lauf eintrifft, holt die
 * Cloud dort nichts nach, was der Hub selbst schaltet
 * (src/lib/rule-due.ts, `hubRunAnnounced`). Nur Zeit-Regeln (mit Termin),
 * juengste zuerst.
 */
export function announcedFires(pending: Array<Pick<HubRun, "ruleId" | "fireAt">>): Array<{ ruleId: number; fireAt: string }> {
  const out = new Map<string, { ruleId: number; fireAt: string }>();
  for (const r of pending) {
    if (!r.fireAt || !Number.isFinite(Date.parse(r.fireAt))) continue;
    out.set(`${r.ruleId}@${r.fireAt}`, { ruleId: r.ruleId, fireAt: r.fireAt });
  }
  return [...out.values()].sort((a, b) => Date.parse(b.fireAt) - Date.parse(a.fireAt)).slice(0, ANNOUNCED_FIRES_MAX);
}

/**
 * Lauf aus den Ergebnissen seiner Aktionen. Erfolg nur, wenn es Aktionen gab
 * und jede gelang: Ein gescheiterter Lauf erledigt in der Cloud keinen
 * Termin, sie holt die gescheiterten Aktionen nach (src/lib/rule-due.ts,
 * `summarizeAttempts`).
 *
 * Eine Wiederholung (`retry`) enthaelt nur die Aktionen, die sie noch einmal
 * schaltet. Erfolg ist sie erst, wenn dem Termin ueber alle Laeufe des Hubs
 * keine Aktion mehr fehlt: Fehlt noch eine, die sie nicht schaltet (etwa eine
 * Benachrichtigung, die die Cloud braucht), ist sie kein Erfolg. Eine aeltere
 * Cloud vermerkt den Termin schon wegen eines erfolgreichen Laufs und holte
 * das Fehlende sonst nie nach.
 */
export function hubRunRecord(input: {
  ruleId: number;
  triggerKind: string;
  startedAt: number;
  finishedAt?: number;
  fireAt?: string;
  eventAt?: string;
  details: RunDetail[];
  /** Wiederholung: Aktionen dieses Laufs und die, die dem Termin bisher fehlten (`OutageRetry.missing`). */
  retry?: { only: ReadonlySet<string>; missing: readonly string[] };
}): HubRun {
  const { retry } = input;
  const open = retry ? retry.missing.filter((k) => !retry.only.has(k)).length : 0;
  const success = input.details.length > 0 && input.details.every((d) => d.ok) && open === 0;
  const failed = input.details.filter((d) => !d.ok);
  const errors = failed.map((d) => `${d.target}: ${d.error ?? "fehlgeschlagen"}`);
  if (open > 0) errors.push(`Noch offen aus diesem Termin: ${open} ${open === 1 ? "Aktion" : "Aktionen"}`);
  return {
    ruleId: input.ruleId,
    at: new Date(input.startedAt).toISOString(),
    ...(input.fireAt ? { fireAt: input.fireAt } : {}),
    ...(input.eventAt ?? input.fireAt ? { eventAt: input.eventAt ?? input.fireAt } : {}),
    ...(input.finishedAt != null ? { finishedAt: new Date(input.finishedAt).toISOString() } : {}),
    triggerKind: input.triggerKind,
    success,
    details: input.details,
    errorMessage: errors.length ? errors.join("; ") : null,
  };
}

/**
 * Bewegung im Notbetrieb, fuer die Meldung des Ereignisses (`hubRules`):
 * Kommt sie doch an die Cloud (sie ist gerade zurueck), laesst die Cloud die
 * Regel aus, wenn der Hub jede Aktion geschaltet hat und die Regel laut Plan
 * selbst ausfuehren darf (`hubConfigAt`, wie bei Bewegung direkt vom Hub;
 * src/lib/room-rules.ts, `fireMotionRules`). Sonst null: Die Cloud fuehrt sie
 * aus, wie bisher.
 */
export function outageMotionReport(
  rule: { id: number; hubConfigAt?: string },
  run: Pick<HubRun, "success">,
): { ruleId: number; configAt: string } | null {
  return run.success && rule.hubConfigAt ? { ruleId: rule.id, configAt: rule.hubConfigAt } : null;
}

/* ------------------------------------------------ Wiederholung im Notbetrieb */

/** So oft schaltet der Hub ein gescheitertes Aus oder Zu eines Termins hoechstens, der erste Versuch mitgezaehlt. */
export const OUTAGE_RETRY_ATTEMPTS = 3;

/** Mindestabstand zwischen zwei Versuchen. */
export const OUTAGE_RETRY_GAP_MS = 60_000;

/** Schluessel einer Plan-Aktion fuer die Wiederholung: `key` aus dem Plan, bei aelterer Cloud die ID. */
export function outageActionKey(action: { id: number; key?: string }): string {
  return action.key ?? String(action.id);
}

/**
 * Darf der Hub diesen Schritt nach einem Fehlschlag im LAN wiederholen? Nur
 * Aus an Licht, Schaltern und Hue und Zu am Rolltor: sichere Richtung, ein
 * zweites Mal schadet nicht. Ein und Kamera-Szenen nie: Ein Einschalten
 * spaeter als geplant kann ueberraschen, eine Szene von vorhin bringt nichts.
 */
export function retryableStep(action: OutagePlanAction, step: OutageStep): boolean {
  if (!("run" in step)) return false;
  return step.run === "cover-close" || (step.run === "device" && OFF_ACTIONS.has(action.deviceAction ?? ""));
}

/**
 * Schluessel der wiederholbaren Schritte eines Laufs, die im LAN scheiterten.
 * Uebersprungene Aktionen (`skip`) zaehlen nicht: Sie fehlen der Cloud, nicht
 * dem LAN. `stepOf` ist `outageActionStep` mit Geraet und Kontext des Termins.
 */
export function failedRetryKeys<A extends OutagePlanAction & { id: number; key?: string }>(
  actions: A[],
  details: Array<Pick<RunDetail, "actionId" | "ok">>,
  stepOf: (action: A) => OutageStep,
): string[] {
  const ok = new Map(details.map((d) => [d.actionId, d.ok]));
  return actions.filter((a) => ok.get(a.id) === false && retryableStep(a, stepOf(a))).map(outageActionKey);
}

/**
 * Aktionen eines Termins (`outageActionKey`), die ihm nach diesem Lauf ueber
 * alle Laeufe des Hubs noch fehlen: nach dem ersten Lauf (`prev` null) jede,
 * die nicht gelang, auch die uebersprungenen; nach einer Wiederholung die
 * bisher fehlenden ohne die, die jetzt gelangen.
 */
export function missingAfter(
  actions: Array<{ id: number; key?: string }>,
  prev: readonly string[] | null,
  details: Array<Pick<RunDetail, "actionId" | "ok">>,
): string[] {
  const ok = new Set(details.filter((d) => d.ok).map((d) => d.actionId));
  const done = new Set(actions.filter((a) => ok.has(a.id)).map(outageActionKey));
  return (prev ?? actions.map(outageActionKey)).filter((k) => !done.has(k));
}

/** Ein Termin, dessen Aus oder Zu der Hub im Notbetrieb noch einmal schaltet. */
export interface OutageRetry {
  /** Aktionen (`outageActionKey`), die er noch einmal schaltet. */
  keys: string[];
  /**
   * Aktionen, die dem Termin ueber alle Laeufe des Hubs noch fehlen
   * (`missingAfter`), auch die, die er nicht wiederholt: Solange eine fehlt,
   * ist eine Wiederholung kein Erfolg (`hubRunRecord`).
   */
  missing: string[];
  /** Versuche bisher, der erste Lauf mitgezaehlt. */
  attempts: number;
  /** Beginn des letzten Versuchs (ms). */
  lastAt: number;
  /** Ende der Nachholfrist (ms, `outageWindowEnd`). */
  until: number;
}

/**
 * Nach einem Versuch, der um `startedAt` begann: was der Hub noch einmal
 * schaltet. `failed`: wiederholbare Schritte dieses Versuchs, die scheiterten
 * (`failedRetryKeys`); bei einer Wiederholung zaehlen nur die, die noch
 * fehlten, und was gelang, laeuft nie ein zweites Mal. `missing`: was dem
 * Termin danach noch fehlt (`missingAfter`). null: nichts mehr zu tun, weil
 * alles gelang, die Versuche aufgebraucht sind oder kein weiterer Versuch
 * mehr in die Frist passt.
 */
export function nextOutageRetry(
  prev: OutageRetry | null,
  failed: string[],
  startedAt: number,
  until: number,
  missing: string[],
): OutageRetry | null {
  const attempts = (prev?.attempts ?? 0) + 1;
  const keys = [...new Set(prev ? prev.keys.filter((k) => failed.includes(k)) : failed)];
  if (keys.length === 0 || attempts >= OUTAGE_RETRY_ATTEMPTS) return null;
  if (startedAt + OUTAGE_RETRY_GAP_MS >= until) return null;
  return { keys, missing, attempts, lastAt: startedAt, until };
}

/** Ist der naechste Versuch jetzt dran (Abstand erreicht, Frist laeuft)? */
export function outageRetryDue(retry: OutageRetry, now: number): boolean {
  return now - retry.lastAt >= OUTAGE_RETRY_GAP_MS && now < retry.until;
}

/**
 * Vorgemerkte Wiederholungen je Termin (`firedKey`), nur im Speicher. Kehrt
 * die Cloud zurueck, leert `clear` die Liste und beginnt eine neue
 * Generation: Ein Lauf, der vorher begann und erst danach endet, merkt
 * nichts mehr vor (`note` mit der Generation von seinem Beginn). Sonst
 * stuende er wieder in der Liste, und ein spaeterer Notbetrieb wiederholte
 * einen Termin, fuer den laengst die Cloud zustaendig war.
 */
export class OutageRetries<E> {
  private readonly entries = new Map<string, E>();
  private gen = 0;

  /** Generation jetzt; ein Takt nimmt sie, bevor er schaltet. */
  get generation(): number {
    return this.gen;
  }

  /** Nach einem Lauf, der in Generation `gen` begann: vormerken (`entry`) oder austragen (null). */
  note(key: string, entry: E | null, gen: number): void {
    if (gen !== this.gen) return;
    if (entry) this.entries.set(key, entry);
    else this.entries.delete(key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Die Cloud ist zurueck: alles austragen, neue Generation. */
  clear(): void {
    this.entries.clear();
    this.gen += 1;
  }

  /** Stand jetzt, als Kopie (der Takt traegt waehrenddessen aus). */
  list(): Array<[string, E]> {
    return [...this.entries];
  }
}

/** Was aus einer vorgemerkten Wiederholung jetzt wird (`outageRetryStep`). */
export type OutageRetryStep =
  /** Noch nicht dran: Abstand nicht erreicht. */
  | { wait: true }
  /** Nichts mehr zu tun; der Grund steht im Log. */
  | { drop: string }
  /** Diese Aktionen jetzt noch einmal; `skipped`: die, die entfallen, mit Grund. */
  | { run: string[]; skipped: Array<{ key: string; reason: string }> };

/**
 * Vorgemerkte Wiederholung zum Zeitpunkt `now`: Frist vorbei oder Regel nicht
 * mehr im Plan (`actions` null) ergibt drop, Abstand nicht erreicht wait.
 * Sonst laufen die Aktionen, die noch fehlen und laut `stepOf` wiederholbar
 * sind. `stepOf` ist `outageActionStep` mit Geraet und Kontext des Termins,
 * `laterTerm` zum Zeitpunkt `now`: Hat inzwischen ein spaeterer Termin das
 * Geraet geschaltet, entfaellt die Aktion (`SKIP_SUPERSEDED`). Entfallen
 * alle, drop.
 */
export function outageRetryStep<A extends OutagePlanAction & { id: number; key?: string }>(
  retry: OutageRetry,
  actions: A[] | null,
  now: number,
  stepOf: (action: A) => OutageStep,
): OutageRetryStep {
  if (!actions) return { drop: "Regel nicht mehr im Plan" };
  if (now >= retry.until) return { drop: "Nachholfrist vorbei" };
  if (!outageRetryDue(retry, now)) return { wait: true };
  const byKey = new Map(actions.map((a) => [outageActionKey(a), a]));
  const run: string[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  for (const key of retry.keys) {
    const action = byKey.get(key);
    if (!action) {
      skipped.push({ key, reason: "Aktion nicht mehr im Plan" });
      continue;
    }
    const step = stepOf(action);
    if (retryableStep(action, step)) run.push(key);
    else skipped.push({ key, reason: "skip" in step ? step.skip : "nicht wiederholbar" });
  }
  if (run.length === 0) return { drop: [...new Set(skipped.map((s) => s.reason))].join("; ") };
  return { run, skipped };
}
