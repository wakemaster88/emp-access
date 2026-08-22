/**
 * Welche Bedienelemente gehoeren zu einem Geraet?
 *
 * Ein Drehkreuz braucht "Öffnen" und "NOT-AUF", eine Lampe "Anschalten" und
 * "Aus", eine Markise "Ausfahren/Stopp/Einfahren". Diese Zuordnung lag bisher
 * nur in den Oberflaechen – fremde Systeme mussten sie aus Typ und Kategorie
 * nachbauen und lagen bei Antrieben zwangslaeufig daneben.
 *
 * Dieses Modul ist die gemeinsame Quelle: Mitarbeiter-PWA und API liefern
 * dieselben Aktionen in derselben Reihenfolge mit denselben Beschriftungen.
 *
 * Bewusst ohne Netzwerk- und Prisma-Code, damit die Oberflaechen es direkt
 * importieren koennen. Das Ausfuehren liegt in `src/lib/device-open.ts`.
 */

import { coverActionLabels, isCoverDevice } from "./cover-constants";
import { isPulseCategory } from "./pulse-constants";

/**
 * Bedienmodell eines Geraets. Sagt einer Integration, wie die Bedienung
 * grundsaetzlich aussieht – auch wenn sie die Beschriftungen selbst setzt.
 */
export type DeviceControlModel =
  /// Tuer: ein Impuls zum Oeffnen.
  | "DOOR"
  /// Drehkreuz: Impuls plus Dauer-Freigabe (NOT-AUF).
  | "TURNSTILE"
  /// Smart Lock: oeffnen und abschliessen.
  | "LOCK"
  /// Relais: ein und aus.
  | "SWITCH"
  /// Beleuchtung – wie SWITCH, nur anders beschriftet.
  | "LIGHT"
  /// Taster: schaltet fuer eine feste Dauer ein und faellt selbst wieder ab.
  | "PULSE"
  /// Antrieb mit zwei Fahrtrichtungen: auf, stopp, zu.
  | "COVER"
  /// Bewaesserungsventil: starten und stoppen.
  | "VALVE"
  /// Nur Messwerte, nichts zu schalten.
  | "SENSOR"
  /// Audio-Zone: Start/Stopp. Lautstaerke und Quelle laufen ueber
  /// `POST /api/devices/[id]/audio`, nicht als weitere Aktions-Knoepfe.
  | "AUDIO";

export type DeviceControlAction =
  | "open"
  | "close"
  | "stop"
  | "emergency"
  | "deactivate"
  | "reset";

export interface DeviceControl {
  /// Wert fuer `POST /api/devices/[id]/action`.
  action: DeviceControlAction;
  /// Beschriftung in der Landessprache, passend zum Geraet.
  label: string;
  /**
   * Gewicht in der Bedienung:
   *  - `primary`   Hauptbefehl, prominent darstellen
   *  - `secondary` Nebenbefehl
   *  - `danger`    Eingriff mit Folgen (NOT-AUF haelt das Drehkreuz offen)
   */
  role: "primary" | "secondary" | "danger";
}

export interface ControllableDevice {
  type: string;
  category: string | null;
}

export function isAudioDevice(device: ControllableDevice): boolean {
  return device.type === "AUDIO_PLAYER" || device.category === "AUDIO";
}

/** Schalter/Licht: bleiben an, bis jemand ausschaltet – UI zeigt einen Toggle. */
export function isLatchingSwitchDevice(device: ControllableDevice): boolean {
  const model = deviceControlModel(device);
  return model === "SWITCH" || model === "LIGHT";
}

/**
 * Bedienelemente fuer die Anzeige. Bei Schalter/Licht nur die Aktion, die
 * zum aktuellen Relais-Zustand passt – unbekannt zaehlt als aus.
 */
export function visibleDeviceControls(
  device: ControllableDevice,
  output: boolean | null | undefined,
): DeviceControl[] {
  const controls = deviceControls(device);
  if (!isLatchingSwitchDevice(device)) return controls;
  const action = output === true ? "reset" : "open";
  const match = controls.find((c) => c.action === action);
  return match ? [match] : controls.slice(0, 1);
}

/** Bedienmodell eines Geraets aus Typ und Kategorie ableiten. */
export function deviceControlModel(device: ControllableDevice): DeviceControlModel {
  if (device.category === "SENSOR") return "SENSOR";
  if (isAudioDevice(device)) return "AUDIO";
  if (isCoverDevice(device)) return "COVER";
  if (device.type === "NUKI_SMARTLOCK" || device.type === "LOQED_SMARTLOCK") return "LOCK";
  if (device.type === "GARDENA_VALVE") return "VALVE";
  if (device.category === "BELEUCHTUNG") return "LIGHT";
  if (device.category === "SCHALTER") return "SWITCH";
  if (isPulseCategory(device.category)) return "PULSE";
  if (device.category === "DREHKREUZ") return "TURNSTILE";
  return "DOOR";
}

/**
 * Die Bedienelemente eines Geraets in Anzeigereihenfolge – der Hauptbefehl
 * steht immer vorn. Eine leere Liste heisst: Dieses Geraet wird nicht ueber
 * Aktionen gesteuert (Sensor). Audio-Zonen haben Start/Stopp; Lautstaerke und
 * Quelle kommen zusaetzlich ueber den Audio-Endpunkt.
 *
 * Alle hier genannten Aktionen nimmt `POST /api/devices/[id]/action` fuer das
 * Geraet auch an. Umgekehrt gilt das nicht: Aus Kompatibilitaetsgruenden
 * akzeptiert der Endpunkt bei manchen Geraeten mehr, als hier steht (siehe
 * `availableDeviceActions` in `src/lib/device-open.ts`).
 */
export function deviceControls(device: ControllableDevice): DeviceControl[] {
  switch (deviceControlModel(device)) {
    case "SENSOR":
      return [];

    case "AUDIO":
      return [
        { action: "open", label: "Start", role: "primary" },
        { action: "stop", label: "Stopp", role: "secondary" },
      ];

    case "COVER": {
      // Bei einer Markise heisst "auf" ausfahren, bei einem Rolltor oeffnen.
      const labels = coverActionLabels(device.category);
      return [
        { action: "open", label: labels.open, role: "primary" },
        { action: "stop", label: "Stopp", role: "secondary" },
        { action: "close", label: labels.close, role: "secondary" },
      ];
    }

    case "LOCK":
      return [
        { action: "open", label: "Tür öffnen", role: "primary" },
        // Ein LOQED hat drei Riegelzustaende. Ohne den mittleren liesse sich
        // "zu, aber nicht abgeschlossen" nicht herstellen – genau der Zustand,
        // in dem eine Technikraumtuer normalerweise steht.
        ...(device.type === "LOQED_SMARTLOCK"
          ? [{ action: "reset" as const, label: "Entriegeln", role: "secondary" as const }]
          : []),
        { action: "deactivate", label: "Abschließen", role: "secondary" },
      ];

    case "VALVE":
      return [
        { action: "open", label: "Bewässern", role: "primary" },
        { action: "reset", label: "Stopp", role: "secondary" },
      ];

    case "LIGHT":
      return [
        { action: "open", label: "Anschalten", role: "primary" },
        { action: "reset", label: "Ausschalten", role: "secondary" },
      ];

    case "SWITCH":
      return [
        { action: "open", label: "Einschalten", role: "primary" },
        { action: "reset", label: "Ausschalten", role: "secondary" },
      ];

    case "PULSE":
      return [
        // Die Dauer steht am Geraet und laeuft im Shelly ab; "Ausschalten"
        // bricht sie vorzeitig ab.
        { action: "open", label: "Betätigen", role: "primary" },
        { action: "reset", label: "Ausschalten", role: "secondary" },
      ];

    case "TURNSTILE":
      return [
        { action: "open", label: "Öffnen", role: "primary" },
        // NOT-AUF haelt dauerhaft offen, bis zurueckgesetzt wird.
        { action: "emergency", label: "NOT-AUF", role: "danger" },
      ];

    case "DOOR":
    default:
      return [{ action: "open", label: "Öffnen", role: "primary" }];
  }
}

/**
 * Aktionen, die `POST /api/devices/[id]/action` fuer dieses Geraet annimmt.
 *
 * Bewusst weiter gefasst als `deviceControls`: Ein Schalter versteht auch
 * `emergency` und `deactivate` (beides schaltet ihn), ein Antrieb nimmt
 * `deactivate`/`reset` als Synonym fuer `stop`. Fuer die Bedienoberflaeche ist
 * `deviceControls` die richtige Liste, fuer die Frage "wird mein Aufruf
 * angenommen?" diese hier.
 */
export function availableDeviceActions(device: ControllableDevice): DeviceControlAction[] {
  if (isAudioDevice(device)) return ["open", "stop"];
  if (isCoverDevice(device)) return ["open", "stop", "close"];
  return ["open", "emergency", "deactivate", "reset"];
}

/**
 * Ergaenzt einen Geraetedatensatz um die Steuerungs-Angaben fuer die API.
 * Damit muss eine Integration weder Kategorie-Tabellen pflegen noch raten,
 * welche Knoepfe zu einem Geraet gehoeren.
 */
export function withDeviceControlInfo<T extends ControllableDevice>(device: T) {
  return {
    ...device,
    control: deviceControlModel(device),
    controls: deviceControls(device),
    actions: availableDeviceActions(device),
  };
}
