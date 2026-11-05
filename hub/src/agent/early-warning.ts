/**
 * Frueherkennung: aus Verlaeufen ablesen, was demnaechst ausfaellt.
 *
 * Der Waechter (watch.ts) meldet, was JETZT kaputt ist. Hier geht es um das,
 * was sich ankuendigt: Kameras mit gehaeuften Zeitueberschreitungen, Geraete,
 * die immer wieder neu starten, eine Platte, die in zwei Wochen voll ist,
 * Switch-Ports mit Fehlern oder Flattern, heisse Shellys und abgelaufene
 * Anmeldungen. Nur Warnungen und Vorschlaege, nichts wird geschaltet.
 *
 * Reine Logik ohne I/O: health-trends.ts fuettert den Speicher, der Waechter
 * fragt `assessTrends` ab, Tagesbericht und Werkzeug `early_warnings` nutzen
 * `trendSummary`.
 */
import type { Finding } from "./findings.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Verlauf wird 7 Tage gehalten, Plattenstand 14 Tage. */
export const KEEP_MS = 7 * DAY;
export const KEEP_DISK_MS = 14 * DAY;
/** Erreichbarkeit in 15-Minuten-Eimern. */
export const BUCKET_MS = 15 * MIN;

/** [Eimer-Start, ok, fehlgeschlagen, Abbrueche (ok -> fehlgeschlagen)] */
export type LinkBucket = [number, number, number, number];

export interface LinkSeries {
  label: string;
  /** Was der Hub abfragt, fuer die Meldung („Kamera“, „Shelly“ …). */
  kind: string;
  buckets: LinkBucket[];
  lastOk: boolean | null;
  lastError?: string | null;
}

export interface UptimeSeries {
  label: string;
  kind: string;
  lastUptimeS: number | null;
  lastAt: number;
  /** Zeitpunkte erkannter Neustarts. */
  reboots: number[];
}

export interface PortSeries {
  label: string;
  lastInErrors: number | null;
  /** [Zeit, neue Fehler seit der letzten Abfrage] */
  errors: Array<[number, number]>;
  lastChange: number | null;
  /** Zeitpunkte, an denen der Port seinen Zustand geaendert hat. */
  flaps: number[];
  up: boolean | null;
}

export interface TempSeries {
  label: string;
  /** [Zeit, °C] stuendlich */
  samples: Array<[number, number]>;
  last: number | null;
}

export interface LoginIssue {
  label: string;
  error: string;
  since: number;
}

export interface HealthStore {
  v: 1;
  links: Record<string, LinkSeries>;
  uptimes: Record<string, UptimeSeries>;
  ports: Record<string, PortSeries>;
  temps: Record<string, TempSeries>;
  /** [Zeit, Belegung 0..1] stuendlich */
  disk: Array<[number, number]>;
  logins: Record<string, LoginIssue>;
}

export function newHealthStore(): HealthStore {
  return { v: 1, links: {}, uptimes: {}, ports: {}, temps: {}, disk: [], logins: {} };
}

/** Gespeicherten Stand robust einlesen (alte/kaputte Datei = frisch anfangen). */
export function reviveHealthStore(raw: unknown): HealthStore {
  const st = newHealthStore();
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== 1) return st;
  const r = raw as Partial<HealthStore>;
  for (const k of ["links", "uptimes", "ports", "temps", "logins"] as const) {
    const v = r[k];
    if (v && typeof v === "object" && !Array.isArray(v)) (st as unknown as Record<string, unknown>)[k] = v;
  }
  if (Array.isArray(r.disk)) st.disk = r.disk.filter((s) => Array.isArray(s) && s.length === 2);
  return st;
}

/* ------------------------------------------------------------ Erfassen */

export function recordLink(
  st: HealthStore,
  key: string,
  label: string,
  kind: string,
  ok: boolean,
  now: number,
  error?: string | null,
): void {
  const s = (st.links[key] ??= { label, kind, buckets: [], lastOk: null });
  s.label = label;
  s.kind = kind;
  const start = now - (now % BUCKET_MS);
  let b = s.buckets[s.buckets.length - 1];
  if (!b || b[0] !== start) {
    b = [start, 0, 0, 0];
    s.buckets.push(b);
  }
  if (ok) b[1]++;
  else {
    b[2]++;
    if (s.lastOk === true) b[3]++;
    s.lastError = error ?? s.lastError ?? null;
  }
  s.lastOk = ok;
}

/**
 * Laufzeit seit dem letzten Neustart. Ist sie kleiner als erwartet
 * (letzter Wert + vergangene Zeit), hat das Geraet neu gestartet.
 */
export function recordUptime(
  st: HealthStore,
  key: string,
  label: string,
  kind: string,
  uptimeS: number,
  now: number,
): boolean {
  if (!Number.isFinite(uptimeS) || uptimeS < 0) return false;
  const s = (st.uptimes[key] ??= { label, kind, lastUptimeS: null, lastAt: now, reboots: [] });
  s.label = label;
  s.kind = kind;
  let rebooted = false;
  if (s.lastUptimeS != null) {
    const expected = s.lastUptimeS + (now - s.lastAt) / 1000;
    // Toleranz fuer ungenaue Uhren; 32-Bit-Timeticks laufen nach 497 Tagen ueber.
    const wrapped = s.lastUptimeS > 490 * 86_400;
    if (uptimeS + 120 < expected && !wrapped) {
      const bootAt = now - uptimeS * 1000;
      const prev = s.reboots[s.reboots.length - 1];
      if (prev == null || Math.abs(prev - bootAt) > 5 * MIN) {
        s.reboots.push(bootAt);
        rebooted = true;
      }
    }
  }
  s.lastUptimeS = uptimeS;
  s.lastAt = now;
  return rebooted;
}

/**
 * Switch-Port: ifInErrors (Zaehler) und ifLastChange (Zeitpunkt der letzten
 * Zustandsaenderung). `switchRebooted` = Zaehler und lastChange sind neu.
 */
export function recordPort(
  st: HealthStore,
  key: string,
  label: string,
  p: { inErrors: number | null; lastChange: number | null; up: boolean },
  now: number,
  switchRebooted = false,
): void {
  const s = (st.ports[key] ??= { label, lastInErrors: null, errors: [], lastChange: null, flaps: [], up: null });
  s.label = label;
  if (p.inErrors != null) {
    if (s.lastInErrors != null && !switchRebooted && p.inErrors > s.lastInErrors) {
      s.errors.push([now, p.inErrors - s.lastInErrors]);
    }
    s.lastInErrors = p.inErrors;
  }
  if (p.lastChange != null) {
    if (s.lastChange != null && !switchRebooted && p.lastChange !== s.lastChange) s.flaps.push(now);
    s.lastChange = p.lastChange;
  } else if (s.up != null && !switchRebooted && s.up !== p.up) {
    s.flaps.push(now);
  }
  s.up = p.up;
}

export function recordTemp(st: HealthStore, key: string, label: string, tC: number, now: number): void {
  if (!Number.isFinite(tC)) return;
  const s = (st.temps[key] ??= { label, samples: [], last: null });
  s.label = label;
  s.last = tC;
  const last = s.samples[s.samples.length - 1];
  // Stuendlich das Maximum behalten.
  if (last && now - last[0] < HOUR) last[1] = Math.max(last[1], tC);
  else s.samples.push([now, tC]);
}

export function recordDisk(st: HealthStore, usage: number, now: number): void {
  if (!Number.isFinite(usage)) return;
  const last = st.disk[st.disk.length - 1];
  if (last && now - last[0] < HOUR) last[1] = usage;
  else st.disk.push([now, usage]);
}

export function setLogin(st: HealthStore, key: string, issue: { label: string; error: string } | null, now: number): void {
  if (!issue) {
    delete st.logins[key];
    return;
  }
  const prev = st.logins[key];
  st.logins[key] = { ...issue, since: prev?.since ?? now };
}

export function pruneHealthStore(st: HealthStore, now: number): void {
  const cut = now - KEEP_MS;
  for (const [k, s] of Object.entries(st.links)) {
    s.buckets = s.buckets.filter((b) => b[0] >= cut);
    if (!s.buckets.length) delete st.links[k];
  }
  for (const [k, s] of Object.entries(st.uptimes)) {
    s.reboots = s.reboots.filter((t) => t >= cut);
    if (now - s.lastAt > KEEP_MS) delete st.uptimes[k];
  }
  for (const [k, s] of Object.entries(st.ports)) {
    s.errors = s.errors.filter((e) => e[0] >= cut);
    s.flaps = s.flaps.filter((t) => t >= cut);
    if (!s.errors.length && !s.flaps.length && s.lastInErrors == null && s.lastChange == null) delete st.ports[k];
  }
  for (const [k, s] of Object.entries(st.temps)) {
    s.samples = s.samples.filter((x) => x[0] >= cut);
    if (!s.samples.length) delete st.temps[k];
  }
  st.disk = st.disk.filter((x) => x[0] >= now - KEEP_DISK_MS);
}

/* ------------------------------------------------------------ Auswerten */

export interface LinkStats {
  key: string;
  label: string;
  kind: string;
  ok1h: number;
  fail1h: number;
  drops1h: number;
  drops3h: number;
  drops24h: number;
  /** Abbrueche pro Tag in den 6 Tagen davor (null = zu wenig Verlauf). */
  dropsPerDayBefore: number | null;
  failRatio1h: number;
  lastError: string | null;
}

export function linkStats(key: string, s: LinkSeries, now: number): LinkStats {
  let ok1h = 0;
  let fail1h = 0;
  let drops1h = 0;
  let drops3h = 0;
  let drops24h = 0;
  let dropsBefore = 0;
  let oldest = now;
  for (const [t, ok, fail, drops] of s.buckets) {
    oldest = Math.min(oldest, t);
    // Eimer zaehlt zu einem Zeitfenster, wenn er in es hineinreicht.
    const age = now - (t + BUCKET_MS);
    if (age < HOUR) {
      ok1h += ok;
      fail1h += fail;
      drops1h += drops;
    }
    if (age < 3 * HOUR) drops3h += drops;
    if (age < DAY) drops24h += drops;
    else dropsBefore += drops;
  }
  const historyDays = (now - DAY - oldest) / DAY;
  return {
    key,
    label: s.label,
    kind: s.kind,
    ok1h,
    fail1h,
    drops1h,
    drops3h,
    drops24h,
    dropsPerDayBefore: historyDays >= 2 ? dropsBefore / Math.min(6, historyDays) : null,
    failRatio1h: ok1h + fail1h > 0 ? fail1h / (ok1h + fail1h) : 0,
    lastError: s.lastError ?? null,
  };
}

export interface DiskForecast {
  usage: number;
  /** Zuwachs in Prozentpunkten pro Tag (null = zu wenig Verlauf). */
  growthPctPerDay: number | null;
  /** Tage bis 95 % (null = waechst nicht oder unbekannt). */
  daysToFull: number | null;
}

/** Lineare Regression ueber die letzten 7 Tage. */
export function diskForecast(samples: Array<[number, number]>, now: number): DiskForecast | null {
  const pts = samples.filter((s) => s[0] >= now - 7 * DAY);
  const last = samples[samples.length - 1];
  if (!last) return null;
  if (pts.length < 12 || pts[pts.length - 1][0] - pts[0][0] < DAY) {
    return { usage: last[1], growthPctPerDay: null, daysToFull: null };
  }
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  const slopePerDay = den > 0 ? (num / den) * DAY : 0;
  const daysToFull = slopePerDay > 0.0005 ? Math.max(0, (0.95 - last[1]) / slopePerDay) : null;
  return { usage: last[1], growthPctPerDay: slopePerDay * 100, daysToFull };
}

const LINK_KIND_TITLE: Record<string, string> = {
  camera: "Kamera",
  doorbird: "DoorBird",
  soundweb: "Soundweb",
  shelly: "Shelly",
  switch: "Switch (SNMP)",
  cloud: "Cloud-Verbindung",
};

const pct = (x: number) => `${Math.round(x * 100)} %`;
const fmtTime = (t: number) =>
  new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(t);

export interface Thresholds {
  /** Abbrueche in der letzten Stunde, ab denen gewarnt wird. */
  drops1h: number;
  /** Abbrueche in 24 h fuer schleichende Probleme. */
  drops24h: number;
  /** Fehlerquote in der letzten Stunde (bei mindestens 10 Fehlversuchen). */
  failRatio1h: number;
  reboots24h: number;
  reboots7d: number;
  portErrors24h: number;
  flaps24h: number;
  shellyTempC: number;
  diskDays: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  drops1h: 3,
  drops24h: 12,
  failRatio1h: 0.05,
  reboots24h: 2,
  reboots7d: 4,
  portErrors24h: 100,
  flaps24h: 6,
  shellyTempC: 75,
  diskDays: 14,
};

/**
 * Vorwarnungen. `open` = bereits gemeldete Schluessel: fuer die gilt eine
 * niedrigere Schwelle (Hysterese), damit eine Meldung nicht im
 * 5-Minuten-Takt kommt und geht.
 */
export function assessTrends(
  st: HealthStore,
  now: number,
  open: ReadonlySet<string> = new Set(),
  th: Thresholds = DEFAULT_THRESHOLDS,
): Finding[] {
  const out: Finding[] = [];
  const linkOut: Finding[] = [];

  for (const [key, s] of Object.entries(st.links)) {
    const l = linkStats(key, s, now);
    const fkey = `trend:link:${key}`;
    const isOpen = open.has(fkey);
    const what = `${LINK_KIND_TITLE[l.kind] ?? l.kind} ${l.label}`;
    // Ganz weg (keine einzige Antwort) meldet der Waechter schon als Ausfall.
    const fullyDown = l.ok1h === 0;
    const hot =
      !fullyDown &&
      (l.drops1h >= th.drops1h || (l.fail1h >= 10 && l.failRatio1h >= th.failRatio1h) || l.drops24h >= th.drops24h);
    const warm = l.drops3h >= 1 || l.failRatio1h >= th.failRatio1h / 5 || l.drops24h >= th.drops24h / 3;
    if (!(hot || (isOpen && warm))) continue;
    const parts = [`letzte Stunde ${l.drops1h} Aussetzer, ${pct(l.failRatio1h)} Fehlversuche`, `24 h: ${l.drops24h} Aussetzer`];
    if (l.dropsPerDayBefore != null) parts.push(`davor Ø ${l.dropsPerDayBefore.toFixed(1)}/Tag`);
    if (l.lastError) parts.push(`zuletzt: ${l.lastError}`);
    const rising = l.dropsPerDayBefore != null && l.drops24h >= Math.max(3, l.dropsPerDayBefore * 3);
    linkOut.push({
      key: fkey,
      severity: "warn",
      title: `Vorwarnung: ${what} hat gehäuft Zeitüberschreitungen${rising ? " (nimmt zu)" : ""}`,
      detail: `${parts.join(" · ")}. Typisch: Kabel/Stecker, PoE-Budget, WLAN-Empfang oder Netzteil.`,
    });
  }

  // Wackeln viele Geraete gleichzeitig, liegt es am Hub oder am Kern-Netz,
  // nicht an den einzelnen Geraeten: eine Meldung statt zwanzig.
  const linkCount = Object.keys(st.links).length;
  if (linkOut.length >= 5 && linkOut.length >= linkCount * 0.6) {
    out.push({
      key: "trend:link:many",
      severity: "warn",
      title: `Vorwarnung: ${linkOut.length} von ${linkCount} Geräten haben gleichzeitig Aussetzer`,
      detail: "Eher Hub-Anbindung, Kern-Switch oder Router als die Geräte selbst. Betroffen: " +
        linkOut.map((f) => f.title.replace(/^Vorwarnung: (.*) hat gehäuft.*$/, "$1")).slice(0, 8).join(", "),
    });
  } else {
    out.push(...linkOut);
  }

  for (const [key, s] of Object.entries(st.uptimes)) {
    const d24 = s.reboots.filter((t) => now - t < DAY).length;
    const d7 = s.reboots.length;
    const fkey = `trend:reboot:${key}`;
    const isOpen = open.has(fkey);
    const hot = d24 >= th.reboots24h || d7 >= th.reboots7d;
    if (!(hot || (isOpen && d7 >= 2))) continue;
    const when = s.reboots.slice(-3).map(fmtTime).join(", ");
    out.push({
      key: fkey,
      severity: "warn",
      title: `Vorwarnung: ${s.kind} ${s.label} startet häufig neu`,
      detail: `${d24} Neustarts in 24 h, ${d7} in 7 Tagen (zuletzt ${when}). Typisch: Stromversorgung, Überhitzung oder Firmware.`,
    });
  }

  for (const [key, s] of Object.entries(st.ports)) {
    const errs = s.errors.filter((e) => now - e[0] < DAY).reduce((a, e) => a + e[1], 0);
    const fkeyE = `trend:porterr:${key}`;
    if (errs >= th.portErrors24h || (open.has(fkeyE) && errs >= th.portErrors24h / 5)) {
      out.push({
        key: fkeyE,
        severity: "warn",
        title: `Vorwarnung: ${s.label} hat Übertragungsfehler`,
        detail: `${errs} Empfangsfehler in 24 h. Typisch: Kabel, Stecker oder Gegenstelle defekt.`,
      });
    }
    const flaps = s.flaps.filter((t) => now - t < DAY).length;
    const fkeyF = `trend:flap:${key}`;
    if (flaps >= th.flaps24h || (open.has(fkeyF) && flaps >= th.flaps24h / 2)) {
      out.push({
        key: fkeyF,
        severity: "warn",
        title: `Vorwarnung: ${s.label} geht ständig auf und ab`,
        detail: `${flaps} Link-Wechsel in 24 h${s.up === false ? ", gerade unten" : ""}. Typisch: Wackelkontakt, Kabel oder Gerät startet neu.`,
      });
    }
  }

  for (const [key, s] of Object.entries(st.temps)) {
    if (s.last == null) continue;
    const fkey = `trend:temp:${key}`;
    const limit = open.has(fkey) ? th.shellyTempC - 5 : th.shellyTempC;
    if (s.last < limit) continue;
    const max24 = Math.max(...s.samples.filter((x) => now - x[0] < DAY).map((x) => x[1]), s.last);
    out.push({
      key: fkey,
      severity: "warn",
      title: `Vorwarnung: ${s.label} wird heiß (${Math.round(s.last)} °C)`,
      detail: `Höchstwert 24 h ${Math.round(max24)} °C. Shellys schalten bei Überhitzung ab: Last, Belüftung und Klemmen prüfen.`,
    });
  }

  const disk = diskForecast(st.disk, now);
  if (disk && disk.daysToFull != null && disk.usage < 0.9) {
    const limit = open.has("trend:disk") ? th.diskDays * 1.5 : th.diskDays;
    if (disk.daysToFull <= limit) {
      out.push({
        key: "trend:disk",
        severity: "warn",
        title: `Vorwarnung: Platte des Hubs in etwa ${Math.max(1, Math.round(disk.daysToFull))} Tagen voll`,
        detail: `jetzt ${pct(disk.usage)}, wächst um ${disk.growthPctPerDay!.toFixed(1)} Prozentpunkte am Tag. Aufnahmen, Logs und Caches prüfen.`,
      });
    }
  }

  for (const [key, l] of Object.entries(st.logins)) {
    out.push({
      key: `trend:login:${key}`,
      severity: "warn",
      title: `Anmeldung abgelaufen oder abgelehnt: ${l.label}`,
      detail: `${l.error} (seit ${fmtTime(l.since)})`,
    });
  }
  return out;
}

/* ------------------------------------------------------------ Zusammenfassung */

export interface TrendSummary {
  /** Wackelkandidaten nach Aussetzern in 24 h, auch unter der Warnschwelle. */
  flakiest: Array<Pick<LinkStats, "label" | "kind" | "drops1h" | "drops24h" | "dropsPerDayBefore" | "lastError">>;
  reboots: Array<{ label: string; kind: string; last24h: number; last7d: number; lastAt: string | null }>;
  portErrors: Array<{ label: string; errors24h: number }>;
  portFlaps: Array<{ label: string; changes24h: number }>;
  hottest: Array<{ label: string; tempC: number; max24hC: number }>;
  disk: DiskForecast | null;
  logins: Array<{ label: string; error: string; since: string }>;
  /** Wie lange schon Verlauf gesammelt wird (Stunden). */
  historyHours: number;
}

export function trendSummary(st: HealthStore, now: number): TrendSummary {
  let oldest = now;
  const flakiest = Object.entries(st.links)
    .map(([k, s]) => {
      if (s.buckets[0]) oldest = Math.min(oldest, s.buckets[0][0]);
      return linkStats(k, s, now);
    })
    .filter((l) => l.drops24h > 0)
    .sort((a, b) => b.drops24h - a.drops24h)
    .slice(0, 8)
    .map(({ label, kind, drops1h, drops24h, dropsPerDayBefore, lastError }) => ({
      label,
      kind,
      drops1h,
      drops24h,
      dropsPerDayBefore: dropsPerDayBefore == null ? null : Math.round(dropsPerDayBefore * 10) / 10,
      lastError,
    }));
  const reboots = Object.values(st.uptimes)
    .filter((s) => s.reboots.length)
    .map((s) => ({
      label: s.label,
      kind: s.kind,
      last24h: s.reboots.filter((t) => now - t < DAY).length,
      last7d: s.reboots.length,
      lastAt: s.reboots.length ? new Date(s.reboots[s.reboots.length - 1]).toISOString() : null,
    }))
    .sort((a, b) => b.last7d - a.last7d)
    .slice(0, 8);
  const portErrors = Object.values(st.ports)
    .map((s) => ({ label: s.label, errors24h: s.errors.filter((e) => now - e[0] < DAY).reduce((a, e) => a + e[1], 0) }))
    .filter((p) => p.errors24h > 0)
    .sort((a, b) => b.errors24h - a.errors24h)
    .slice(0, 8);
  const portFlaps = Object.values(st.ports)
    .map((s) => ({ label: s.label, changes24h: s.flaps.filter((t) => now - t < DAY).length }))
    .filter((p) => p.changes24h > 1)
    .sort((a, b) => b.changes24h - a.changes24h)
    .slice(0, 8);
  const hottest = Object.values(st.temps)
    .filter((s) => s.last != null)
    .map((s) => ({
      label: s.label,
      tempC: Math.round(s.last!),
      max24hC: Math.round(Math.max(s.last!, ...s.samples.filter((x) => now - x[0] < DAY).map((x) => x[1]))),
    }))
    .sort((a, b) => b.max24hC - a.max24hC)
    .slice(0, 5);
  return {
    flakiest,
    reboots,
    portErrors,
    portFlaps,
    hottest,
    disk: diskForecast(st.disk, now),
    logins: Object.values(st.logins).map((l) => ({ label: l.label, error: l.error, since: new Date(l.since).toISOString() })),
    historyHours: Math.round((now - oldest) / HOUR),
  };
}

/** Kurzfassung als Text (Tagesbericht ohne Sprachmodell, /vorwarnungen). */
export function trendSummaryText(s: TrendSummary): string {
  const lines: string[] = [];
  for (const l of s.flakiest.slice(0, 5)) {
    lines.push(`• ${LINK_KIND_TITLE[l.kind] ?? l.kind} ${l.label}: ${l.drops24h} Aussetzer in 24 h${l.dropsPerDayBefore != null ? ` (davor Ø ${l.dropsPerDayBefore}/Tag)` : ""}`);
  }
  for (const r of s.reboots.slice(0, 5)) lines.push(`• ${r.kind} ${r.label}: ${r.last24h} Neustarts in 24 h, ${r.last7d} in 7 Tagen`);
  for (const p of s.portErrors.slice(0, 3)) lines.push(`• ${p.label}: ${p.errors24h} Empfangsfehler in 24 h`);
  for (const p of s.portFlaps.slice(0, 3)) lines.push(`• ${p.label}: ${p.changes24h} Link-Wechsel in 24 h`);
  const hot = s.hottest.filter((h) => h.max24hC >= 60);
  for (const h of hot.slice(0, 3)) lines.push(`• ${h.label}: ${h.tempC} °C (max ${h.max24hC} °C)`);
  if (s.disk) {
    const grow = s.disk.daysToFull != null ? `, voll in etwa ${Math.round(s.disk.daysToFull)} Tagen` : "";
    lines.push(`• Platte des Hubs ${Math.round(s.disk.usage * 100)} %${grow}`);
  }
  for (const l of s.logins) lines.push(`• Anmeldung ${l.label}: ${l.error}`);
  if (!lines.length) return "Keine Auffälligkeiten in den Verläufen.";
  return lines.join("\n");
}
