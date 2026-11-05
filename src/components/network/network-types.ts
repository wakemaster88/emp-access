// Gemeinsame (serialisierte) Typen fuer die Netzwerk-Komponenten.
// Die Server-Page mappt Prisma-Ergebnisse auf diese schlanken Strukturen.

export interface NetworkDeviceRow {
  id: number;
  name: string;
  type: string;
  vendor: string | null;
  model: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  location: string | null;
  notes: string | null;
  portCount: number;
  usedPorts: number;
  /// Zuletzt vom Hub-Scan gesehen (ISO-String) - Basis fuer Online-Status.
  lastSeenAt: string | null;
}

export interface VlanRow {
  id: number;
  vlanId: number;
  name: string;
  subnet: string | null;
  gateway: string | null;
  description: string | null;
  portCount: number;
  taggedPortCount: number;
  clientCount: number;
}

export interface OutletRow {
  id: number;
  label: string;
  location: string | null;
  type: string;
  notes: string | null;
  port: { id: number; number: number; deviceId: number; deviceName: string } | null;
}

export interface AreaRow {
  id: number;
  name: string;
  sortOrder: number;
  description: string | null;
  vlanId: number | null;
  ipFrom: string | null;
  ipTo: string | null;
  clientCount: number;
}

export interface ClientRow {
  id: number;
  name: string;
  type: string;
  ipAddress: string | null;
  macAddress: string | null;
  isStatic: boolean;
  notes: string | null;
  /// Zuletzt vom Hub-Scan gesehen (ISO-String).
  lastSeenAt: string | null;
  device: {
    id: number;
    name: string;
    type: string;
    ipAddress: string | null;
    lastUpdate: string | null;
  } | null;
  port: { id: number; number: number; deviceId: number; deviceName: string } | null;
  vlan: { id: number; vlanId: number; name: string } | null;
  area: { id: number; name: string; sortOrder: number; vlanId: number | null } | null;
}

export interface IotDeviceOption {
  id: number;
  name: string;
  type: string;
  ipAddress: string | null;
  lastUpdate: string | null;
  isActive: boolean;
}

/** Vom Hub gescannte Hosts (fuer den kombinierten Geraete-Tab). */
export interface DiscoveredRow {
  id: number;
  macAddress: string;
  ipAddress: string | null;
  iface: string | null;
  hostname: string | null;
  vendor: string | null;
  openPorts: number[];
  ipHistory: { ip: string; seenUntil: string }[];
  deviceType: string | null;
  responseMs: number | null;
  reachable: boolean;
  hubName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /// Auto-Match: infra = Switch/AP, client = NetworkClient, device = IoT.
  match: { kind: "infra" | "client" | "device"; name: string } | null;
}

export interface PortOption {
  id: number;
  number: number;
  deviceName: string;
  occupied: boolean;
}

export const NETWORK_DEVICE_TYPES = [
  { value: "SWITCH", label: "Switch" },
  { value: "ROUTER", label: "Router" },
  { value: "ACCESS_POINT", label: "Access Point" },
  { value: "FIREWALL", label: "Firewall" },
  { value: "OTHER", label: "Sonstiges" },
] as const;

export const CLIENT_TYPES = [
  { value: "PC", label: "PC / Kasse" },
  { value: "PRINTER", label: "Drucker" },
  { value: "CAMERA", label: "Kamera" },
  { value: "NAS", label: "NAS / Server" },
  { value: "PHONE", label: "Telefon" },
  { value: "IOT", label: "IoT-Gerät" },
  { value: "MONITOR", label: "Monitor / Display" },
  { value: "OTHER", label: "Sonstiges" },
] as const;

export const OUTLET_TYPES = [
  { value: "WALL_OUTLET", label: "Wanddose" },
  { value: "PATCH_PANEL", label: "Patchpanel" },
] as const;

export const PORT_STATUS = [
  { value: "ACTIVE", label: "Aktiv" },
  { value: "INACTIVE", label: "Inaktiv" },
  { value: "RESERVED", label: "Reserviert" },
  { value: "FAULTY", label: "Defekt" },
] as const;

/// Stabile Farbpalette fuer VLAN-Badges/Port-Matrix (Index = Stelle in der VLAN-Liste % n).
// Ein VLAN ist eine Kategorie wie eine Reihe im Diagramm, kein Zustand: deshalb
// die Diagramm-Tokens statt Paletten- oder Zustandsfarben (docs/design-regeln.md,
// Abschnitt 15). Getönte Fläche mit farbigem Rand, Schrift in Vordergrundfarbe,
// damit der Kontrast in Hell und Dunkel reicht.
export const VLAN_COLORS = [
  "border-chart-1/50 bg-chart-1/15 text-foreground",
  "border-chart-2/50 bg-chart-2/15 text-foreground",
  "border-chart-3/50 bg-chart-3/15 text-foreground",
  "border-chart-4/50 bg-chart-4/15 text-foreground",
  "border-chart-5/50 bg-chart-5/15 text-foreground",
] as const;

/**
 * Farbe eines VLANs nach seiner Stelle in der VLAN-Liste des Mandanten
 * (sortiert nach VLAN-ID), nicht nach der fortlaufenden Datenbank-ID: so
 * bekommen bis zu fünf VLANs sicher verschiedene Farben, und jede Ansicht
 * mit derselben Liste färbt gleich.
 */
export function vlanColor(
  vlanDbId: number,
  vlans: readonly { id: number; vlanId: number }[],
): string {
  const self = vlans.find((v) => v.id === vlanDbId);
  const index = self
    ? vlans.filter((v) => v.vlanId < self.vlanId || (v.vlanId === self.vlanId && v.id < self.id)).length
    : vlanDbId;
  return VLAN_COLORS[index % VLAN_COLORS.length];
}

/** Sortierschluessel: bekannte VLANs nach vlanId, danach „Ohne VLAN“. */
export function vlanGroupSortKey(vlanId: number | null): number {
  return vlanId == null ? Number.POSITIVE_INFINITY : vlanId;
}

/** Sortierschluessel: Bereiche nach sortOrder, danach „Ohne Bereich“. */
export function areaGroupSortKey(sortOrder: number | null): number {
  return sortOrder == null ? Number.POSITIVE_INFINITY : sortOrder;
}

export type VlanGroupMeta = {
  key: string;
  vlanDbId: number | null;
  vlanId: number | null;
  name: string;
  subnet: string | null;
};

/// Hub Auto-Scan ca. alle 30 Min. – Toleranz inkl. Sweep-Dauer.
export const ONLINE_THRESHOLD_MS = 45 * 60 * 1000;

/**
 * Online-Status aus dem letzten Scan-Zeitpunkt: true/false, oder null wenn
 * das Geraet noch nie gesehen wurde (Status unbekannt).
 */
export function scanOnline(lastSeenAt: string | null): boolean | null {
  if (!lastSeenAt) return null;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}
