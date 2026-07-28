import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  shellyBaseId,
  shellyCloudAllStatuses,
  shellyLocalStatusMap,
  shellySwitchIndex,
  shellySwitchState,
  type ShellyDeviceStatusMap,
} from "@/lib/shelly-cloud";
import {
  coverChannels,
  coverIsMoving,
  isCoverDevice,
  readCoverStatus,
  type CoverMotion,
} from "@/lib/shelly-cover";
import { readSensorReadings, type SensorReading } from "@/lib/shelly-sensor";

export interface ShellyCoverStatus {
  motion: CoverMotion;
  /// Fahrposition in Prozent (100 = offen); null, wenn der Antrieb sie nicht kennt.
  position: number | null;
  upOn: boolean | null;
  downOn: boolean | null;
  /// false = Antrieb läuft über zwei Relais, aber die Kanalzuordnung fehlt.
  configured: boolean;
  /**
   * Wie der Shelly den Antrieb führt: `cover` = als Rollladen im Gerät selbst,
   * `relays` = zwei getrennte Relais. Bestimmt, welche Angaben belegt sind.
   */
  mode: "cover" | "relays";
}

export interface ShellyStatus {
  online: boolean;
  output: boolean | null;   // true = on, false = off, null = unknown
  power?: number;           // current power in W
  source: "local" | "cloud" | "unavailable";
  /// Nur bei Antrieben (MARKISE/ROLLTOR) gesetzt.
  cover?: ShellyCoverStatus;
  /// Messwerte, die das Gerät meldet (Türkontakt, Temperatur, Batterie …).
  readings?: SensorReading[];
}

const UNAVAILABLE: ShellyStatus = { online: false, output: null, source: "unavailable" };

/**
 * Ein Shelly im selben Netz antwortet in wenigen Millisekunden. Ist die
 * hinterlegte Adresse von hier aus gar nicht erreichbar, darf der Versuch die
 * Anzeige nicht ausbremsen – während einer Fahrt wird der Status alle drei
 * Sekunden neu geholt.
 */
const LOCAL_TIMEOUT_MS = 1500;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const device = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId!, type: "SHELLY" },
  });

  if (!device) return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 404 });

  const isCover = isCoverDevice(device);

  const build = (
    status: ShellyDeviceStatusMap,
    online: boolean,
    source: "local" | "cloud",
  ): ShellyStatus => {
    // Messwerte haengen am Geraet, nicht am Bedienmodell: Auch ein Schalter
    // darf ein Thermometer mitbringen.
    const readings = readSensorReadings(status);
    const extra = readings.length > 0 ? { readings } : {};

    if (isCover) {
      // Ob zwei Relais oder ein Cover-Profil vorliegt, steht im Gerätestatus –
      // nicht in der Konfiguration.
      const cover = readCoverStatus(status, device);
      return {
        online,
        output: coverIsMoving(cover.motion),
        power: cover.power,
        source,
        ...extra,
        cover: {
          motion: cover.motion,
          position: cover.position,
          upOn: cover.upOn,
          downOn: cover.downOn,
          configured: cover.configured,
          mode: cover.mode,
        },
      };
    }

    const sw = shellySwitchState(status, shellySwitchIndex(device.shellyId));
    return { online, output: sw.output, power: sw.power, source, ...extra };
  };

  // 1. Lokale IP (Gen2 Shelly.GetStatus, sonst Gen1 /status)
  if (device.ipAddress) {
    const local = await shellyLocalStatusMap(device.ipAddress, LOCAL_TIMEOUT_MS);
    if (local) return NextResponse.json(build(local, true, "local"));
  }

  // 2. Shelly Cloud – gemeinsamer, gecachter all_status-Abruf statt einzelner
  //    /device/status-Calls (die laufen bei mehreren Geraeten in HTTP 429).
  const baseId = shellyBaseId(device.shellyId);
  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "SHELLY" },
  });

  if (config?.token && config?.baseUrl && baseId) {
    const cloudStatuses = await shellyCloudAllStatuses(config.baseUrl, config.token);
    const entry = cloudStatuses?.get(baseId) ?? cloudStatuses?.get(baseId.toLowerCase());
    if (entry) return NextResponse.json(build(entry.status, entry.online, "cloud"));
  }

  // Ohne Antwort vom Gerät bleibt das Profil offen; `configured` bezieht sich
  // deshalb nur darauf, ob wenigstens der Relais-Betrieb eingerichtet wäre.
  return NextResponse.json(
    isCover
      ? {
          ...UNAVAILABLE,
          cover: {
            motion: "unknown" as const,
            position: null,
            upOn: null,
            downOn: null,
            configured: coverChannels(device) !== null,
            mode: "relays" as const,
          },
        }
      : UNAVAILABLE,
  );
}
