/**
 * Messwerte eines Geraets aus seinem Shelly-Status lesen.
 *
 * Nicht jedes Geraet in der Shelly Cloud ist ein Relais. Neben Schaltern und
 * Antrieben haengen dort Tuerkontakte, Thermometer, Taster und ueber die
 * LOQED-Anbindung auch Schloesser. Fuer die hat die Oberflaeche bisher nur
 * "Online" angezeigt: `shellySwitchState` findet bei ihnen keinen Ausgang und
 * meldet `output: null`, also blieb die eigentliche Aussage – Tuer offen,
 * Batterie schwach, Riegel zu – unsichtbar.
 *
 * Dieses Modul uebersetzt die Statuskomponenten in fertig beschriftete
 * Messwerte. Bewusst ohne Netzwerk- und Prisma-Code, damit die Oberflaechen es
 * direkt importieren koennen.
 */

import { loqedBoltNeedsAttention, loqedBoltStateLabel } from "./loqed-constants";
import type { ShellyDeviceStatusMap } from "./shelly-cloud";

export type SensorReadingKind =
  /// Tuer-/Fensterkontakt: offen oder geschlossen.
  | "contact"
  /// Riegelzustand eines Schlosses.
  | "lock"
  | "temperature"
  | "humidity"
  | "illuminance"
  | "motion"
  | "battery";

export interface SensorReading {
  kind: SensorReadingKind;
  /// Beschriftung in der Landessprache, z. B. "Tür".
  label: string;
  /// Fertig formatierter Wert samt Einheit, z. B. "23,8 °C".
  value: string;
  /**
   * Hebt Werte hervor, die Aufmerksamkeit brauchen:
   *  - `warn`  beachten (Tür steht offen, Batterie geht zur Neige)
   *  - `alert` handeln (Batterie fast leer)
   */
  emphasis?: "warn" | "alert";
}

/** Batteriestand in Prozent, ab dem die Anzeige warnt bzw. Alarm gibt. */
const BATTERY_WARN_PERCENT = 25;
const BATTERY_ALERT_PERCENT = 10;

/**
 * Spannung, ab der eine Zelle noch Ladung hat. Dient allein dazu, eine
 * unglaubwuerdige Prozentangabe zu erkennen – siehe `readBattery`.
 */
const BATTERY_PLAUSIBLE_VOLTS = 2.5;

function decimal(value: number, digits = 1): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: digits });
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Komponente mit der kleinsten Nummer einer Bauart (`temperature:0`,
 * `temperature:100`, …).
 *
 * Die Nummern sind nicht auf 0 bis 4 beschraenkt: Ein angesteckter Zusatzfühler
 * meldet sich als `temperature:100` und hoeher. Deshalb werden die vorhandenen
 * Schluessel durchsucht statt fester Nummern geraten – und die kleinste
 * genommen, damit die Auswahl nicht von der Schluesselreihenfolge der
 * JSON-Antwort abhaengt.
 */
function component<T>(status: ShellyDeviceStatusMap, prefix: string): T | null {
  let lowest: number | null = null;
  for (const key of Object.keys(status)) {
    if (!key.startsWith(`${prefix}:`)) continue;
    const id = Number(key.slice(prefix.length + 1));
    if (Number.isInteger(id) && (lowest === null || id < lowest)) lowest = id;
  }
  if (lowest === null) return null;
  const entry = status[`${prefix}:${lowest}`];
  return entry === undefined || entry === null ? null : (entry as T);
}

function readContact(status: ShellyDeviceStatusMap): SensorReading | null {
  const window = component<{ open?: unknown }>(status, "window");
  const open = typeof window?.open === "boolean"
    ? window.open
    // Gen1-Tuerkontakte melden stattdessen `sensor.state` als Text.
    : (() => {
        const sensor = status.sensor as { state?: unknown } | undefined;
        if (sensor?.state === "open") return true;
        if (sensor?.state === "close") return false;
        return null;
      })();

  if (open === null) return null;
  return {
    kind: "contact",
    label: "Tür",
    value: open ? "offen" : "geschlossen",
    ...(open ? { emphasis: "warn" as const } : {}),
  };
}

/**
 * Riegelzustand eines Schlosses, das ueber die Shelly Cloud mitgelesen wird.
 * Beschriftung und Bewertung kommen aus `loqed-constants`, damit derselbe
 * Zustand hier und in der LOQED-Anbindung gleich heisst.
 */
function readLock(status: ShellyDeviceStatusMap): SensorReading | null {
  const bolt = status.bolt_state;
  if (typeof bolt !== "string") return null;
  return {
    kind: "lock",
    label: "Riegel",
    value: loqedBoltStateLabel(bolt),
    ...(loqedBoltNeedsAttention(bolt) ? { emphasis: "warn" as const } : {}),
  };
}

function readBattery(status: ShellyDeviceStatusMap): SensorReading | null {
  const power = component<{ battery?: { percent?: unknown; low?: unknown; V?: unknown } }>(
    status,
    "devicepower",
  );
  // Gen1 meldet `bat`, die LOQED-Anbindung `battery_percentage`.
  const gen1 = status.bat as { value?: unknown; voltage?: unknown } | undefined;

  const percent =
    num(power?.battery?.percent) ?? num(gen1?.value) ?? num(status.battery_percentage);
  const volts = num(power?.battery?.V) ?? num(gen1?.voltage);
  const low = power?.battery?.low === true;

  if (percent === null && volts === null) return null;

  // Manche Taster melden dauerhaft 0 %, obwohl die Zelle noch Spannung hat.
  // Daraus einen Alarm zu machen waere ein Fehlalarm – dann ist die Spannung
  // die ehrlichere Angabe.
  const percentIsCredible =
    percent !== null && !(percent <= 0 && volts !== null && volts >= BATTERY_PLAUSIBLE_VOLTS);

  if (!percentIsCredible) {
    // Ohne verlaesslichen Prozentwert bleibt nur die Spannung. Ob die niedrig
    // ist, haengt an der Zellchemie, die der Status nicht verraet – deshalb
    // wird sie nur genannt und nicht bewertet. Ausnahme: Meldet das Gerät
    // selbst "low", zaehlt dieses Urteil.
    return {
      kind: "battery",
      label: "Batterie",
      value: `${decimal(volts!, 2)} V`,
      ...(low ? { emphasis: "alert" as const } : {}),
    };
  }

  const emphasis =
    low || percent! <= BATTERY_ALERT_PERCENT
      ? ("alert" as const)
      : percent! <= BATTERY_WARN_PERCENT
        ? ("warn" as const)
        : undefined;

  return {
    kind: "battery",
    label: "Batterie",
    value: `${decimal(percent!, 0)} %`,
    ...(emphasis ? { emphasis } : {}),
  };
}

/**
 * Alle Messwerte eines Geraetestatus in Anzeigereihenfolge: erst die Aussage
 * ueber den Zustand (Tür, Riegel, Bewegung), dann Umgebungswerte, zuletzt die
 * Batterie. Eine leere Liste heisst: Dieses Geraet meldet keine Messwerte.
 */
export function readSensorReadings(status: ShellyDeviceStatusMap): SensorReading[] {
  const readings: SensorReading[] = [];

  const contact = readContact(status);
  if (contact) readings.push(contact);

  const lock = readLock(status);
  if (lock) readings.push(lock);

  const motion = component<{ motion?: unknown }>(status, "motion");
  if (typeof motion?.motion === "boolean") {
    readings.push({
      kind: "motion",
      label: "Bewegung",
      value: motion.motion ? "erkannt" : "keine",
      ...(motion.motion ? { emphasis: "warn" as const } : {}),
    });
  }

  // Gen2/BLE fuehren Temperatur und Feuchte als eigene Komponenten, Gen1 als
  // `tmp`/`hum` direkt im Status.
  const tempC =
    num(component<{ tC?: unknown }>(status, "temperature")?.tC) ??
    num((status.tmp as { value?: unknown } | undefined)?.value);
  if (tempC !== null) {
    readings.push({ kind: "temperature", label: "Temperatur", value: `${decimal(tempC)} °C` });
  }

  const humidity =
    num(component<{ rh?: unknown }>(status, "humidity")?.rh) ??
    num((status.hum as { value?: unknown } | undefined)?.value);
  if (humidity !== null) {
    readings.push({ kind: "humidity", label: "Luftfeuchte", value: `${decimal(humidity, 0)} %` });
  }

  const lux =
    num(component<{ lux?: unknown }>(status, "illuminance")?.lux) ??
    num((status.lux as { value?: unknown } | undefined)?.value);
  if (lux !== null) {
    readings.push({ kind: "illuminance", label: "Helligkeit", value: `${decimal(lux, 0)} lx` });
  }

  const battery = readBattery(status);
  if (battery) readings.push(battery);

  return readings;
}
