/**
 * Ausgeloeste Regeln aus der Antwort der Cloud auf eine Ereignis-Meldung
 * (`POST /api/hub/camera-events`): je Regel eine Log-Zeile mit Kamera,
 * Ereignisart und Antwortzeit der Cloud. Zusammen mit `eventAt`, `startedAt`
 * und `triggeredAt` im Regel-Verlauf zeigt das, wie lange es vom Ereignis bis
 * zum Schalten dauert. Reine Logik.
 *
 * Nennt die Antwort keine Regeln (aeltere Cloud), bleibt es beim Zaehlen.
 */

export interface TriggeredRule {
  ruleId: number;
  name: string;
  camera: string;
  type: string;
  /** "ok", "uebergeben" (Hue, Kamera: an den Hub) oder "fehler"; null, wenn unbekannt. */
  state: string | null;
  /** Dauer des Laufs in der Cloud. */
  durationMs: number | null;
}

const TYPE_LABEL: Record<string, string> = {
  PERSON: "Person",
  VEHICLE: "Fahrzeug",
  MOTION: "Bewegung",
  DOORBELL: "Klingel",
  ANIMAL: "Tier",
};

const STATE_LABEL: Record<string, string> = {
  ok: "erledigt",
  uebergeben: "an Hub übergeben",
  fehler: "fehlgeschlagen",
};

/** Ausgeloeste Regeln der Antwort; null, wenn die Antwort keine nennt. */
export function parseTriggeredRules(body: unknown): TriggeredRule[] | null {
  const raw = (body as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(raw)) return null;
  const out: TriggeredRule[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object" || typeof r.ruleId !== "number" || typeof r.name !== "string") continue;
    out.push({
      ruleId: r.ruleId,
      name: r.name,
      camera: typeof r.camera === "string" && r.camera ? r.camera : typeof r.cameraId === "number" ? `Kamera #${r.cameraId}` : "Kamera",
      type: typeof r.type === "string" ? r.type : "",
      state: typeof r.state === "string" ? r.state : null,
      durationMs: typeof r.durationMs === "number" && Number.isFinite(r.durationMs) ? r.durationMs : null,
    });
  }
  return out;
}

function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace(".", ",")} s`;
}

/** „Regel „Licht“ ausgelöst: Einfahrt, Person, Antwort der Cloud nach 1,4 s (Lauf 0,9 s, erledigt)“ */
export function triggeredRuleLine(rule: TriggeredRule, responseMs: number): string {
  const type = TYPE_LABEL[rule.type] ?? (rule.type || "Ereignis");
  const run = [
    rule.durationMs != null ? `Lauf ${seconds(rule.durationMs)}` : null,
    rule.state ? (STATE_LABEL[rule.state] ?? rule.state) : null,
  ].filter(Boolean);
  return `Regel „${rule.name}“ ausgelöst: ${rule.camera}, ${type}, Antwort der Cloud nach ${seconds(responseMs)}${
    run.length ? ` (${run.join(", ")})` : ""
  }`;
}

/**
 * Was der Hub mit der Antwort macht: Log-Zeilen je genannter Regel, oder,
 * wenn die Antwort nur eine Zahl kennt (aeltere Cloud), wie viele Regeln er
 * nur zaehlt.
 */
export function ruleReport(body: unknown, responseMs: number): { lines: string[]; unnamed: number } {
  const rules = parseTriggeredRules(body);
  if (rules) return { lines: rules.map((r) => triggeredRuleLine(r, responseMs)), unnamed: 0 };
  const n = (body as { rulesTriggered?: unknown } | null)?.rulesTriggered;
  return { lines: [], unnamed: typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0 };
}
