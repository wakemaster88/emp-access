import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { soundwebDeviceWrite } from "@/lib/soundweb";

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
 * Der Hub schickt Änderungen gebündelt und jede Minute den Stand der
 * verbundenen Geräte, getrennte bei einem Wechsel und alle 10 Minuten;
 * `lastSeenAt` ist damit zugleich das Lebenszeichen der Verbindung.
 * Je Gerät eine Schreibung (src/lib/soundweb.ts, soundwebDeviceWrite); den
 * gespeicherten Trennzeitpunkt liest eine Abfrage vorab für alle.
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

  const reports = devices
    .map((raw) => raw as { id?: unknown; connected?: unknown; error?: unknown; at?: unknown })
    .map((d) => ({ d, id: Number(d.id) }))
    .filter((x) => Number.isInteger(x.id));
  const stored =
    reports.length > 0
      ? await db.soundwebDevice.findMany({
          where: { accountId: account.id, id: { in: [...new Set(reports.map((x) => x.id))] } },
          select: { id: true, disconnectedAt: true },
        })
      : [];
  const disconnectedAt = new Map(stored.map((s) => [s.id, s.disconnectedAt]));

  let devicesUpdated = 0;
  for (const { d, id } of reports) {
    // Unbekanntes Geraet (anderes Konto oder geloescht): nichts schreiben.
    if (!disconnectedAt.has(id)) continue;
    const result = await db.soundwebDevice.updateMany({
      where: { id, accountId: account.id },
      // Verbunden vergisst den Trennzeitpunkt (Basis der Ausfall-Meldung),
      // die erste „getrennt“-Meldung setzt ihn, spaetere lassen ihn stehen.
      data: soundwebDeviceWrite(d, { disconnectedAt: disconnectedAt.get(id) ?? null }, now, hubName),
    });
    // Nach einer gemeldeten Schreibung gilt der Trennzeitpunkt als gesetzt
    // (zwei Meldungen desselben Geraets in einem Aufruf).
    if (d.connected !== true && !disconnectedAt.get(id)) disconnectedAt.set(id, now);
    if (d.connected === true) disconnectedAt.set(id, null);
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
