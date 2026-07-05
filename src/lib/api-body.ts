import type { NextRequest } from "next/server";

/**
 * Request-Body tolerant einlesen: bevorzugt JSON, akzeptiert aber auch
 * form-encodierte Bodies (application/x-www-form-urlencoded), wie sie
 * manche externen Tools (z. B. Telefonassistenten) senden.
 * Liefert null, wenn kein verwertbarer Body vorhanden ist – die Route
 * antwortet dann mit 400 statt eines unkontrollierten 500ers.
 */
export async function readRequestBody(
  request: NextRequest
): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (!raw.trim()) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return coerceBooleans(parsed as Record<string, unknown>);
    }
    return null;
  } catch {
    // kein JSON – als Form-Daten versuchen
  }

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return null;
  }

  const params = new URLSearchParams(raw);
  const obj: Record<string, unknown> = {};
  for (const [key, value] of params) obj[key] = value;
  return Object.keys(obj).length > 0 ? coerceBooleans(obj) : null;
}

/// Form-Daten liefern nur Strings – "true"/"false" für Boolean-Felder
/// (z. B. pickedUp) in echte Booleans umwandeln.
function coerceBooleans(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(obj)) {
    if (obj[key] === "true") obj[key] = true;
    else if (obj[key] === "false") obj[key] = false;
  }
  return obj;
}
