/**
 * Tagesvorschau: Buchungen und Wetter aus der Cloud (GET /api/hub/day-preview),
 * Personal aus dem emp-control-Stand (staff.ts). Der Assistent schickt sie
 * morgens mit dem Tagesbericht, auf /heute und /morgen sowie als Werkzeug.
 */
import { api } from "./config.js";
import { staffPreviewInput } from "./staff.js";
import { formatDayPreview, type DayPreviewData } from "./day-preview-format.js";

const berlinDate = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

export async function fetchDayPreview(date?: string): Promise<DayPreviewData> {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  const res = await api(`/api/hub/day-preview${q}`, { signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  if (typeof body.date !== "string" || !body.bookings) throw new Error("Antwort ohne Buchungen");
  return body as unknown as DayPreviewData;
}

/** Fertiger Text. offsetDays 0 = heute, 1 = morgen (Personal nur fuer heute). */
export async function dayPreviewText(offsetDays = 0): Promise<string> {
  const date = berlinDate(offsetDays);
  try {
    const data = await fetchDayPreview(date);
    return formatDayPreview(data, offsetDays === 0 ? staffPreviewInput() : null);
  } catch (e) {
    return `Tagesvorschau nicht verfügbar: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Rohdaten fuer das Sprachmodell. */
export async function dayPreviewForAgent(offsetDays = 0): Promise<unknown> {
  const date = berlinDate(offsetDays);
  const data = await fetchDayPreview(date);
  return { ...data, staff: offsetDays === 0 ? staffPreviewInput() : "nur für heute verfügbar" };
}
