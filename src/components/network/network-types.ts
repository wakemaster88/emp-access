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

/// Stabile Farbpalette fuer VLAN-Badges/Port-Matrix (Index = vlanDbId % n).
export const VLAN_COLORS = [
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
] as const;

export function vlanColor(vlanDbId: number): string {
  return VLAN_COLORS[vlanDbId % VLAN_COLORS.length];
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

/// Der Hub scannt alle 5 Minuten - 15 Minuten Toleranz fuer ARP-Aussetzer.
export const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Online-Status aus dem letzten Scan-Zeitpunkt: true/false, oder null wenn
 * das Geraet noch nie gesehen wurde (Status unbekannt).
 */
export function scanOnline(lastSeenAt: string | null): boolean | null {
  if (!lastSeenAt) return null;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}
