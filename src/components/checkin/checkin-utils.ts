/**
 * Reine Hilfsfunktionen des Check-in-Kiosks – ohne React, ohne Netz.
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import type { CheckinTicket, EquipmentSetup, SlotOverviewService, TimeRange } from "./checkin-types";

/** Artikel, die das Personal am Shop tatsaechlich herausgeben muss. Buchbare
 *  Optionen wie die Flex-Option sind zwar auch Add-Ons, aber kein Material. */
export function isRentalAddOn(name: string): boolean {
  return !/flex/i.test(name);
}


/** Summiert das Verleihmaterial eines Tages je Artikel.
 *
 *  Wichtig: `addOns` gehoert dem ANNY-Auftrag, nicht dem einzelnen Ticket. Ein
 *  Auftrag mit 5 Gaesten erzeugt 5 Tickets, die alle dieselbe Materialliste
 *  tragen - stumpfes Summieren wuerde die Mengen verfuenffachen. Deshalb wird
 *  jeder Auftrag nur einmal gezaehlt. Tickets ohne `annyOrderId` (manuell
 *  angelegt oder Altbestand) zaehlen je Ticket. */
export function aggregateRentalAddOns(tickets: CheckinTicket[]): { name: string; quantity: number }[] {
  const seenOrders = new Set<string>();
  const totals = new Map<string, number>();
  for (const t of tickets) {
    const addOns = t.addOns;
    if (!Array.isArray(addOns) || addOns.length === 0) continue;
    const orderKey = t.annyOrderId ?? `ticket:${t.id}`;
    if (seenOrders.has(orderKey)) continue;
    seenOrders.add(orderKey);
    for (const a of addOns) {
      if (!a?.name || !isRentalAddOn(a.name)) continue;
      totals.set(a.name, (totals.get(a.name) ?? 0) + (a.quantity > 0 ? a.quantity : 1));
    }
  }
  return [...totals.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "de"));
}


/** Ordnet ein Info-Label einer Rolle fuer die Material-Kombination zu.
 *  Matcht ueber Teilstrings, damit auch abweichende Template-Labels
 *  ("Schuhgröße (EU)", "Sportart", ...) korrekt erkannt werden. */
export function classifyInfoLabel(
  label: string,
): "name" | "sport" | "level" | "shoe" | "neoprenFlag" | "neoprenSize" | "other" {
  const l = label.toLowerCase();
  if (l === "teilnehmer" || l.includes("teilnehmername")) return "name";
  if (l.includes("schuhgr")) return "shoe";
  if (l.includes("neopren")) {
    return l.includes("größe") || l.includes("groesse") || l.includes("grösse")
      ? "neoprenSize"
      : "neoprenFlag";
  }
  if (l.includes("sport")) return "sport";
  if (l.includes("level") || l.includes("niveau")) return "level";
  return "other";
}


/** "Ja"/"true"/"1" -> true (Boolean-Antworten aus dem Info-Formular). */
export function isYes(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "ja" || v === "true" || v === "1" || v === "yes";
}


/** Level-Reihenfolge fuer die Setup-Sortierung. */
export const LEVEL_ORDER = ["Anfänger", "Fortgeschritten", "Profi"];

export function compareSetups(a: EquipmentSetup, b: EquipmentSetup): number {
  const sportCmp = (a.sport ?? "~").localeCompare(b.sport ?? "~", "de");
  if (sportCmp !== 0) return sportCmp;
  const la = a.level ? LEVEL_ORDER.indexOf(a.level) : -1;
  const lb = b.level ? LEVEL_ORDER.indexOf(b.level) : -1;
  if (la !== lb) return (la === -1 ? 99 : la) - (lb === -1 ? 99 : lb);
  const na = Number((a.shoe ?? "").replace(",", "."));
  const nb = Number((b.shoe ?? "").replace(",", "."));
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return (a.shoe ?? "").localeCompare(b.shoe ?? "", "de");
}


/** Menschlich lesbare Kurzform eines Setups, z. B. "Wakeboard · Anfänger · Gr. 38". */
export function formatSetup(s: EquipmentSetup): string {
  const parts: string[] = [];
  if (s.sport) parts.push(s.sport);
  if (s.level) parts.push(s.level);
  if (s.shoe) parts.push(`Gr. ${s.shoe}`);
  return parts.join(" · ");
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function personName(t: { firstName: string | null; lastName: string | null; name: string }): string {
  return [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
}


/**
 * Formatiert ANNY's Oeffnungszeit-Bloecke in einen kompakten Text fuer die
 * Auslastungs-Section. Ein Block -> "10:00-18:00". Mehrere Bloecke ->
 * "10:00-14:00, 16:00-22:00".
 */
export function formatOpeningHours(
  blocks: Array<{ start: string; end: string }> | undefined,
): string {
  if (!blocks || blocks.length === 0) return "";
  return blocks
    .filter((b) => b.start && b.end)
    .map((b) => `${b.start}\u2013${b.end}`)
    .join(", ");
}


/**
 * Uebersetzt ANNY's unavailability_type in ein knappes Label fuer die
 * Slot-Buttons. Quelle: https://developers.anny.co/guides/availability
 *
 * Bekannte Werte aus ANNY:
 *   - booked_out / overbooked: Kapazitaet erschoepft
 *   - before_lead_time / after_lead_time / lead_time_conflict: Vorlauf-/Frist-Konflikt
 *   - under_min_duration / over_max_duration: Dauer-Limits verletzt
 *   - staggered_conflict / pause_conflict: Slot-Pausen/Zeitversatz-Konflikt
 *   - outside_opening_hours / closed: ausserhalb Oeffnungszeiten
 *   - resource_unavailable: keine Ressource verfuegbar
 *   - blocked: explizit gesperrt
 *
 * Fallback: roher Wert wird zu "Title Case" ohne underscores umgewandelt.
 */
export function annyReasonLabel(reason: string | undefined): string {
  if (!reason) return "";
  switch (reason) {
    case "booked_out":
    case "overbooked":
      return "voll";
    case "before_lead_time":
      return "zu frueh";
    case "after_lead_time":
      return "zu spaet";
    case "lead_time_conflict":
      return "Vorlauf";
    case "under_min_duration":
      return "zu kurz";
    case "over_max_duration":
      return "zu lang";
    case "staggered_conflict":
    case "pause_conflict":
      return "Konflikt";
    case "outside_opening_hours":
    case "closed":
      return "geschlossen";
    case "resource_unavailable":
      return "keine Ressource";
    case "blocked":
      return "gesperrt";
    default:
      // Generischer Fallback: "before_lead_time" -> "Before Lead Time"
      return reason
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}


/**
 * Liefert eine kompakte Uhrzeit-Beschriftung fuer die Ticket-Card im
 * Shop Monitor. Reihenfolge:
 *   1. slotStart/slotEnd (TIME_SLOT-Tickets, z. B. "10:00–12:00").
 *   2. startDate/endDate, wenn beide am gleichen Tag liegen und nicht
 *      einen "ganzen Tag" abdecken (00:00–23:59). Das deckt die aus Anny
 *      synchronisierten Bahnmieten/Kursplaetze ab, die ihre Uhrzeit als
 *      Timestamp tragen.
 *   3. Sonst leer (Mehrtages-Tickets ohne Slot-Zeit).
 */
export function formatTicketTimeLabel(ticket: {
  slotStart: string | null;
  slotEnd: string | null;
  startDate: string | null;
  endDate: string | null;
}): string {
  if (ticket.slotStart && ticket.slotEnd) {
    return `${ticket.slotStart}–${ticket.slotEnd}`;
  }
  if (ticket.startDate && ticket.endDate) {
    const s = new Date(ticket.startDate);
    const e = new Date(ticket.endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return "";
    const sameDay =
      s.getFullYear() === e.getFullYear()
      && s.getMonth() === e.getMonth()
      && s.getDate() === e.getDate();
    if (!sameDay) return "";
    const isFullDay =
      s.getHours() === 0 && s.getMinutes() === 0
      && (
        (e.getHours() === 23 && e.getMinutes() === 59)
        || (e.getHours() === 0 && e.getMinutes() === 0)
      );
    if (isFullDay) return "";
    const fmt = (d: Date) =>
      d.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      });
    return `${fmt(s)}–${fmt(e)}`;
  }
  return "";
}

/**
 * Zerlegt einen Service-Namen in (Gruppe, Variante).
 *
 * Strategie:
 *   1. " - "-Separator: "Oeffentlicher Betrieb - 1 Stunde" -> Gruppe
 *      "Oeffentlicher Betrieb", Variante "1 Stunde".
 *   2. Optionaler `groupName`: wenn der Name mit `groupName ` beginnt
 *      (Wort-Prefix), wird der Rest die Variante. So matched z.B.
 *      "Aquapark Tageskarte" + Gruppe "Aquapark" -> Variante "Tageskarte".
 *   3. Sonst: voller Name = Gruppe, keine Variante.
 */
export function splitServiceLabel(
  name: string,
  groupName?: string,
): { group: string; variant: string | null } {
  const m = name.split(/\s[-–]\s/);
  if (m.length >= 2) {
    const group = m[0].trim();
    const variant = m.slice(1).join(" - ").trim();
    return { group, variant: variant || null };
  }
  if (groupName) {
    const lowerName = name.toLowerCase();
    const lowerGroup = groupName.toLowerCase();
    if (lowerName.startsWith(lowerGroup + " ")) {
      return { group: groupName, variant: name.slice(groupName.length).trim() || null };
    }
  }
  return { group: name, variant: null };
}


/**
 * Top-Level-Gruppierung im Slot-Auslastungs-Dashboard. Verwendet eine
 * kuratierte Lift-/Bereich-Reihenfolge, weil ANNY's Resources im aktuellen
 * Tenant-Setup nicht physische Lifte abbilden (jede Resource ist 1:1 zu
 * einer Service-Variante).
 *
 * TODO: spaeter in EMP-Backoffice konfigurierbar machen (Feld
 * `displayGroup` + `displayOrder` am Service-Modell).
 *
 * Aktuell ist die Reihenfolge:
 *   1. Strandbad
 *   2. Aquapark
 *   3. SUP
 *   4. Seilbahn A (Oeffentlicher Betrieb + Exklusive Bahnmiete A)
 *   5. Seilbahn B (Anfaengerkurs Seilbahn B + Exklusive Bahnmiete B)
 *   6. Uebungslift (Anfaengerkurs Uebungslift + Exklusiver Uebungslift)
 *   7. Kurse (Ferienkurs, sonstige Anfaengerkurse)
 *   8. Sonstige (alles, was kein Pattern matched, ans Ende)
 */
export const MANUAL_GROUP_ORDER = [
  "Strandbad",
  "Aquapark",
  "SUP",
  "Seilbahn A",
  "Seilbahn B",
  "Uebungslift",
  "Kurse",
] as const;

export type ManualGroup = (typeof MANUAL_GROUP_ORDER)[number];

export const MANUAL_GROUP_RULES: Array<{ group: ManualGroup; test: (n: string) => boolean }> = [
  { group: "Strandbad", test: (n) => /^strandbad/i.test(n) },
  { group: "Aquapark", test: (n) => /^aquapark/i.test(n) },
  // SUP nur als ganzes Wort matchen (nicht "Support" o.ae.).
  { group: "SUP", test: (n) => /\bsup\b/i.test(n) },
  // Seilbahn A: Oeffentlicher Betrieb (laeuft auf der grossen Bahn) +
  // Exklusive Bahnmiete A. Werden unterhalb des Seilbahn-A-Resource-
  // Headers als zwei eigene Service-Sub-Gruppen (per Praefix) gerendert.
  {
    group: "Seilbahn A",
    test: (n) => /öffentlicher\s+betrieb/i.test(n) || /oeffentlicher\s+betrieb/i.test(n),
  },
  {
    group: "Seilbahn A",
    test: (n) => /exklusive?\s+bahnmiete\s*a\b/i.test(n) || /bahnmiete\s+seilbahn\s+a\b/i.test(n),
  },
  // Seilbahn B
  {
    group: "Seilbahn B",
    test: (n) => /exklusive?\s+bahnmiete\s*b\b/i.test(n) || /bahnmiete\s+seilbahn\s+b\b/i.test(n),
  },
  {
    group: "Seilbahn B",
    test: (n) => /anf(ä|ae)ngerkurs.*seilbahn\s*b\b/i.test(n),
  },
  // Uebungslift
  {
    group: "Uebungslift",
    test: (n) => /anf(ä|ae)ngerkurs.*(übungslift|uebungslift)/i.test(n),
  },
  {
    group: "Uebungslift",
    test: (n) => /exklusive?r?\s+(übungslift|uebungslift)/i.test(n),
  },
  // Kurse: Ferienkurs + alle weiteren Anfaengerkurse ohne Lift-Spezifikation
  { group: "Kurse", test: (n) => /ferienkurs/i.test(n) },
  { group: "Kurse", test: (n) => /anf(ä|ae)ngerkurs/i.test(n) },
];

export function assignManualGroup(name: string): ManualGroup | null {
  for (const rule of MANUAL_GROUP_RULES) {
    if (rule.test(name)) return rule.group;
  }
  return null;
}


/**
 * Gruppiert Services nach manueller Display-Reihenfolge (siehe
 * MANUAL_GROUP_ORDER). Services ohne Match landen in "Sonstige" am Ende.
 *
 * resourceId/resourceName werden weiterhin nach aussen gegeben (fuer die
 * showResourceHeaders-Logik), basieren aber jetzt auf der manuellen
 * Gruppierung statt auf ANNY-Resources.
 */
export function groupByResource(services: SlotOverviewService[]): Array<{
  resourceId: string | null;
  resourceName: string;
  services: SlotOverviewService[];
}> {
  const buckets = new Map<string, SlotOverviewService[]>();
  for (const sv of services) {
    const key = assignManualGroup(sv.name) ?? "__sonstige__";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(sv);
  }
  const out: Array<{
    resourceId: string | null;
    resourceName: string;
    services: SlotOverviewService[];
  }> = [];
  for (const group of MANUAL_GROUP_ORDER) {
    const members = buckets.get(group);
    if (members && members.length > 0) {
      out.push({ resourceId: group, resourceName: group, services: members });
    }
  }
  const rest = buckets.get("__sonstige__");
  if (rest && rest.length > 0) {
    out.push({ resourceId: null, resourceName: "Sonstige", services: rest });
  }
  return out;
}


/**
 * Gruppiert Services nach gemeinsamen Praefix-Namen. Zwei Strategien:
 *   a) " - "-Separator: "Oeffentlicher Betrieb - 1 Stunde", "... - 2 Stunden",
 *      "... - Tageskarte" landen in derselben Gruppe "Oeffentlicher Betrieb".
 *   b) Gemeinsames erstes Wort: "Aquapark Tageskarte" + "Aquapark Stundenkarte"
 *      werden unter "Aquapark" gebuendelt - aber nur, wenn mind. 2 Services
 *      dasselbe erste Wort teilen (sonst stuende ein Service wie "SUP" alleine
 *      unter sich selbst, was kosmetisch nicht hilft).
 *
 * Reihenfolge der Gruppen entspricht dem ersten Auftauchen.
 */
export function groupOverviewServices(services: SlotOverviewService[]): Array<{
  group: string;
  members: SlotOverviewService[];
}> {
  // Pre-Pass: zaehle erste Woerter unter Services OHNE " - "-Separator.
  // Diese Zaehlung entscheidet, ob "Aquapark X" + "Aquapark Y" unter "Aquapark"
  // gruppiert werden duerfen.
  const firstWordCounts = new Map<string, number>();
  for (const sv of services) {
    if (/\s[-–]\s/.test(sv.name)) continue;
    const firstWord = sv.name.split(/\s+/)[0]?.trim();
    if (!firstWord) continue;
    const key = firstWord.toLowerCase();
    firstWordCounts.set(key, (firstWordCounts.get(key) ?? 0) + 1);
  }

  const order: string[] = [];
  const buckets = new Map<string, SlotOverviewService[]>();
  for (const sv of services) {
    let groupKey: string;
    if (/\s[-–]\s/.test(sv.name)) {
      groupKey = splitServiceLabel(sv.name).group;
    } else {
      const firstWord = sv.name.split(/\s+/)[0]?.trim() ?? sv.name;
      const lower = firstWord.toLowerCase();
      groupKey = (firstWordCounts.get(lower) ?? 0) >= 2 ? firstWord : sv.name;
    }
    if (!buckets.has(groupKey)) {
      buckets.set(groupKey, []);
      order.push(groupKey);
    }
    buckets.get(groupKey)!.push(sv);
  }
  return order.map((g) => ({ group: g, members: buckets.get(g)! }));
}


export function timeStringToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function minutesToTimeString(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function computeGlobalRange(services: SlotOverviewService[]): TimeRange {
  let minM = Infinity;
  let maxM = -Infinity;
  for (const sv of services) {
    for (const slot of sv.slots) {
      const s = timeStringToMinutes(slot.startTime);
      const e = timeStringToMinutes(slot.endTime);
      if (s != null && s < minM) minM = s;
      if (e != null && e > maxM) maxM = e;
    }
    for (const oh of sv.openingHours) {
      const s = timeStringToMinutes(oh.start);
      const e = timeStringToMinutes(oh.end);
      if (s != null && s < minM) minM = s;
      if (e != null && e > maxM) maxM = e;
    }
  }
  // Fallback wenn keine Daten: Standard-Tag 09:00-20:00.
  if (minM === Infinity || maxM === -Infinity) {
    return { startMin: 9 * 60, endMin: 20 * 60 };
  }
  minM = Math.floor(minM / 60) * 60;
  maxM = Math.ceil(maxM / 60) * 60;
  // Mindestens 6 Stunden Range, damit kurze Slots nicht zu schmal werden.
  if (maxM - minM < 6 * 60) {
    maxM = minM + 6 * 60;
  }
  return { startMin: minM, endMin: maxM };
}


/** Sortier-Reihenfolge fuer Konfektionsgroessen (Neopren etc.). */
export const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "XXXL"];


/// Antwort-Werte sinnvoll sortieren: Zahlen (Schuh-/Kindergroessen wie 128)
/// numerisch aufsteigend und VOR den Buchstaben-Groessen, diese in
/// Konfektions-Reihenfolge (XS < S < M < ...), Rest alphabetisch.
export function sortSummaryValues(values: Map<string, number>): [string, number][] {
  return [...values.entries()].sort(([a], [b]) => {
    const na = Number(a.replace(",", "."));
    const nb = Number(b.replace(",", "."));
    const aNum = Number.isFinite(na) && a.trim() !== "";
    const bNum = Number.isFinite(nb) && b.trim() !== "";
    if (aNum && bNum) return na - nb;
    if (aNum !== bNum) return aNum ? -1 : 1;
    const ia = SIZE_ORDER.indexOf(a.toUpperCase());
    const ib = SIZE_ORDER.indexOf(b.toUpperCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1 || ib !== -1) return ia !== -1 ? -1 : 1;
    return a.localeCompare(b, "de");
  });
}

