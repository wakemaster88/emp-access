import { empAccessGetJson } from "./emp-access-client";

/**
 * Zutritts-Scans aus emp-access.
 *
 * Die Cloud liefert pro Scan das komplette Ticket inklusive Klarnamen,
 * Geburtsdatum und Foto. Hier wird bewusst auf das reduziert, was Kachel
 * und Drehkreuz-Abgleich brauchen — der Rest verlässt den Server nicht.
 */

export type ScanRow = {
  id: number;
  ts: number;
  code: string;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  device: string;
  deviceId: number | null;
  ticket: string | null;
  ticketType: string | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function toRow(raw: Record<string, unknown>): ScanRow | null {
  const id = typeof raw.id === "number" ? raw.id : null;
  if (id === null) return null;
  const device = (raw.device ?? {}) as Record<string, unknown>;
  const ticket = (raw.ticket ?? {}) as Record<string, unknown>;
  const result = str(raw.result);
  const ts = Date.parse(String(raw.scanTime ?? raw.createdAt ?? ""));
  // Die Geräte-ID steht je nach Endpunkt flach oder im verschachtelten Gerät.
  const nestedId = typeof device.id === "number" ? device.id : null;
  return {
    id,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    code: str(raw.code) ?? "—",
    result:
      result === "GRANTED" || result === "DENIED" || result === "PROTECTED"
        ? result
        : "DENIED",
    device: str(device.name) ?? "Unbekanntes Gerät",
    deviceId: typeof raw.deviceId === "number" ? raw.deviceId : nestedId,
    ticket: str(ticket.name),
    ticketType: str(ticket.ticketTypeName),
  };
}

export async function fetchScanRows(
  baseUrl: string,
  apiToken: string,
  limit: number,
): Promise<ScanRow[]> {
  const json = await empAccessGetJson(
    baseUrl,
    apiToken,
    `/api/scans?limit=${limit}`,
  );
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown })?.data)
      ? ((json as { data: unknown[] }).data as unknown[])
      : [];
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map(toRow)
    .filter((r): r is ScanRow => r !== null);
}
