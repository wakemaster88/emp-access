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

/**
 * Die Cloud gibt pro Anfrage höchstens so viele Zeilen heraus, egal welches
 * Limit man schickt. Datumsfilter ignoriert sie, `offset` wertet sie aus.
 */
const CLOUD_PAGE_SIZE = 200;

export async function fetchScanRows(
  baseUrl: string,
  apiToken: string,
  limit: number,
  offset = 0,
): Promise<ScanRow[]> {
  const q = `/api/scans?limit=${limit}${offset > 0 ? `&offset=${offset}` : ""}`;
  const json = await empAccessGetJson(baseUrl, apiToken, q);
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

/**
 * Holt so viele Scans, bis der gewünschte Zeitraum abgedeckt ist — über
 * mehrere Seiten hinweg, weil eine Anfrage nur bis zu {@link CLOUD_PAGE_SIZE}
 * Zeilen liefert und die über alle Geräte des Standorts gemeinsam zählen.
 *
 * `maxPages` begrenzt die Last auf der Cloud: Beim Nachtragen alter Tage
 * würde man sonst im Zweifel das ganze Archiv durchblättern.
 */
export async function fetchScanRowsSince(
  baseUrl: string,
  apiToken: string,
  since: number,
  maxPages = 10,
): Promise<ScanRow[]> {
  const all: ScanRow[] = [];
  const seen = new Set<number>();
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchScanRows(
      baseUrl,
      apiToken,
      CLOUD_PAGE_SIZE,
      page * CLOUD_PAGE_SIZE,
    );
    if (rows.length === 0) break;
    let oldest = Infinity;
    for (const r of rows) {
      if (r.ts < oldest) oldest = r.ts;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      all.push(r);
    }
    // Weit genug zurück, oder die Cloud hat nichts mehr.
    if (oldest <= since || rows.length < CLOUD_PAGE_SIZE) break;
  }
  return all.sort((a, b) => b.ts - a.ts);
}
