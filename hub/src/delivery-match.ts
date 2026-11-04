/**
 * Reine Hilfsfunktionen der Lieferdienst-Erkennung (ohne Hub-Konfiguration,
 * damit sie sich ohne .env testen lassen). Siehe delivery.ts.
 */

/** Marke → Wörter, die als eigenes Wort in der Aufschrift stehen müssen. */
const BRANDS: Array<{ brand: string; words: string[]; contains?: string[] }> = [
  { brand: "DHL", words: ["DHL"], contains: ["DEUTSCHEPOST", "DHLEXPRESS"] },
  { brand: "UPS", words: ["UPS"] },
  { brand: "GLS", words: ["GLS"] },
  { brand: "DPD", words: ["DPD"] },
  { brand: "HERMES", words: ["HERMES"] },
  { brand: "AMAZON", words: ["AMAZON"], contains: ["AMAZONPRIME", "AMAZONLOGISTICS"] },
];

/** Wochentage mit Öffnung, 1 = Mo … 7 = So. Standard Mo–Sa. */
const OPEN_DAYS = (process.env.HUB_DELIVERY_DAYS || "1,2,3,4,5,6")
  .split(",")
  .map((d) => Number(d.trim()))
  .filter((d) => d >= 1 && d <= 7);

/** Marke in den erkannten Texten finden (Wortgrenzen, Groß/klein egal). */
export function matchDeliveryBrand(texts: string[]): string | null {
  const words = new Set<string>();
  const blobs: string[] = [];
  for (const t of texts) {
    const up = t.toUpperCase();
    for (const w of up.split(/[^A-Z0-9]+/)) if (w) words.add(w);
    blobs.push(up.replace(/[^A-Z0-9]/g, ""));
  }
  for (const b of BRANDS) {
    if (b.words.some((w) => words.has(w))) return b.brand;
    if (b.contains?.some((c) => blobs.some((x) => x.includes(c)))) return b.brand;
  }
  return null;
}

function minutes(hhmm: string | null | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

/** Liegt `now` (lokale Zeit des Hubs) im Öffnungsfenster? */
export function inDeliveryWindow(
  from: string | null | undefined,
  to: string | null | undefined,
  now = new Date(),
  days = OPEN_DAYS
): boolean {
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  if (!days.includes(dow)) return false;
  const start = minutes(from, 7 * 60);
  const end = minutes(to, 20 * 60);
  const cur = now.getHours() * 60 + now.getMinutes();
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

