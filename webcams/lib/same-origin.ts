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
