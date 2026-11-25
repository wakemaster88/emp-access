/**
 * Einlass-Regeln: strengere Prüfungen am Einlass, die der Betreiber in den
 * Einstellungen einzeln einschaltet. Ab Werk ist jede Regel aus; dann
 * verhalten sich Pi-Scan und Handscanner genau wie ohne diese Datei.
 *
 * Gespeichert in `Account.accessRules` (JSON). Alles, was dort fehlt oder
 * nicht passt, gilt als „aus“.
 *
 * Bewusst ohne Prisma-Client, damit die Einstellungs-Karte die Typen und
 * Texte importieren kann. Die Abfrage mit Zwischenspeicher steht in
 * `access-rules-cache.ts`.
 */

/** Ja/Nein-Schalter der Einlass-Regeln. */
export const ACCESS_RULE_SWITCHES = [
  "readerNeedsArea",
  "ticketNeedsArea",
  "handscannerDenyRedeemed",
  "voucherNeedsArea",
] as const;

export type AccessRuleSwitch = (typeof ACCESS_RULE_SWITCHES)[number];

/** Alle Regeln, auch die Wartezeit (Minuten). */
export type AccessRuleKey = AccessRuleSwitch | "passbackMinutes";

export const ACCESS_RULE_KEYS: readonly AccessRuleKey[] = [
  "readerNeedsArea",
  "ticketNeedsArea",
  "handscannerDenyRedeemed",
  "passbackMinutes",
  "voucherNeedsArea",
];

export type AccessRules = {
  [K in AccessRuleSwitch]: boolean;
} & {
  /** Wartezeit für einen zweiten Eintritt in denselben Bereich; 0 = aus. */
  passbackMinutes: number;
};

export const ACCESS_RULES_OFF: AccessRules = {
  readerNeedsArea: false,
  ticketNeedsArea: false,
  handscannerDenyRedeemed: false,
  passbackMinutes: 0,
  voucherNeedsArea: false,
};

export const PASSBACK_MIN_MINUTES = 1;
export const PASSBACK_MAX_MINUTES = 120;
/** Vorschlag der Karte beim Einschalten. */
export const PASSBACK_SUGGESTED_MINUTES = 10;

/** Ein Eintrag im Änderungsverlauf der Regeln. */
export interface AccessRuleChange {
  /** ISO-Zeitpunkt. */
  at: string;
  adminId: string | null;
  /** E-Mail oder Name des Admins zum Anzeigen. */
  admin: string | null;
  key: AccessRuleKey;
  from: boolean | number;
  to: boolean | number;
}

/** So viele Änderungen bleiben im JSON. */
export const ACCESS_RULE_CHANGES_KEPT = 50;

export const ACCESS_RULE_TEXTS: Record<AccessRuleKey, { title: string; effect: string; confirm?: string }> = {
  readerNeedsArea: {
    title: "Leser ohne Bereich öffnet nicht",
    effect:
      "Ein Leser, der keinem Bereich zugeordnet ist, öffnet nur noch für Tickets, die diesem Gerät direkt zugewiesen sind – Wakesys- und Binarytec-Karten, Gutscheine und Mitarbeiter-Tickets ohne Direkt-Zuweisung öffnen dort nicht mehr.",
    confirm:
      "Vorher prüfen, ob an diesen Lesern Wakesys- oder Binarytec-Gäste, Gutscheine oder Mitarbeiter (auch an Türöffnern) hineinkommen: Sie werden dort ab dann abgewiesen, bis der Leser einen Bereich hat.",
  },
  ticketNeedsArea: {
    title: "Tickets ohne Bereich gelten nur an freigegebenen Bereichen",
    effect:
      "Ein Ticket ohne jeden Bereich öffnet an einem Leser nur noch an der Hauptressource seines Service oder wenn der Bereich des Lesers dafür freigegeben ist (Haken im Bereich).",
    confirm:
      "Setze vorher in den Bereichen, an denen solche Tickets weiter gelten sollen, den Haken „Tickets ohne Bereich gelten hier“. Der Haken lässt sich schon setzen, solange die Regel aus ist. Ohne Haken werden sie ab dem Einschalten an allen Lesern mit Bereich abgewiesen, außer an ihrer Hauptressource. Das gilt auch für Mitarbeiter-Tickets ohne Bereich und ohne Direkt-Zuweisung. Reine Ausgänge bleiben offen. Ein Leser, der als Eingang eines Bereichs eingetragen ist, zählt als Eingang und weist sie ohne Haken ab, auch wenn er zugleich als Ausgang eingetragen ist.",
  },
  handscannerDenyRedeemed: {
    title: "Handscanner lehnt eingelöste Einzeltickets ab",
    effect:
      "Ein bereits eingelöstes Einzelticket ohne Wiedereinlass zeigt am Handscanner Rot mit der Zeit des ersten Scans.",
  },
  passbackMinutes: {
    title: "Wiedereintritt erst nach Ausgang oder Wartezeit",
    effect:
      "Dasselbe Ticket kommt in denselben Bereich erst wieder hinein, wenn es am Ausgang gescannt wurde oder die Wartezeit vorbei ist – auch Abos und Durchgänge. Das gilt nur in Bereichen mit mindestens einem aktiven Ausgangs-Leser.",
  },
  voucherNeedsArea: {
    title: "Gutscheine gelten nur an Lesern ihres Bereichs",
    effect:
      "Ein Gutschein, der selbst oder über seinen Ticket-Typ einem Bereich zugeordnet ist, wird an einem Leser eines anderen Bereichs nicht eingelöst. Gutscheine ohne jede Zuordnung gelten weiter überall.",
  },
};

export function isPassbackMinutes(v: unknown): v is number {
  return (
    typeof v === "number"
    && Number.isInteger(v)
    && v >= PASSBACK_MIN_MINUTES
    && v <= PASSBACK_MAX_MINUTES
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Roh-JSON aus der Datenbank in vollständig typisierte Regeln. Ein Schalter
 * ist nur an, wenn dort genau `true` steht; die Wartezeit nur, wenn sie eine
 * ganze Zahl von 1 bis 120 ist.
 */
export function parseAccessRules(raw: unknown): AccessRules {
  const out: AccessRules = { ...ACCESS_RULES_OFF };
  if (!isPlainObject(raw)) return out;
  for (const key of ACCESS_RULE_SWITCHES) {
    out[key] = raw[key] === true;
  }
  out.passbackMinutes = isPassbackMinutes(raw.passbackMinutes) ? raw.passbackMinutes : 0;
  return out;
}

/** Änderungsverlauf aus dem Roh-JSON; unlesbare Einträge fallen weg. */
export function parseAccessRuleChanges(raw: unknown): AccessRuleChange[] {
  if (!isPlainObject(raw) || !Array.isArray(raw.changes)) return [];
  const keys = new Set<string>(ACCESS_RULE_KEYS);
  const out: AccessRuleChange[] = [];
  for (const c of raw.changes) {
    if (!isPlainObject(c)) continue;
    if (typeof c.at !== "string" || typeof c.key !== "string" || !keys.has(c.key)) continue;
    const valueOk = (v: unknown) => typeof v === "boolean" || typeof v === "number";
    if (!valueOk(c.from) || !valueOk(c.to)) continue;
    out.push({
      at: c.at,
      adminId: typeof c.adminId === "string" ? c.adminId : null,
      admin: typeof c.admin === "string" ? c.admin : null,
      key: c.key as AccessRuleKey,
      from: c.from as boolean | number,
      to: c.to as boolean | number,
    });
  }
  return out;
}

/** Ist mindestens eine Regel an? */
export function anyAccessRuleOn(rules: AccessRules): boolean {
  return ACCESS_RULE_SWITCHES.some((k) => rules[k]) || rules.passbackMinutes > 0;
}

/** Änderungen zwischen zwei Ständen, in der Reihenfolge von ACCESS_RULE_KEYS. */
export function diffAccessRules(
  before: AccessRules,
  after: AccessRules,
): Array<{ key: AccessRuleKey; from: boolean | number; to: boolean | number }> {
  return ACCESS_RULE_KEYS.filter((k) => before[k] !== after[k]).map((k) => ({
    key: k,
    from: before[k],
    to: after[k],
  }));
}

/**
 * Neuer Stand des JSON `Account.accessRules` nach einer Änderung (PUT der
 * Einstellungen): `patch` über die gelesenen Regeln gelegt, die neuen
 * Einträge vorn im Änderungsverlauf (höchstens ACCESS_RULE_CHANGES_KEPT).
 * Ohne Änderung ist `newChanges` leer, dann wird nichts geschrieben.
 */
export function mergeAccessRulesPatch(
  raw: unknown,
  patch: Partial<AccessRules>,
  who: { at: string; adminId: string | null; admin: string | null },
): { rules: AccessRules; changes: AccessRuleChange[]; newChanges: AccessRuleChange[] } {
  const before = parseAccessRules(raw);
  const rules: AccessRules = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (rules as Record<string, boolean | number>)[key] = value;
  }
  const newChanges: AccessRuleChange[] = diffAccessRules(before, rules).map((c) => ({ ...who, ...c }));
  const changes = [...[...newChanges].reverse(), ...parseAccessRuleChanges(raw)].slice(0, ACCESS_RULE_CHANGES_KEPT);
  return { rules, changes, newChanges };
}

// ---------------------------------------------------------------------------
// Die einzelnen Regeln (rein, ohne Datenbank)
// ---------------------------------------------------------------------------

/**
 * Hat der Leser einen Bereich? Gleiche Auslegung wie die Bereichsprüfung der
 * Scan-Route (`device.accessIn || device.accessOut`): 0 zählt als „keiner“.
 */
export function readerHasArea(device: { accessIn: number | null; accessOut: number | null }): boolean {
  return !!(device.accessIn || device.accessOut);
}

/** Regel „Leser ohne Bereich öffnet nicht“: true = ablehnen. */
export function deniesUnassignedReader(
  rules: AccessRules,
  opts: { readerHasArea: boolean; hasDirectDeviceMatch: boolean },
): boolean {
  return rules.readerNeedsArea && !opts.readerHasArea && !opts.hasDirectDeviceMatch;
}

/**
 * Regel „Tickets ohne Bereich gelten nur an freigegebenen Bereichen“:
 * true = ablehnen. Greift nur an Lesern mit Bereich (ohne Bereich gilt die
 * Regel „Leser ohne Bereich“) und nur für Tickets, für die die Route gar
 * keinen Bereich ableitet. Vereinsmitglieder ohne Bereiche lehnt die Route
 * ohnehin schon ab. An der Hauptressource des Tickets (`mainAreaId`) bleibt
 * es gültig, ebenso bei Ausgängen (`isExit`): wer drin ist, darf raus. Ein
 * Leser mit eingetragenem Eingang zählt als Eingang, auch wenn er zugleich
 * als Ausgang eingetragen ist (der Pi meldet keine Richtung).
 */
export function deniesUnassignedTicket(
  rules: AccessRules,
  opts: {
    ticketAreaCount: number;
    isVereinMember: boolean;
    deviceAreaIds: number[];
    openAreaIds: readonly number[];
    mainAreaId?: number | null;
    isExit?: boolean;
  },
): boolean {
  if (!rules.ticketNeedsArea) return false;
  if (opts.isExit) return false;
  if (opts.ticketAreaCount > 0 || opts.isVereinMember) return false;
  if (opts.deviceAreaIds.length === 0) return false;
  if (opts.mainAreaId != null && opts.deviceAreaIds.includes(opts.mainAreaId)) return false;
  return !opts.deviceAreaIds.some((a) => opts.openAreaIds.includes(a));
}

/**
 * Bereiche eines Gutscheins: sein eigener Bereich und die seines Service
 * (Service-Bereiche und Hauptressource).
 */
export function voucherAreaIds(
  voucher: { accessAreaId: number | null },
  serviceAreaIds: readonly number[],
): number[] {
  return [...new Set([...(voucher.accessAreaId ? [voucher.accessAreaId] : []), ...serviceAreaIds])];
}

/**
 * Regel „Gutscheine gelten nur an Lesern ihres Bereichs“: true = ablehnen.
 * Als Bereiche zählen die aus `voucherAreaIds` (eigener Bereich und die des
 * Service). Gutscheine ohne jede Zuordnung gelten überall; an Lesern ohne
 * Bereich gilt die Regel „Leser ohne Bereich“.
 */
export function deniesVoucherArea(
  rules: AccessRules,
  opts: { voucherAreaIds: readonly number[]; deviceAreaIds: readonly number[] },
): boolean {
  if (!rules.voucherNeedsArea) return false;
  if (opts.voucherAreaIds.length === 0 || opts.deviceAreaIds.length === 0) return false;
  return !opts.voucherAreaIds.some((a) => opts.deviceAreaIds.includes(a));
}

/**
 * Regel „Handscanner lehnt eingelöste Einzeltickets ab“: true = ablehnen.
 * Gleiche Ausnahmen wie die Wiedereintritts-Sperre am Drehkreuz: Abo,
 * Verein, Mitarbeiter, Wiedereinlass am Service oder Gerät, laufende
 * Zeitkarte, Ausgang und Scans außerhalb der Hauptressource (Durchgang).
 */
export function deniesRedeemedAtHandscanner(
  rules: AccessRules,
  t: {
    status: string;
    subscriptionId: number | null;
    vereinId: number | null;
    isEmployee: boolean;
    serviceAllowsReentry: boolean;
    deviceAllowsReentry: boolean;
    durationStillRunning: boolean;
    isExit: boolean;
    hitsMainResource: boolean;
  },
): boolean {
  return (
    rules.handscannerDenyRedeemed
    && t.status === "REDEEMED"
    && t.subscriptionId == null
    && t.vereinId == null
    && !t.isEmployee
    && !t.serviceAllowsReentry
    && !t.deviceAllowsReentry
    && !t.durationStillRunning
    && !t.isExit
    && t.hitsMainResource
  );
}

/** „Ticket bereits eingelöst“, mit der Zeit des ersten Scans, wenn bekannt. */
export function redeemedMessage(firstScanAt: Date | null, now: Date = new Date()): string {
  if (!firstScanAt) return "Ticket bereits eingelöst";
  const tz = "Europe/Berlin";
  const day = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: tz });
  const time = firstScanAt.toLocaleTimeString("de-DE", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const when = day(firstScanAt) === day(now)
    ? `${time} Uhr`
    : `${firstScanAt.toLocaleDateString("de-DE", { timeZone: tz, day: "2-digit", month: "2-digit" })}, ${time} Uhr`;
  return `Ticket bereits eingelöst (erster Scan ${when})`;
}

/** Letzter GRANTED-Scan des Tickets an einem Leser des Bereichs. */
export interface PassbackLastScan {
  scanTime: Date;
  device: { accessIn: number | null; accessOut: number | null } | null;
}

export type PassbackDenial = { remainingMs: number; message: string };

/**
 * Gleichzeitige Eintritte desselben Tickets (zwei Leser oder zweimal am
 * selben Leser im selben Augenblick) werden wie bei der Bereichssperre nicht
 * gegeneinander abgesichert: beide sehen noch keinen Eintritt.
 */
export function passbackMessage(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return minutes === 1
    ? "Bereits drin – Wiedereintritt nach Ausgang oder in 1 Minute"
    : `Bereits drin – Wiedereintritt nach Ausgang oder in ${minutes} Minuten`;
}

/**
 * Entscheidung der Regel „Wiedereintritt erst nach Ausgang oder Wartezeit“
 * aus dem letzten GRANTED-Scan des Tickets an einem Leser des Bereichs
 * innerhalb der Wartezeit. War das ein Eintritt in den Bereich
 * (`accessIn` = Bereich), wird abgelehnt; war es ein Ausgang aus dem Bereich
 * (`accessOut` = Bereich, `accessIn` ein anderer oder keiner), ist der
 * Eintritt frei. Ohne Scan im Fenster ist der Eintritt ebenfalls frei.
 *
 * Hat der Bereich keinen aktiven Ausgangs-Leser (`areaHasExitReader` false),
 * gibt es dort kein „drin“ und „draußen“: die Regel lehnt nie ab.
 */
export function decidePassback(
  opts: { minutes: number; areaId: number; now: Date; areaHasExitReader: boolean },
  last: PassbackLastScan | null,
): PassbackDenial | null {
  if (opts.minutes <= 0 || !opts.areaHasExitReader || !last?.device) return null;
  if (last.device.accessIn !== opts.areaId) return null;
  // Höchstens die Wartezeit (die Scan-Zeit der Datenbank kann knapp nach
  // `now` liegen).
  const remainingMs = Math.min(
    opts.minutes * 60_000,
    last.scanTime.getTime() + opts.minutes * 60_000 - opts.now.getTime(),
  );
  if (remainingMs <= 0) return null;
  return { remainingMs, message: passbackMessage(remainingMs) };
}

/**
 * „Betrifft heute“ der Regel „Wiedereintritt …“: Bereiche mit Einlass-Leser,
 * aufgeteilt in solche mit aktivem Ausgangs-Leser (Regel gilt) und solche
 * ohne (ausgenommen). Ein Leser mit demselben Bereich als Ein- und Ausgang
 * zählt wie in `loadAreaHasExitReader` nicht als Ausgangs-Leser. Erwartet nur
 * aktive Scanner-Pis; 0 zählt als „kein Bereich“.
 */
export function splitPassbackAreas(
  readers: ReadonlyArray<{ accessIn: number | null; accessOut: number | null }>,
): { applies: number[]; exempt: number[] } {
  const entry = new Set<number>();
  const exit = new Set<number>();
  for (const r of readers) {
    if (r.accessIn) entry.add(r.accessIn);
    if (r.accessOut && r.accessOut !== r.accessIn) exit.add(r.accessOut);
  }
  const applies: number[] = [];
  const exempt: number[] = [];
  for (const id of entry) (exit.has(id) ? applies : exempt).push(id);
  return { applies, exempt };
}

type PassbackDb = {
  scan: {
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy: { scanTime: "desc" };
      select: { scanTime: true; device: { select: { accessIn: true; accessOut: true } } };
    }) => Promise<PassbackLastScan | null>;
  };
};

/**
 * Fragt zuerst, ob der Bereich einen aktiven Ausgangs-Leser hat
 * (`areaHasExitReader`, im Scan-Weg mit 60-s-Zwischenspeicher). Nur dann
 * liest sie den letzten GRANTED-Scan des Tickets an einem Leser des Bereichs
 * innerhalb der Wartezeit (Index `Scan(ticketId, scanTime)`) und entscheidet
 * mit `decidePassback`. Ohne Wartezeit keine Abfrage. Schlägt eine der beiden
 * Abfragen fehl, lehnt die Regel nicht ab: eine freiwillige Regel darf das
 * Drehkreuz nicht wegen ihres eigenen Lesefehlers schließen.
 */
export async function evaluatePassback(
  db: PassbackDb,
  opts: {
    accountId: number;
    areaId: number | null | undefined;
    ticketId: number;
    minutes: number;
    now: Date;
    areaHasExitReader: (areaId: number) => Promise<boolean>;
  },
): Promise<PassbackDenial | null> {
  if (opts.minutes <= 0 || opts.areaId == null) return null;
  const areaId = opts.areaId;
  let areaHasExitReader: boolean;
  try {
    areaHasExitReader = await opts.areaHasExitReader(areaId);
  } catch (err) {
    console.error("[einlass-regeln] Ausgangs-Leser nicht lesbar:", err);
    areaHasExitReader = false;
  }
  if (!areaHasExitReader) return null;
  let last: PassbackLastScan | null;
  try {
    last = await db.scan.findFirst({
      where: {
        ticketId: opts.ticketId,
        accountId: opts.accountId,
        result: "GRANTED",
        scanTime: { gte: new Date(opts.now.getTime() - opts.minutes * 60_000) },
        device: { OR: [{ accessIn: areaId }, { accessOut: areaId }] },
      },
      orderBy: { scanTime: "desc" },
      select: { scanTime: true, device: { select: { accessIn: true, accessOut: true } } },
    });
  } catch (err) {
    console.error("[einlass-regeln] Letzter Scan nicht lesbar:", err);
    return null;
  }
  return decidePassback({ minutes: opts.minutes, areaId, now: opts.now, areaHasExitReader }, last);
}
