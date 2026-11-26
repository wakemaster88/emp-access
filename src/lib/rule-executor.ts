/**
 * Wer fuehrt eine Bewegungs-Regel aus: der Hub direkt im LAN oder die Cloud?
 *
 * Der Hub sieht das Kamera-Ereignis zuerst. Schaltet er Licht, Schalter und
 * Kamera-Szenen selbst, entfaellt der Weg ueber die Cloud. Damit das nie
 * doppelt und nie gar nicht geschieht, markiert die Cloud im Plan
 * (`buildHubRulePlan`), welche Regeln der Hub ausfuehren darf. Er meldet
 * mit dem Ereignis, welche er ausgefuehrt hat, und die Cloud laesst genau
 * diese aus (`fireMotionRules`), wenn sie die Regel jetzt ebenfalls dem Hub
 * zuschreibt.
 *
 * Der Hub darf eine Regel nur ausfuehren, wenn er sie genau so ausfuehrt wie
 * die Cloud: jede Aktion ein Shelly-Relais der Kategorie Beleuchtung oder
 * Schalter, ein Hue-Licht oder eine Kamera-Szene, nur Ein und Aus; kein
 * Geraet loest eine Regel „Geraet geschaltet“ aus (die Folgeregel liefe sonst
 * nicht); keine Bedingung, die sich laufend aendert (gebuchte Termine). Sonst
 * bleibt die ganze Regel in der Cloud.
 *
 * Reine Logik, ohne Datenbank.
 */

/** Aktion einer Regel, so weit die Entscheidung sie braucht. */
export interface ExecutorAction {
  kind: string;
  deviceId: number | null;
  deviceAction: string | null;
  targetCameraId: number | null;
}

export interface ExecutorRule {
  trigger: string;
  operating: string;
  operatingExtent?: string | null;
  actions: ExecutorAction[];
}

export interface ExecutorDevice {
  type: string;
  category: string | null;
  ipAddress: string | null;
  hueBridgeId: string | null;
  hueLightId: string | null;
  isActive: boolean;
}

export interface ExecutorContext {
  /** Geraete der Aktionen nach ID. */
  devices: Map<number, ExecutorDevice>;
  /** Geraete, die eine aktive Regel „Geraet geschaltet“ ausloesen. */
  switchTriggers: Set<number>;
}

export type Executor = { by: "hub" } | { by: "cloud"; reason: string };

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const LOCAL_CATEGORIES = new Set(["BELEUCHTUNG", "SCHALTER"]);
const LOCAL_ACTIONS = new Set(["open", "deactivate"]);

function actionByHub(a: ExecutorAction, ctx: ExecutorContext): string | null {
  if (a.kind === "CAMERA") return a.targetCameraId ? null : "Kamera-Aktion ohne Kamera";
  if (a.kind !== "DEVICE") return `Aktion ${a.kind} braucht die Cloud`;
  if (!a.deviceId || !a.deviceAction) return "Gerät oder Aktion fehlt";
  if (!LOCAL_ACTIONS.has(a.deviceAction)) return `Befehl ${a.deviceAction} nur über die Cloud`;
  const d = ctx.devices.get(a.deviceId);
  if (!d || !d.isActive) return "Gerät unbekannt oder inaktiv";
  if (ctx.switchTriggers.has(a.deviceId)) return "Gerät löst eine Regel „Gerät geschaltet“ aus";
  if (d.type === "HUE_LIGHT") return d.hueBridgeId && d.hueLightId ? null : "Hue-Licht ohne Bridge";
  if (d.type !== "SHELLY") return `Gerät ${d.type} nur über die Cloud`;
  if (!LOCAL_CATEGORIES.has(d.category ?? "")) return `Shelly der Kategorie ${d.category ?? "ohne"} nur über die Cloud`;
  if (!d.ipAddress || !IPV4_RE.test(d.ipAddress)) return "Shelly ohne IP im LAN";
  return null;
}

/** Darf der Hub diese Regel direkt ausfuehren? Im Zweifel die Cloud. */
export function decideExecutor(rule: ExecutorRule, ctx: ExecutorContext): Executor {
  if (rule.trigger !== "MOTION") return { by: "cloud", reason: "nur Bewegungs-Regeln" };
  if (rule.actions.length === 0) return { by: "cloud", reason: "keine Aktion" };
  if (rule.operating !== "ANY" && rule.operatingExtent === "BOOKED_SUBPROFILES") {
    return { by: "cloud", reason: "Betriebszeit mit gebuchten Terminen" };
  }
  for (const a of rule.actions) {
    const reason = actionByHub(a, ctx);
    if (reason) return { by: "cloud", reason };
  }
  return { by: "hub" };
}

/**
 * Ist die Abklingzeit vorbei? Wie `claimRule` in room-rules.ts: frei, wenn
 * die Regel nie lief oder ihr letzter Lauf vor `at - Abklingzeit` liegt.
 */
export function cooldownFree(lastRunAt: number | null, cooldownSeconds: number, at: number): boolean {
  if (lastRunAt === null) return true;
  return lastRunAt < at - Math.max(0, cooldownSeconds) * 1000;
}

/** Liegt `at` in einem der Zeitraeume [from, to)? Wie der Hub (motion-rules.ts, `allowedAt`). */
export function allowedAt(intervals: Array<{ from: string; to: string }>, at: number): boolean {
  return intervals.some((i) => {
    const from = Date.parse(i.from);
    const to = Date.parse(i.to);
    return Number.isFinite(from) && Number.isFinite(to) && at >= from && at < to;
  });
}
