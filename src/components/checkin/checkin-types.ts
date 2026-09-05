/**
 * Typen des Check-in-Kiosks (Daten aus /api/checkin/public/[token]).
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */


export interface TicketExtra {
  name: string;
  quantity: number;
}


/** In ANNY zugebuchtes Verleihmaterial/Zusatzartikel (Neoprenanzug, Wakeboard,
 *  Helm, Flex-Option ...). `note` ist der ANNY-Zusatztext, meist die Leihdauer. */
export interface TicketAddOn {
  name: string;
  quantity: number;
  note?: string | null;
}


export interface CheckinTicket {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  ticketTypeName: string | null;
  status: string;
  validityType: string;
  slotStart: string | null;
  slotEnd: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: string | null;
  startDate: string | null;
  endDate: string | null;
  profileImage: string | null;
  rfidCode: string | null;
  barcode: string | null;
  qrCode: string | null;
  uuid: string | null;
  extras: TicketExtra[] | null;
  source: string | null;
  subscriptionId: number | null;
  serviceId: number | null;
  accessAreaId: number | null;
  vereinId: number | null;
  /** UUID der zugehoerigen ANNY-Buchung. null wenn Service keinen ANNY-Link
   * hatte oder der Sync vor diesem Feature passiert ist. */
  annyBookingId: string | null;
  /** Gebuchte ANNY-Ressource. Kombi-Services legen pro Gast eine Buchung je
   * Ressource an - darueber werden die Tickets wieder zu einem Gast
   * zusammengefasst. null = nicht von ANNY oder Sync vor diesem Feature. */
  annyResourceId: string | null;
  /** Freitext-Notiz, die das Personal am Shop-Monitor zum Ticket hinterlegt. */
  notes: string | null;
  /** Antworten aus Info-Anfragen (Label -> Wert), z. B. Schuhgroesse/Level. */
  guestInfo: Record<string, string> | null;
  /** In ANNY zugebuchtes Verleihmaterial. null = nichts zugebucht.
   *  Gilt fuer den gesamten Auftrag (`annyOrderId`), nicht pro Ticket. */
  addOns: TicketAddOn[] | null;
  /** ANNY-Auftrag des Tickets. Mehrere Tickets teilen sich einen Auftrag. */
  annyOrderId: string | null;
  /** true = Info-Anfrage verschickt, aber noch keine Antwort ("Infos fehlen"). */
  infoPending?: boolean;
  checkedIn: boolean;
  accessArea?: { id: number; name: string } | null;
  subscription?: { id: number; name: string; requiresPhoto?: boolean; requiresRfid?: boolean } | null;
  service?: {
    id: number;
    name: string;
    requiresPhoto?: boolean;
    requiresRfid?: boolean;
    allowManualCheckin?: boolean;
    /** Service hat mindestens eine ANNY-Resource-Verknuepfung. */
    hasAnnyLink?: boolean;
  } | null;
  verein?: { id: number; name: string } | null;
  _count?: { scans: number };
}


/** Ein Teilticket eines Kombi-Tickets, mit aufgeloestem Bereichsnamen.
 *  "Aquapark Tageskarte" besteht z.B. aus einer Aquapark- und einer
 *  Strandbad-Buchung; im Ticket-Overlay wird beides aufgelistet, damit das
 *  Personal sieht, welche Bereiche der Gast tatsaechlich nutzen darf. */
export interface BundlePart {
  ticket: CheckinTicket;
  areaName: string;
}


/** Kombiniertes Board-Setup eines Teilnehmers (Sport + Level + Schuhgroesse).
 *  Beispiel: "Wakeboard · Anfänger · Gr. 38" – so weiss das Personal direkt,
 *  WELCHES Board mit WELCHER Bindungsgroesse bereitgestellt werden muss,
 *  statt drei getrennte Zaehllisten kombinieren zu muessen. */
export interface EquipmentSetup {
  sport: string | null;
  level: string | null;
  shoe: string | null;
  count: number;
}


/** Aggregierte Gaeste-Infos einer Service-Gruppe. */
export interface GuestInfoSummary {
  /** Tickets mit mindestens einer beantworteten Info. */
  answered: number;
  /** Alle Tickets der Gruppe an diesem Tag. */
  total: number;
  /** Kombinierte Material-Setups (Sport+Level+Schuhgroesse). */
  setups: EquipmentSetup[];
  /** Neopren-Groessen aller Teilnehmer, die einen Anzug leihen. */
  neopren: Map<string, number>;
  /** Uebrige Infos (Label -> Wert -> Anzahl), die nicht kombinierbar sind. */
  labels: Map<string, Map<string, number>>;
  /** Alle Tickets der Gruppe an diesem Tag (fuer den PDF-Export). */
  tickets: CheckinTicket[];
}


export interface SubData {
  id: number;
  name: string;
  requiresPhoto: boolean;
  requiresRfid: boolean;
  tickets: CheckinTicket[];
}

export interface ScanEntry {
  id: number;
  code: string;
  result: string;
  scanTime: string;
  ticketId: number | null;
  device: { id: number; name: string } | null;
}

export interface DefaultValidity {
  defaultValidityType?: string | null;
  defaultStartDate?: string | null;
  defaultEndDate?: string | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
  defaultValidityDurationMinutes?: number | null;
}

export interface ServiceData extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
  /** Hauptressource des Service. Wird beim Verkauf als `Ticket.accessAreaId`
   *  gesetzt; bei `null` faellt das Frontend auf `areaIds[0]` zurueck (legacy). */
  mainAccessAreaId?: number | null;
  /** Service hat mindestens eine ANNY-Resource-Verknuepfung -> Slot-Buchung. */
  hasAnnyLink?: boolean;
}

export interface SubOption extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
}

export interface AnnySyncStatus {
  lastSync: string | null;
  created?: number;
  updated?: number;
  errors?: number;
  errorDetails?: string[];
}

export interface OpenableDevice {
  id: number;
  name: string;
  category: "TUER" | "DREHKREUZ";
  lastUpdate: string | null;
}


/**
 * Slot-Auslastungs-Daten fuer das Shop-Monitor-Dashboard. Kommt vom
 * /slot-overview-Endpoint und enthaelt pro ANNY-verknuepftem Service eine
 * Slot-Liste mit Kapazitaet/Rest aus ANNY + EMP-Buchungszahl.
 */
export interface SlotOverviewSlot {
  startTime: string;
  endTime: string;
  startIso: string;
  endIso: string;
  available: boolean;
  capacity: number | null;
  remaining: number | null;
  empBookings: number;
  unavailabilityType: string | null;
  /** ID der aktiven manuellen Sperre, oder null. */
  blockId: number | null;
  /** Optionaler Sperrgrund (nur wenn blockId gesetzt). */
  blockReason: string | null;
}

export interface SlotOverviewService {
  serviceId: number;
  name: string;
  hasAnnyLink: boolean;
  serviceType: "slot" | "day";
  annyServiceUuid: string | null;
  annyMatchedName: string | null;
  /** Primaere ANNY-Resource (Lift/Bahn). Steuert Top-Level-Gruppierung im UI. */
  primaryResource: { id: string; name: string } | null;
  slots: SlotOverviewSlot[];
  totalEmpBookings: number;
  /** ANNY meldet fuer dieses Datum keine Verfuegbarkeit -> Service ausblenden. */
  availableToday: boolean;
  /** Oeffnungszeit-Bloecke aus ANNY ("10:00"-"18:00"). Leer = keine ANNY-Info. */
  openingHours: { start: string; end: string }[];
  note: string | null;
}

export interface SlotOverviewData {
  date: string;
  services: SlotOverviewService[];
  summary: {
    totalSlots: number;
    freeSlots: number;
    partialSlots: number;
    fullSlots: number;
    totalCapacity: number;
    totalRemaining: number;
    totalEmpBookings: number;
  };
}

export interface CheckinData {
  monitorName: string;
  accountName: string;
  date: string;
  tickets: CheckinTicket[];
  subscriptions: SubData[];
  services: ServiceData[];
  areas: { id: number; name: string }[];
  /** Zuordnung ANNY-Resource -> AccessArea, um die `annyResourceId` eines
   *  Kombi-Teiltickets als Bereichsnamen anzeigen zu koennen. */
  annyResourceAreas?: { resourceId: string; areaId: number }[];
  allSubscriptions?: SubOption[];
  recentScans: ScanEntry[];
  annySyncStatus?: AnnySyncStatus | null;
  openableDevices?: OpenableDevice[];
  quickDeviceIds?: number[];
}

/**
 * Gemeinsame Zeitachse fuer alle Slot-Pills im Auslastungs-Dashboard.
 * Pills werden absolut innerhalb eines Timeline-Containers positioniert -
 * dadurch landen alle 10:00-Slots auf derselben horizontalen Position,
 * unabhaengig vom Service. Day-Pass-Services rendern einen einzelnen
 * breiten Pill ueber ihre Oeffnungszeit (oder den ganzen Tag als Fallback).
 */
export interface TimeRange {
  startMin: number;
  endMin: number;
}

/**
 * Slot-Auslastungs-Section: gruppiert ANNY-Services nach gemeinsamem
 * Praefix (z.B. "Oeffentlicher Betrieb" buendelt seine 1h/2h/Tageskarte-
 * Varianten in einer Card). Innerhalb der Gruppe pro Variante eine Zeile
 * mit Verkaufszahl + optionalem Slot-Streifen.
 *
 * Header: aggregierte Stats ("12 frei · 4 belegt · 1 voll") aus
 * SlotOverviewData.summary.
 */
/**
 * Was wird geklickt? Slot-Auslastungs-Pills und Variant-Tiles geben ein
 * SlotOverviewPickPayload zurueck. Der Parent oeffnet daraus das Add-
 * Ticket-Overlay.
 */
export interface SlotOverviewPickPayload {
  serviceId: number;
  slotDate: string;
  slotStart?: string;
  slotEnd?: string;
}


/**
 * Cross-cutting State fuer die Slot-Auslastungs-Section: aktuelle Uhrzeit
 * (fuer den Now-Indicator) und Hover-Position (fuer den vertikalen Highlight
 * durch alle Services). Wird via Context an alle Timeline-Zeilen geliefert,
 * damit Pills den Hover setzen und Timelines die Linien rendern koennen.
 */
export interface SlotOverviewUIState {
  /** Minutes-seit-Mitternacht der aktuellen Uhrzeit, oder null wenn nicht heute. */
  nowMin: number | null;
  /** Hover-Position der Maus in Minuten, oder null wenn kein Hover. */
  hoverMin: number | null;
  setHoverMin: (m: number | null) => void;
  /** Slot sperren (volle Restkapazitaet in ANNY belegen). */
  onBlockSlot?: (serviceId: number, slot: SlotOverviewSlot) => void;
  /** Manuelle Sperre wieder aufheben (ANNY-Buchung stornieren). */
  onUnblockSlot?: (blockId: number, busyKey: string) => void;
  /** Key des Slots, der gerade verarbeitet wird ("serviceId|HH:mm"), oder null. */
  blockBusyKey?: string | null;
}
