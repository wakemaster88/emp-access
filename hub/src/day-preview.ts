/**
 * Tagesvorschau: Buchungen und Wetter aus der Cloud (GET /api/hub/day-preview),
 * Personal aus dem emp-control-Stand (staff.ts) und fuer heute, was der
 * Waechter bewacht (sentinelTodayLine). Der Assistent schickt sie morgens mit
 * dem Tagesbericht, auf /heute und /morgen sowie als Werkzeug.
 */
import { api, log } from "./config.js";
import { sentinelTodayLine } from "./agent/sentinel.js";
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

/** Zeile „Heute bewacht: …“; null, wenn sie sich nicht bilden laesst. */
function guardLine(): string | null {
  try {
    return sentinelTodayLine();
  } catch (e) {
    log(`Tagesvorschau: Bewachung: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Fertiger Text. offsetDays 0 = heute, 1 = morgen (Personal und Bewachung nur fuer heute). */
export async function dayPreviewText(offsetDays = 0): Promise<string> {
  const date = berlinDate(offsetDays);
  const guard = offsetDays === 0 ? guardLine() : null;
  try {
    const data = await fetchDayPreview(date);
    return formatDayPreview(data, offsetDays === 0 ? staffPreviewInput() : null, guard);
  } catch (e) {
    // Die Bewachung kommt aus dem Hub selbst und steht auch ohne Antwort der Cloud da.
    return `Tagesvorschau nicht verfügbar: ${e instanceof Error ? e.message : String(e)}` + (guard ? `\n\n${guard}` : "");
  }
}

/** Rohdaten fuer das Sprachmodell. */
export async function dayPreviewForAgent(offsetDays = 0): Promise<unknown> {
  const date = berlinDate(offsetDays);
  const data = await fetchDayPreview(date);
  return { ...data, staff: offsetDays === 0 ? staffPreviewInput() : "nur für heute verfügbar" };
}
