/**
 * Serialisierte Props des Raum-Leitstands (Server-Page -> Client-Komponenten).
 *
 * Der Raum ist derselbe Datensatz wie in der Schliessanlage (`KeyRoom`): dort
 * haengen Tueren und Schloesser dran, hier kommt die Steuerung der Geraete im
 * Raum dazu. Bewusst ein Raumbegriff und nicht zwei.
 */

import type { ExceptionSpec, SeasonSpec } from "@/lib/operating-hours";
import type { RoomActivity } from "@/lib/room-activity";
import type { RoomAutomation } from "@/lib/room-automations";

export interface RoomDevice {
  id: number;
  name: string;
  type: string;
  category: string | null;
  isActive: boolean;
  /** Hat eine LAN-Adresse – nur solche Geräte kann der Hub lokal schalten. */
  hasLocalAddress: boolean;
  /** Letzte Rueckmeldung des Geraets, ISO-String. */
  lastUpdate: string | null;
  /** Sekunden, die ein Taster nach dem Druck eingeschaltet bleibt. */
  pulseSeconds: number | null;
  /** Letzter Befehl (1 = an, 3 = aus) – Zustand fuer Geraete ohne Statusabfrage (Hue). */
  task: number;
}

/** Beschallungszone im Raum – Zustand aus dem letzten Heartbeat des Abspielers. */
export interface RoomZone {
  id: number;
  name: string;
  isActive: boolean;
  /** Hat einen Abspieler; ohne ihn lässt sich nichts starten. */
  hasPlayer: boolean;
  isPlaying: boolean;
  currentTitle: string | null;
  lastStateAt: string | null;
}

export interface RoomCamera {
  id: number;
  name: string;
  kind: string;
  enabled: boolean;
  snapshotAt: string | null;
  lastSeenAt: string | null;
}

export interface RoomLock {
  id: number;
  /** "Bürotür (1.03) [41.03]" – Tür plus Schließung. */
  label: string;
  lockType: string;
  /** Gerät, das diesen Schließpunkt elektronisch öffnet. */
  deviceId: number | null;
  deviceName: string | null;
}

/** Letztes Bewegungs-/Personenereignis einer Kamera im Raum. */
export interface RoomEvent {
  cameraId: number;
  cameraName: string;
  type: string;
  startedAt: string;
}

/**
 * Betriebszeit eines Raums, so weit sie zur Auswertung gebraucht wird. Der
 * Wochenplan kommt mit, damit der Browser "geoeffnet bis 20:00" ohne Nachfrage
 * beim Server anzeigen kann.
 */
export interface RoomSchedule {
  id: number;
  name: string;
  seasons: SeasonSpec[];
  exceptions: ExceptionSpec[];
}

/** Regel des Raums, verkürzt auf das, was die Karte zeigt. */
export interface RoomRuleSummary {
  id: number;
  name: string;
  trigger: string;
  isActive: boolean;
  lastRunAt: string | null;
  actionCount: number;
}

/** Auswahleintrag für die Zuordnung im Raum-Dialog. */
export interface ScheduleOption {
  id: number;
  name: string;
  isDefault: boolean;
}

/** Klima des Raums (Solltemperatur halten), siehe src/lib/room-climate.ts. */
export interface RoomClimateView {
  id: number;
  roomId: number;
  isActive: boolean;
  sensorDeviceId: number;
  heaterDeviceIds: number[];
  targetC: number;
  hysteresisC: number;
  setbackC: number | null;
  preheatMinutes: number;
  afterrunMinutes: number;
  fanDeviceIds: number[];
  fanOnHumidity: number;
  fanOffHumidity: number;
  fanAfterrunMinutes: number;
  fanMinTempC: number;
  fanOn: boolean | null;
  lastHumidity: number | null;
  operatingScheduleId: number | null;
  lastTempC: number | null;
  lastReadAt: string | null;
  heating: boolean | null;
  lastSwitchAt: string | null;
  currentTargetC: number | null;
  lastError: string | null;
}

export interface RoomPanel {
  id: number;
  name: string;
  /** Symbol-Schluessel; null = aus dem Namen geraten. */
  icon: string | null;
  number: string | null;
  building: string | null;
  floor: string | null;
  notes: string | null;
  devices: RoomDevice[];
  cameras: RoomCamera[];
  zones: RoomZone[];
  locks: RoomLock[];
  doorCount: number;
  lastEvent: RoomEvent | null;
  /** `null` = keine Betriebszeit, der Raum gilt dann als dauerhaft verfügbar. */
  schedule: RoomSchedule | null;
  rules: RoomRuleSummary[];
  /** Regeln und Audio-Zeitpläne des Raums, lesbar und mit nächstem Lauf. */
  automations: RoomAutomation[];
  climate: RoomClimateView | null;
  /** Personen heute laut Kameras des Raums; null = keine Kamera mit Daten. */
  activity: RoomActivity | null;
}

/** Netzwerkgeraet: Infrastruktur (Switch, AP, Router) oder Endgeraet. */
export interface NetworkItem {
  /** "d12" = NetworkDevice 12, "c7" = NetworkClient 7. */
  key: string;
  kind: "device" | "client";
  id: number;
  name: string;
  type: string;
  ipAddress: string | null;
  lastSeenAt: string | null;
  /** Raum: ausdruecklich zugeordnet oder erraten. */
  roomId: number | null;
  /** true = nur erraten (Standort/Bereich heisst wie der Raum, oder IoT-Geraet im Raum). */
  inferred: boolean;
}

export interface RaeumeData {
  rooms: RoomPanel[];
  /** Alle Netzwerkgeraete mit (ggf. erratenem) Raum. */
  network: NetworkItem[];
  /** Geräte, Kameras und Zonen, die noch keinem Raum zugeordnet sind. */
  looseDevices: RoomDevice[];
  looseCameras: RoomCamera[];
  looseZones: RoomZone[];
  /** Alle Betriebszeit-Profile des Mandanten, für die Zuordnung. */
  scheduleOptions: ScheduleOption[];
  /** Zeitzone des Mandanten für die Öffnungs-Auswertung. */
  timezone: string;
  /**
   * Serverzeit beim Rendern. Dient als Startwert fuer die "vor 3 Min"-Angaben:
   * Server und erster Client-Render rechnen mit demselben Bezugspunkt, danach
   * laeuft die Uhr im Browser weiter.
   */
  renderedAt: string;
}
