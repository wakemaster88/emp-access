/**
 * Same-Origin-Prüfung für zustandsändernde Routen (Tür, Licht, Sirene).
 *
 * Der Kiosk-Browser zeigt auch fremde Seiten (iFrame-Widgets). Ohne diese
 * Prüfung könnte so eine Seite per `fetch`/Formular an `/api/doorbird/open`
 * POSTen — der Browser hängt das Login-Cookie an. Browser schicken bei
 * solchen Cross-Origin-Requests immer einen `Origin`-Header; stimmt der
 * nicht mit dem eigenen Host überein, lehnen wir ab.
 *
 * Aufrufe ohne `Origin` (Sidecar, curl, Skripte) sind keine Browser-Requests
 * von fremden Seiten und bleiben erlaubt.
 */

export function isSameOrigin(opts: {
  origin: string | null | undefined;
  host: string | null | undefined;
  /** Vom Reverse-Proxy gesetzt, falls einer davor hängt. */
  forwardedHost?: string | null;
}): boolean {
  const { origin, host, forwardedHost } = opts;
  if (!origin) return true;
  let originHost: string;
  try {
    // "null" (sandboxed iFrame, file://) und Müll landen im catch.
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  if (!originHost) return false;
  const candidates = [host, ...(forwardedHost ?? "").split(",")]
    .map((h) => (h ?? "").trim().toLowerCase())
    .filter(Boolean);
  return candidates.includes(originHost);
}

/**
 * Gibt `null` zurück wenn erlaubt, sonst eine fertige 403-Response —
 * gleiche Aufruf-Konvention wie `requireAuth()`.
 */
export function requireSameOrigin(req: Request): Response | null {
  const ok = isSameOrigin({
    origin: req.headers.get("origin"),
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
  });
  if (ok) return null;
  return Response.json({ error: "cross-origin request rejected" }, { status: 403 });
}

/** Ist der Content-Type `application/json` (Parameter wie charset erlaubt)? */
export function isJsonContentType(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * Für schreibende Config-Routen mit JSON-Body: Same-Origin wie oben und
 * zusätzlich `Content-Type: application/json`. Einfache Formular-Requests
 * (ohne Preflight) haben einen anderen Content-Type und werden abgelehnt.
 * Gibt `null` zurück wenn erlaubt, sonst eine fertige 403/415-Response.
 */
export function requireSameOriginJson(req: Request): Response | null {
  const crossOrigin = requireSameOrigin(req);
  if (crossOrigin) return crossOrigin;
  if (isJsonContentType(req.headers.get("content-type"))) return null;
  return Response.json(
    { error: "Content-Type application/json erwartet" },
    { status: 415 },
  );
}
