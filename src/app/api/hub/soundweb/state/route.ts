import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

const MAX_ITEMS = 500;

function parseAt(raw: unknown, fallback: Date): Date {
  const ms = Date.parse(String(raw ?? ""));
  return Number.isFinite(ms) ? new Date(ms) : fallback;
}

/**
 * POST (Hub, Token-Auth): Verbindungszustand der Prozessoren und aktuelle
 * Werte der abonnierten State Variables.
 * Body: { hub?: string, devices?: [{ id, connected, error?, at? }],
 *         values?: [{ controlId, value, at? }] }
 * Der Hub schickt Änderungen gebündelt und jede Minute den vollen Stand;
 * `lastSeenAt` ist damit zugleich das Lebenszeichen der Verbindung.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = (await request.json().catch(() => ({}))) as {
    hub?: unknown;
    devices?: unknown;
    values?: unknown;
  };
  const now = new Date();
  const hubName = typeof body.hub === "string" && body.hub.trim() ? body.hub.trim().slice(0, 80) : null;

  const devices = Array.isArray(body.devices) ? body.devices.slice(0, MAX_ITEMS) : [];
  const values = Array.isArray(body.values) ? body.values.slice(0, MAX_ITEMS) : [];

  let devicesUpdated = 0;
  for (const raw of devices) {
    const d = raw as { id?: unknown; connected?: unknown; error?: unknown; at?: unknown };
    const id = Number(d.id);
    if (!Number.isInteger(id)) continue;
    const connected = d.connected === true;
    const error =
      connected || d.error == null ? null : String(d.error).slice(0, 300);
    const result = await db.soundwebDevice.updateMany({
      where: { id, accountId: account.id },
      data: {
        connected,
        lastError: error,
        // Der Hub meldet sich – auch „getrennt“ ist eine frische Meldung.
        lastSeenAt: now,
        ...(hubName ? { hubName } : {}),
      },
    });
    devicesUpdated += result.count;
  }

  let valuesUpdated = 0;
  for (const raw of values) {
    const v = raw as { controlId?: unknown; value?: unknown; at?: unknown };
    const controlId = Number(v.controlId);
    const value = Number(v.value);
    if (!Number.isInteger(controlId) || !Number.isInteger(value)) continue;
    // 32-Bit-Rohwert; alles andere ist ein Protokollfehler, nicht ein Wert.
    if (value < -2_147_483_648 || value > 2_147_483_647) continue;
    const result = await db.soundwebControl.updateMany({
      where: { id: controlId, accountId: account.id },
      data: { value, valueAt: parseAt(v.at, now) },
    });
    valuesUpdated += result.count;
  }

  return NextResponse.json({ ok: true, devicesUpdated, valuesUpdated });
}
