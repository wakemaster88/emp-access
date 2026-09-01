/**
 * Serialisierte Props des Raum-Leitstands (Server-Page -> Client-Komponenten).
 *
 * Der Raum ist derselbe Datensatz wie in der Schliessanlage (`KeyRoom`): dort
 * haengen Tueren und Schloesser dran, hier kommt die Steuerung der Geraete im
 * Raum dazu. Bewusst ein Raumbegriff und nicht zwei.
 */

import type { ExceptionSpec, SeasonSpec } from "@/lib/operating-hours";

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

/** Auswahleintrag für die Zuordnung im Raum-Dialog. */
export interface ScheduleOption {
  id: number;
  name: string;
  isDefault: boolean;
}

export interface RoomPanel {
  id: number;
  name: string;
  number: string | null;
  building: string | null;
  floor: string | null;
  notes: string | null;
  devices: RoomDevice[];
  cameras: RoomCamera[];
  locks: RoomLock[];
  doorCount: number;
  lastEvent: RoomEvent | null;
  /** `null` = keine Betriebszeit, der Raum gilt dann als dauerhaft verfügbar. */
  schedule: RoomSchedule | null;
}

export interface RaeumeData {
  rooms: RoomPanel[];
  /** Geräte und Kameras, die noch keinem Raum zugeordnet sind. */
  looseDevices: RoomDevice[];
  looseCameras: RoomCamera[];
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
