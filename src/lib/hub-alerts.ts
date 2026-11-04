/**
 * Befunde vom Hub (z. B. VLAN-Fehler an Switch-Ports): Der Hub meldet je
 * Quelle die komplette aktuelle Liste. Neu → Meldung, nicht mehr dabei →
 * Entwarnung. Der Zustand liegt in der Cloud (HubAlert), damit ein
 * Hub-Neustart keine Meldungen wiederholt.
 */
export interface ReportedAlert {
  key: string;
  title: string;
  detail?: string | null;
  severity?: string;
}

export interface StoredAlert {
  key: string;
  resolvedAt: Date | null;
}

const KEY_RE = /^[\w.:\-/]{1,160}$/;

/** Hub-Eingabe pruefen und kuerzen; doppelte Schluessel zaehlen einmal. */
export function sanitizeReportedAlerts(raw: unknown, max = 200): ReportedAlert[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, ReportedAlert>();
  for (const item of raw.slice(0, max)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key.trim() : "";
    const title = typeof r.title === "string" ? r.title.trim().slice(0, 200) : "";
    if (!KEY_RE.test(key) || !title) continue;
    out.set(key, {
      key,
      title,
      detail: typeof r.detail === "string" ? r.detail.slice(0, 500) : null,
      severity: r.severity === "alert" ? "alert" : "warn",
    });
  }
  return [...out.values()];
}

/** Welche Befunde sind neu (oder wieder da), welche haben sich erledigt? */
export function diffAlerts(
  stored: StoredAlert[],
  reported: ReportedAlert[],
): { opened: ReportedAlert[]; resolved: string[]; still: ReportedAlert[] } {
  const open = new Set(stored.filter((s) => !s.resolvedAt).map((s) => s.key));
  const reportedKeys = new Set(reported.map((r) => r.key));
  const opened = reported.filter((r) => !open.has(r.key));
  const still = reported.filter((r) => open.has(r.key));
  const resolved = [...open].filter((k) => !reportedKeys.has(k));
  return { opened, resolved, still };
}
