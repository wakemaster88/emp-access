/**
 * Uhrzeit der Kameras gegen den Hub (rein, testbar).
 *
 * Reolink meldet in GetTime die Wanduhr, die auch im Bild eingeblendet ist
 * (Jahr … Sekunde). Verglichen wird mit der Berliner Wanduhr des Hubs, so
 * faellt ein falscher Zeitzonen- oder Sommerzeit-Eintrag als ±3600 s auf.
 */
export interface ReolinkTime {
  year: number;
  mon: number;
  day: number;
  hour: number;
  min: number;
  sec: number;
}

/** Komponenten einer Zeit als Berliner Wanduhr. */
export function berlinWall(at: Date): ReolinkTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: n("year"), mon: n("month"), day: n("day"), hour: n("hour"), min: n("minute"), sec: n("second") };
}

function wallMs(t: ReolinkTime): number {
  return Date.UTC(t.year, t.mon - 1, t.day, t.hour, t.min, t.sec);
}

/** Abweichung der Kamera-Uhr in Sekunden (positiv = Kamera geht vor). */
export function clockOffsetSeconds(camera: ReolinkTime, hubNow: Date): number {
  return Math.round((wallMs(camera) - wallMs(berlinWall(hubNow))) / 1000);
}

/** Ab dieser Abweichung zeigt die Zentrale einen Hinweis. */
export const CLOCK_WARN_S = 3;

/* ---------------------------------------------------------------------------
 * Art der Abweichung und Plan fuer die Zeit-Einstellungen (nur lesen).
 *
 * Der Hub liest an den Kameras nur: GetTime (Uhrzeit, Zeitzone, Sommerzeit)
 * und GetNtp (Zeitserver an/aus, Adresse). Was umzustellen waere, steht als
 * Vorschlag im Log und in der Diagnose; der Hub schickt dafuer keinen
 * Befehl an eine Kamera.
 * ------------------------------------------------------------------------- */

/** Rest unter dieser Abweichung nach ganzen Stunden: Zeitzone oder Sommerzeit. */
export const CLOCK_TZ_REST_MAX_S = 120;

export type ClockKind = "ok" | "zeitzone" | "drift";

/**
 * Art der Abweichung: ganze Stunden abspalten; bleibt ein Rest unter 120 s,
 * ist es die Zeitzone oder die Sommerzeit ("zeitzone"). Sonst "ok" unter
 * CLOCK_WARN_S, darueber "drift" (die Uhr laeuft weg).
 */
export function classifyClockOffset(offsetS: number): { kind: ClockKind; hours: number; restS: number } {
  const hours = Math.round(offsetS / 3600) || 0;
  const restS = offsetS - hours * 3600;
  if (hours !== 0 && Math.abs(restS) < CLOCK_TZ_REST_MAX_S) return { kind: "zeitzone", hours, restS };
  if (Math.abs(offsetS) < CLOCK_WARN_S) return { kind: "ok", hours: 0, restS: offsetS };
  return { kind: "drift", hours, restS };
}

/** Kurzwort der Art fuer Log-Zeilen. */
export function clockKindLabel(kind: ClockKind): string {
  return kind === "zeitzone" ? "Zeitzone" : kind === "drift" ? "Drift" : "im Takt";
}

/** Sommerzeit-Regel wie in GetTime (Dst), nur die Felder, die der Plan prueft. */
export interface DstRule {
  enabled: boolean;
  /** Versatz in Stunden (Reolink: offset). */
  offsetH: number | null;
  startMon: number | null;
  startWeek: number | null;
  startWeekday: number | null;
  endMon: number | null;
  endWeek: number | null;
  endWeekday: number | null;
}

/** Zeit-Einstellungen einer Kamera, wie gelesen; null = nicht lesbar. */
export interface ClockSettings {
  /** UTC-Versatz in Sekunden, Ost positiv (Reolink meldet timeZone mit umgekehrtem Vorzeichen). */
  utcOffsetS: number | null;
  dst: DstRule | null;
  ntp: boolean | null;
  /** Adresse des Zeitservers; null = keiner eingetragen oder nicht lesbar. */
  ntpServer: string | null;
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Einstellungen aus den Antworten von GetTime (value) und GetNtp (value;
 * null = nicht gelesen oder ohne Antwort).
 */
export function parseClockSettings(getTime: unknown, getNtp: unknown): ClockSettings {
  const t = (getTime && typeof getTime === "object" ? getTime : {}) as { Time?: Record<string, unknown>; Dst?: Record<string, unknown> };
  const tz = numOrNull(t.Time?.timeZone);
  const d = t.Dst;
  const dst: DstRule | null =
    d && typeof d === "object"
      ? {
          enabled: numOrNull(d.enable) === 1,
          offsetH: numOrNull(d.offset),
          startMon: numOrNull(d.startMon),
          startWeek: numOrNull(d.startWeek),
          startWeekday: numOrNull(d.startWeekday),
          endMon: numOrNull(d.endMon),
          endWeek: numOrNull(d.endWeek),
          endWeekday: numOrNull(d.endWeekday),
        }
      : null;
  const n = (getNtp && typeof getNtp === "object" ? (getNtp as { Ntp?: Record<string, unknown> }).Ntp : undefined) ?? null;
  const ntpEnable = n ? numOrNull(n.enable) : null;
  return {
    utcOffsetS: tz == null ? null : -tz || 0,
    dst,
    ntp: ntpEnable == null ? null : ntpEnable === 1,
    ntpServer: n && typeof n.server === "string" && n.server.trim() ? n.server.trim() : null,
  };
}

/** Soll fuer die Kameras am Standort: Zeitzone, Sommerzeit-Regel, Zeitserver im Standort-Netz. */
export interface ClockTarget {
  utcOffsetS: number;
  /** Sommerzeit: Versatz und Regel (Monat, Woche 5 = letzte, Wochentag 0 = Sonntag). */
  dst: { offsetH: number; startMon: number; startWeek: number; startWeekday: number; endMon: number; endWeek: number; endWeekday: number };
  ntp: boolean;
  /** Der Zeitserver soll im Standort-Netz stehen (sonst genuegt jeder eingetragene). */
  ntpLocal: boolean;
}

/**
 * Berlin: UTC+1, Sommerzeit nach EU-Regel (letzter Sonntag im Maerz bis
 * letzter Sonntag im Oktober), Zeitserver an. Ein Zeitserver ausserhalb des
 * Standort-Netzes ist erlaubt; laeuft die Uhr trotzdem ab, schlaegt der Plan
 * vor, ihn zu pruefen.
 */
export const CLOCK_TARGET_BERLIN: ClockTarget = {
  utcOffsetS: 3600,
  dst: { offsetH: 1, startMon: 3, startWeek: 5, startWeekday: 0, endMon: 10, endWeek: 5, endWeekday: 0 },
  ntp: true,
  ntpLocal: false,
};

/**
 * Adresse im Standort-Netz? Private IPv4 (10/8, 172.16/12, 192.168/16) und
 * Namen, die nur im lokalen Netz aufgeloest werden (.local, .lan, .home.arpa,
 * .internal, .fritz.box). Alles andere gilt als ausserhalb und erscheint in
 * keiner Zeile.
 */
export function isSiteAddress(host: string | null | undefined): boolean {
  const h = (host ?? "").trim().toLowerCase();
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return /^(?:[a-z0-9-]+\.)*fritz\.box$/.test(h) || /^(?:[a-z0-9-]+\.)+(?:local|lan|home\.arpa|internal)$/.test(h);
}

function utcText(offsetS: number): string {
  const h = offsetS / 3600;
  const sign = h < 0 ? "-" : "+";
  const abs = Math.abs(h);
  const whole = Math.floor(abs);
  const min = Math.round((abs - whole) * 60);
  return `UTC${sign}${whole}${min ? `:${String(min).padStart(2, "0")}` : ""}`;
}

function dstMatches(d: DstRule, t: ClockTarget["dst"]): boolean {
  return (
    d.offsetH === t.offsetH &&
    d.startMon === t.startMon &&
    d.startWeek === t.startWeek &&
    d.startWeekday === t.startWeekday &&
    d.endMon === t.endMon &&
    d.endWeek === t.endWeek &&
    d.endWeekday === t.endWeekday
  );
}

function offsetText(offsetS: number): string {
  return `${offsetS > 0 ? "+" : ""}${offsetS} s`;
}

/** Abweichung grob, damit eine langsam weiterlaufende Uhr nicht jede halbe Stunde eine Zeile bringt. */
function offsetBucket(offsetS: number): number {
  const abs = Math.abs(offsetS);
  const step = abs >= 3600 ? 3600 : abs >= 300 ? 300 : 60;
  return Math.sign(offsetS) * Math.round(abs / step) * step;
}

export interface ClockPlan {
  kind: ClockKind;
  /** Vorschlaege, was an der Kamera umzustellen waere (leer = nichts). */
  steps: string[];
  /** Stand der Einstellungen in Worten (ohne Adressen ausserhalb des Standort-Netzes). */
  state: string;
  /** Aendert sich nur, wenn sich Art, grobe Abweichung, Stand oder Vorschlag aendert. */
  key: string;
}

/**
 * Plan fuer eine Kamera: `ist` die gemessene Abweichung und die gelesenen
 * Einstellungen (null = noch nicht gelesen), `soll` das Ziel. Nur ein
 * Vorschlag; umgestellt wird nichts.
 */
export function clockPlan(ist: { offsetS: number; settings: ClockSettings | null }, soll: ClockTarget): ClockPlan {
  const c = classifyClockOffset(ist.offsetS);
  const s = ist.settings;
  const steps: string[] = [];
  const state: string[] = [];
  let zoneOrDstStep = false;
  if (s?.utcOffsetS != null) {
    state.push(`Zeitzone ${utcText(s.utcOffsetS)}`);
    if (s.utcOffsetS !== soll.utcOffsetS) {
      steps.push(`Zeitzone ${utcText(soll.utcOffsetS)} statt ${utcText(s.utcOffsetS)}`);
      zoneOrDstStep = true;
    }
  }
  if (s?.dst) {
    const rule = dstMatches(s.dst, soll.dst);
    state.push(`Sommerzeit ${s.dst.enabled ? (rule ? "an (EU-Regel)" : "an (andere Regel)") : "aus"}`);
    if (!s.dst.enabled) {
      steps.push("Sommerzeit einschalten (EU-Regel)");
      zoneOrDstStep = true;
    } else if (!rule) {
      steps.push("Sommerzeit-Regel auf EU (letzter Sonntag im März bis letzter Sonntag im Oktober)");
      zoneOrDstStep = true;
    }
  }
  if (s?.ntp != null) {
    const where = s.ntpServer ? (isSiteAddress(s.ntpServer) ? `im Standort-Netz ${s.ntpServer}` : "außerhalb des Standort-Netzes") : "ohne Adresse";
    state.push(s.ntp ? `Zeitserver an (${where})` : "Zeitserver aus");
    if (soll.ntp && !s.ntp) steps.push("Zeitserver einschalten");
    if (soll.ntpLocal && (s.ntp || soll.ntp) && !(s.ntpServer && isSiteAddress(s.ntpServer))) {
      steps.push("Zeitserver im Standort-Netz eintragen");
    }
  }
  const external = !!s?.ntpServer && !isSiteAddress(s.ntpServer);
  if (c.kind === "zeitzone" && !zoneOrDstStep) {
    steps.push(`Zeitzone und Sommerzeit prüfen (Abweichung ${c.hours > 0 ? "+" : ""}${c.hours} h)`);
  }
  if (c.kind === "drift") {
    if (s?.ntp === true) {
      steps.push(
        external && !soll.ntpLocal
          ? "Zeitserver prüfen (außerhalb des Standort-Netzes, Uhr läuft trotz Zeitserver ab)"
          : "Zeitserver prüfen (Uhr läuft trotz Zeitserver ab)"
      );
    }
    else if (s?.ntp == null) steps.push("Uhr stellen oder Zeitserver prüfen");
  }
  if (!s) state.push("Einstellungen noch nicht gelesen");
  const bucket = c.kind === "ok" ? 0 : offsetBucket(ist.offsetS);
  return { kind: c.kind, steps, state: state.join(", "), key: `${c.kind}:${bucket}|${state.join(",")}|${steps.join(",")}` };
}

/** Die eine Zeile je Kamera (einmal am Tag und bei Aenderung). */
export function clockPlanLine(name: string, offsetS: number, plan: ClockPlan): string {
  const head = plan.kind === "ok" ? `Kamera-Uhr ${name}: im Takt` : `Kamera-Uhr ${name}: ${offsetText(offsetS)} (${clockKindLabel(plan.kind)})`;
  const state = plan.state ? `; ${plan.state}` : "";
  const tail = plan.steps.length ? ` – Vorschlag: ${plan.steps.join(", ")} (nicht umgestellt)` : " – nichts umzustellen";
  return `${head}${state}${tail}`;
}

/* ---------------------------------------------------------------------------
 * Gemerkter Stand je Kamera (hub/.cache/camera-clock.json): wann die
 * Einstellungen gelesen und wann der Plan geloggt wurde. So bleibt es auch
 * ueber einen Neustart des Hubs (etwa nach einem Update) bei einmal am Tag.
 * In der Datei stehen keine Zugangsdaten.
 * ------------------------------------------------------------------------- */

export const CLOCK_DAY_MS = 24 * 3_600_000;

export interface ClockMemo {
  settingsAt: number;
  settings: ClockSettings;
  /** Schluessel des zuletzt geloggten Plans (ClockPlan.key) und wann. */
  planKey: string | null;
  planAt: number;
}

/** Einstellungen faellig? Einmal am Tag; eine zurueckgestellte Uhr zaehlt als faellig. */
export function clockSettingsDue(memo: ClockMemo | undefined, now: number): boolean {
  return !memo || now - memo.settingsAt >= CLOCK_DAY_MS || now < memo.settingsAt;
}

/** Betroffen: Die Uhr weicht ab, oder an den Einstellungen waere etwas umzustellen. */
export function clockPlanAffected(plan: Pick<ClockPlan, "kind" | "steps">): boolean {
  return plan.kind !== "ok" || plan.steps.length > 0;
}

/**
 * Plan-Zeile faellig? Fuer eine betroffene Kamera bei Aenderung und sonst
 * einmal am Tag. Eine Kamera ohne Befund bekommt keine Zeile; nur wenn sie
 * nach einer gemeldeten Abweichung wieder im Takt ist, steht das einmal da.
 * `memo.planKey` ist der Schluessel der zuletzt gemeldeten betroffenen Lage,
 * null = zuletzt ohne Befund oder noch nichts gemeldet (clockPlanKeyAfter).
 */
export function clockPlanDue(memo: ClockMemo | undefined, plan: Pick<ClockPlan, "kind" | "steps" | "key">, now: number): boolean {
  if (!clockPlanAffected(plan)) return !!memo?.planKey;
  if (!memo || memo.planKey !== plan.key) return true;
  return now - memo.planAt >= CLOCK_DAY_MS || now < memo.planAt;
}

/** Was nach einer Plan-Zeile gemerkt wird: ihr Schluessel, ohne Befund null. */
export function clockPlanKeyAfter(plan: Pick<ClockPlan, "kind" | "steps" | "key">): string | null {
  return clockPlanAffected(plan) ? plan.key : null;
}

export function serializeClockMemo(memos: Map<number, ClockMemo>): string {
  const cameras: Record<string, ClockMemo> = {};
  for (const [id, m] of memos) cameras[String(id)] = m;
  return JSON.stringify({ v: 1, cameras });
}

function parseSettings(raw: unknown): ClockSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const d = r.dst && typeof r.dst === "object" ? (r.dst as Record<string, unknown>) : null;
  return {
    utcOffsetS: num(r.utcOffsetS),
    dst: d
      ? {
          enabled: d.enabled === true,
          offsetH: num(d.offsetH),
          startMon: num(d.startMon),
          startWeek: num(d.startWeek),
          startWeekday: num(d.startWeekday),
          endMon: num(d.endMon),
          endWeek: num(d.endWeek),
          endWeekday: num(d.endWeekday),
        }
      : null,
    ntp: typeof r.ntp === "boolean" ? r.ntp : null,
    ntpServer: typeof r.ntpServer === "string" && r.ntpServer ? r.ntpServer.slice(0, 255) : null,
  };
}

/** Datei lesen; Unlesbares und Eintraege aelter als zwei Tage oder aus der Zukunft fallen weg. */
export function parseClockMemo(raw: unknown, now: number): Map<number, ClockMemo> {
  const out = new Map<number, ClockMemo>();
  const cams = raw && typeof raw === "object" ? (raw as { cameras?: unknown }).cameras : null;
  if (!cams || typeof cams !== "object") return out;
  for (const [key, value] of Object.entries(cams as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const settingsAt = typeof v.settingsAt === "number" ? v.settingsAt : NaN;
    const settings = parseSettings(v.settings);
    if (!settings || !Number.isFinite(settingsAt) || settingsAt > now || now - settingsAt > 2 * CLOCK_DAY_MS) continue;
    const planAt = typeof v.planAt === "number" && Number.isFinite(v.planAt) && v.planAt <= now ? v.planAt : 0;
    out.set(id, { settingsAt, settings, planKey: typeof v.planKey === "string" && planAt ? v.planKey : null, planAt });
  }
  return out;
}
