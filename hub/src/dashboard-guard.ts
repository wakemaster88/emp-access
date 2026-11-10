/**
 * Schutz der schreibenden Dashboard-Routen gegen CSRF und DNS-Rebinding –
 * reine Logik ohne Hub-Konfiguration (testbar, dashboard-guard.test.ts).
 *
 * Hintergrund: Anfragen von 127.0.0.1 brauchen kein Token. Ohne diese
 * Pruefung konnte jede Webseite, die im Browser des Hub-Rechners offen ist,
 * z. B. {"type":"DOORBIRD_OPEN"} an http://127.0.0.1:8787/api/action schicken
 * (als „einfache“ Anfrage ohne Preflight) oder ihren eigenen Namen per DNS
 * auf 127.0.0.1 umbiegen.
 *
 * Fuer jede Anfrage ausser GET/HEAD gilt deshalb:
 *  1. Host: muss einer der eigenen Namen/Adressen des Hubs sein – ausser die
 *     Anfrage bringt ein gueltiges Token mit. Ein umgebogener fremder Name hat
 *     weder Token noch Cookie; Geraete im LAN mit Token duerfen den Hub
 *     weiter unter jedem Namen erreichen.
 *  2. Origin: wenn vorhanden, derselbe Host wie die Anfrage (gleicher
 *     Ursprung) oder das Dashboard selbst auf localhost.
 *  3. Content-Type: application/json. Das erzwingt im Browser einen
 *     Preflight, den der Hub fremden Seiten nie beantwortet.
 *
 * GET bleibt unberuehrt – auch der Shelly-H&T-Webhook /api/climate/report,
 * der per GET meldet.
 */

export interface GuardRequest {
  method: string;
  pathname: string;
  /** Host-Header der Anfrage. */
  host: string | undefined;
  /** Origin-Header (Browser schicken ihn bei jeder schreibenden Anfrage). */
  origin: string | undefined;
  contentType: string | undefined;
  /** Gueltiges Token in Adresse, Header oder Cookie – nicht bloss Loopback. */
  tokenAuthenticated: boolean;
}

export interface GuardConfig {
  /** Port des Dashboards. */
  port: number;
  /** Erlaubte Hostnamen (klein, ohne Port; IPv6 in eckigen Klammern). */
  allowedHosts: ReadonlySet<string>;
}

export type GuardReason = "host" | "origin" | "content-type";

export type GuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 415; reason: GuardReason; error: string };

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Routen mit eigenem Inhaltstyp. Alles andere muss application/json schicken –
 * insbesondere /api/action (Tueroeffner) und die Geraete-/Regel-Routen.
 */
const CONTENT_TYPES_BY_PATH: Record<string, readonly string[] | "any"> = {
  // WebRTC-Angebot der Kamera-Zentrale. application/sdp ist ebenfalls keine
  // „einfache“ Anfrage, der Browser fragt fremde Seiten also vorher.
  "/api/go2rtc/webrtc": ["application/sdp"],
  // Messwert-Eingang fuer Fuehler (Shelly H&T): Geraete schicken keinen
  // JSON-Typ. Host- und Origin-Pruefung gelten trotzdem.
  "/api/climate/report": "any",
};

/** Hostname aus einem Host-Header: klein, ohne Port, ohne Punkt am Ende. */
export function hostnameOf(hostHeader: string | undefined): string | null {
  const s = (hostHeader ?? "").trim().toLowerCase();
  if (!s || /[\s/\\@?#]/.test(s)) return null;
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end < 0) return null;
    const rest = s.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return null;
    return s.slice(0, end + 1);
  }
  const m = s.match(/^([^:]+)(?::\d{1,5})?$/);
  if (!m) return null;
  const name = m[1].replace(/\.$/, "");
  return name || null;
}

/**
 * Eigene Namen und Adressen des Hubs fuer die Host-Pruefung.
 * `extra`: frei konfigurierte Namen (HUB_DASHBOARD_ALLOWED_HOSTS,
 * HUB_DASHBOARD_TLS_NAMES), durch Komma oder Leerzeichen getrennt.
 */
export function buildAllowedHosts(opts: {
  hostname: string;
  addresses: string[];
  extra?: string[];
}): Set<string> {
  const out = new Set<string>(LOOPBACK_HOSTS);
  const add = (raw: string) => {
    let v = raw.trim().toLowerCase();
    if (!v) return;
    // IPv6 ohne Klammern (aus networkInterfaces): Zonen-Suffix weg, klammern.
    if (!v.startsWith("[") && v.split(":").length > 2) v = `[${v.split("%")[0]}]`;
    const h = hostnameOf(v);
    if (h) out.add(h);
  };
  const full = opts.hostname.trim().toLowerCase();
  if (full) {
    add(full);
    const short = full.split(".")[0];
    if (short) {
      add(short);
      add(`${short}.local`);
    }
  }
  for (const a of opts.addresses) add(a);
  for (const e of opts.extra ?? []) for (const part of e.split(/[\s,]+/)) add(part);
  return out;
}

function mimeOf(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export function checkDashboardRequest(req: GuardRequest, cfg: GuardConfig): GuardResult {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return { ok: true };

  // 1) Host
  const host = hostnameOf(req.host);
  if (!host) {
    return { ok: false, status: 403, reason: "host", error: "Anfrage abgelehnt: Host-Header fehlt oder ist ungültig" };
  }
  if (!req.tokenAuthenticated && !cfg.allowedHosts.has(host)) {
    return {
      ok: false,
      status: 403,
      reason: "host",
      error: `Anfrage abgelehnt: Host „${host}“ ist für das Dashboard nicht freigegeben (HUB_DASHBOARD_ALLOWED_HOSTS in hub/.env)`,
    };
  }

  // 2) Origin
  if (req.origin !== undefined) {
    let origin: URL | null = null;
    try {
      origin = new URL(req.origin);
    } catch {
      origin = null; // auch "null" (sandboxed iframe, file://)
    }
    const sameHost = !!origin && origin.host.toLowerCase() === (req.host ?? "").trim().toLowerCase();
    // localhost, 127.0.0.1 und [::1] sind derselbe Hub – aber nur, wenn auch
    // die Anfrage selbst an Loopback ging (sonst waere es das localhost des Clients).
    const originPort = origin ? origin.port || (origin.protocol === "https:" ? "443" : "80") : "";
    const ownLoopback =
      !!origin &&
      LOOPBACK_HOSTS.has(host) &&
      LOOPBACK_HOSTS.has(origin.hostname.toLowerCase()) &&
      originPort === String(cfg.port);
    if (!origin || !/^https?:$/.test(origin.protocol) || !(sameHost || ownLoopback)) {
      return {
        ok: false,
        status: 403,
        reason: "origin",
        error: "Anfrage abgelehnt: fremder Ursprung (Origin passt nicht zum Dashboard)",
      };
    }
  }

  // 3) Content-Type
  const allowed = CONTENT_TYPES_BY_PATH[req.pathname] ?? ["application/json"];
  if (allowed !== "any" && !allowed.includes(mimeOf(req.contentType))) {
    return {
      ok: false,
      status: 415,
      reason: "content-type",
      error: `Anfrage abgelehnt: Content-Type muss ${allowed.join(" oder ")} sein`,
    };
  }

  return { ok: true };
}
