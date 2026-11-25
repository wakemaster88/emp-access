/**
 * Live-Lage des Dashboards: aus den Rohdaten der Abfrage (`/api/dashboard/live`)
 * die Liste „braucht Aufmerksamkeit“ bauen. Nur Logik, damit die Reihenfolge
 * und die Schwellen testbar bleiben.
 */

export type LiveWarningTone = "danger" | "warning";

export interface LiveWarning {
  /** Stabiler Schlüssel für React und zum Entdoppeln. */
  key: string;
  tone: LiveWarningTone;
  title: string;
  detail: string | null;
  /** Seite, auf der man das Problem behebt. */
  href: string;
  /** Zeitpunkt (ISO), falls es einen gibt. */
  at: string | null;
}

/**
 * Auslastung eines Bereichs, wie die Kunden-App sie gerade zeigt: am Lift
 * Fahrer der letzten 60 Minuten, am Strandbad geschätzte Gäste (Eintritte der
 * letzten 3 Stunden × Faktor). Stufen und Texte aus `rider-occupancy-labels`
 * bzw. `beach-occupancy-labels`.
 */
export type LiveAreaOccupancy =
  | { kind: "lift"; level: "none" | "low" | "medium" | "high"; label: string; riders: number; starts: number }
  | {
      kind: "beach";
      level: "low" | "medium" | "high";
      label: string;
      estimated: number;
      entries: number;
      capacity: number | null;
    };

/** Ab so vielen Ablehnungen in 15 Minuten gilt ein Bereich als auffällig. */
export const DENIED_BURST_THRESHOLD = 5;

/** ANNY-Abgleich älter als das gilt als hängengeblieben. */
export const ANNY_STALE_AFTER_MS = 2 * 60 * 60_000;

export interface LiveWarningInput {
  now: Date;
  monitorAlerts: { id: number; message: string; source: string | null; occurredAt: Date }[];
  monitorAlertsOpen: number;
  hubs: { name: string; online: boolean; outdated: boolean }[];
  hubAlerts: { key: string; title: string; detail: string | null; severity: string; lastSeenAt: Date }[];
  camerasOffline: string[];
  devicesOffline: string[];
  blacklistSightings: { id: number; name: string | null; cameraName: string | null; seenAt: Date }[];
  noParking: { id: number; plate: string | null; cameraName: string | null; seenAt: Date }[];
  gates: { name: string; holdUntil: Date | null; holdError: string | null }[];
  areas: { id: number; name: string; personLimit: number | null; inside: number | null; denied15: number }[];
  anny: { lastSync: Date | null; errors: number } | null;
}

function hm(d: Date): string {
  return d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
}

function list(names: string[], max = 3): string {
  if (names.length <= max) return names.join(" · ");
  return `${names.slice(0, max).join(" · ")} und ${names.length - max} weitere`;
}

/**
 * Reihenfolge: erst Störungen (rot), dann Hinweise (gelb); innerhalb einer
 * Stufe in der Reihenfolge, in der man vor Ort reagieren würde – Personen und
 * Zutritt vor Technik.
 */
export function buildLiveWarnings(input: LiveWarningInput): LiveWarning[] {
  const out: LiveWarning[] = [];
  const nowMs = input.now.getTime();

  for (const s of input.blacklistSightings.slice(0, 3)) {
    out.push({
      key: `blacklist:${s.id}`,
      tone: "danger",
      title: `Gesperrte Person erkannt${s.name ? `: ${s.name}` : ""}`,
      detail: s.cameraName ? `Kamera ${s.cameraName}` : null,
      href: "/personen",
      at: s.seenAt.toISOString(),
    });
  }

  if (input.monitorAlertsOpen > 0) {
    const latest = input.monitorAlerts[0];
    out.push({
      key: "monitor-alerts",
      tone: "danger",
      title:
        input.monitorAlertsOpen === 1
          ? "1 offene Warnung am Drehkreuz"
          : `${input.monitorAlertsOpen} offene Warnungen am Drehkreuz`,
      detail: latest ? (latest.source ? `${latest.source}: ${latest.message}` : latest.message) : null,
      href: "/webcams",
      at: latest?.occurredAt.toISOString() ?? null,
    });
  }

  for (const g of input.gates) {
    if (g.holdError && g.holdUntil && g.holdUntil.getTime() > nowMs) {
      out.push({
        key: `gate-error:${g.name}`,
        tone: "danger",
        title: `${g.name}: Offenhalten schlägt fehl`,
        detail: g.holdError,
        href: "/webcams",
        at: null,
      });
    }
  }

  const hubsOffline = input.hubs.filter((h) => !h.online).map((h) => h.name);
  if (hubsOffline.length > 0) {
    out.push({
      key: "hub-offline",
      tone: "danger",
      title: hubsOffline.length === 1 ? "Hub offline" : `${hubsOffline.length} Hubs offline`,
      detail: `${list(hubsOffline)} – Kameras, Erkennung und Tor laufen nicht über die Cloud`,
      href: "/network",
      at: null,
    });
  }

  for (const a of input.hubAlerts.filter((h) => h.severity === "alert").slice(0, 3)) {
    out.push({
      key: `hub-alert:${a.key}`,
      tone: "danger",
      title: a.title,
      detail: a.detail,
      href: "/network",
      at: a.lastSeenAt.toISOString(),
    });
  }

  for (const a of input.areas) {
    if (a.personLimit != null && a.inside != null && a.inside > a.personLimit) {
      out.push({
        key: `over-limit:${a.id}`,
        tone: "warning",
        title: `${a.name} über dem Limit`,
        detail: `${a.inside} drin, erlaubt sind ${a.personLimit}`,
        href: `/areas/${a.id}`,
        at: null,
      });
    }
    if (a.denied15 >= DENIED_BURST_THRESHOLD) {
      out.push({
        key: `denied:${a.id}`,
        tone: "warning",
        title: `${a.name}: ${a.denied15} Ablehnungen in 15 Minuten`,
        detail: "Am Drehkreuz nachsehen, ob Gäste nicht durchkommen",
        href: "/scans",
        at: null,
      });
    }
  }

  if (input.noParking.length > 0) {
    const v = input.noParking[0];
    out.push({
      key: "no-parking",
      tone: "warning",
      title:
        input.noParking.length === 1
          ? "Fahrzeug im Halteverbot"
          : `${input.noParking.length} Fahrzeuge im Halteverbot`,
      detail: [v.plate, v.cameraName ? `Kamera ${v.cameraName}` : null].filter(Boolean).join(" · ") || null,
      href: "/fahrzeuge",
      at: v.seenAt.toISOString(),
    });
  }

  for (const g of input.gates) {
    if (!g.holdError && g.holdUntil && g.holdUntil.getTime() > nowMs) {
      out.push({
        key: `gate-hold:${g.name}`,
        tone: "warning",
        title: `${g.name} wird offen gehalten`,
        detail: `bis ${hm(g.holdUntil)} Uhr`,
        href: "/webcams",
        at: null,
      });
    }
  }

  if (input.camerasOffline.length > 0) {
    out.push({
      key: "cameras-offline",
      tone: "warning",
      title:
        input.camerasOffline.length === 1
          ? "1 Kamera nicht erreichbar"
          : `${input.camerasOffline.length} Kameras nicht erreichbar`,
      detail: list(input.camerasOffline),
      href: "/cameras",
      at: null,
    });
  }

  if (input.devicesOffline.length > 0) {
    out.push({
      key: "devices-offline",
      tone: "warning",
      title:
        input.devicesOffline.length === 1
          ? "1 Leser oder Abspieler offline"
          : `${input.devicesOffline.length} Leser und Abspieler offline`,
      detail: list(input.devicesOffline),
      href: "/devices",
      at: null,
    });
  }

  const softHubAlerts = input.hubAlerts.filter((h) => h.severity !== "alert");
  if (softHubAlerts.length > 0) {
    out.push({
      key: "hub-alerts",
      tone: "warning",
      title:
        softHubAlerts.length === 1 ? softHubAlerts[0].title : `${softHubAlerts.length} Befunde im Netzwerk`,
      detail: softHubAlerts.length === 1 ? softHubAlerts[0].detail : list(softHubAlerts.map((h) => h.title), 2),
      href: "/network",
      at: softHubAlerts[0].lastSeenAt.toISOString(),
    });
  }

  const outdated = input.hubs.filter((h) => h.online && h.outdated).map((h) => h.name);
  if (outdated.length > 0) {
    out.push({
      key: "hub-outdated",
      tone: "warning",
      title: "Hub hat das letzte Update noch nicht gezogen",
      detail: list(outdated),
      href: "/network",
      at: null,
    });
  }

  if (input.anny) {
    const stale = !input.anny.lastSync || nowMs - input.anny.lastSync.getTime() > ANNY_STALE_AFTER_MS;
    if (input.anny.errors > 0 || stale) {
      out.push({
        key: "anny",
        tone: "warning",
        title:
          input.anny.errors > 0
            ? `ANNY-Abgleich mit ${input.anny.errors} Fehler${input.anny.errors === 1 ? "" : "n"}`
            : "ANNY-Abgleich hängt",
        detail: input.anny.lastSync ? `zuletzt ${hm(input.anny.lastSync)} Uhr` : "noch nie gelaufen",
        href: "/settings",
        at: input.anny.lastSync?.toISOString() ?? null,
      });
    }
  }

  // Rot vor Gelb, sonst Reihenfolge wie oben eingefügt (stabile Sortierung).
  return out
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (a.w.tone === b.w.tone ? a.i - b.i : a.w.tone === "danger" ? -1 : 1))
    .map(({ w }) => w);
}

/**
 * Kamera-Ereignisse der letzten Stunde je Kamera zusammenzählen. `at` ist die
 * letzte Aktivität des Ereignisses (läuft es noch: jetzt, sonst sein Ende).
 */
export interface CameraActivity {
  id: number;
  name: string;
  person: number;
  vehicle: number;
  other: number;
  total: number;
  lastAt: string;
}

export function summarizeCameraActivity(
  events: { cameraId: number; cameraName: string; type: string; at: Date }[],
): CameraActivity[] {
  const byCam = new Map<number, CameraActivity & { last: number }>();
  for (const e of events) {
    let c = byCam.get(e.cameraId);
    if (!c) {
      c = { id: e.cameraId, name: e.cameraName, person: 0, vehicle: 0, other: 0, total: 0, lastAt: "", last: 0 };
      byCam.set(e.cameraId, c);
    }
    c.total++;
    if (e.type === "PERSON") c.person++;
    else if (e.type === "VEHICLE") c.vehicle++;
    else c.other++;
    const t = e.at.getTime();
    if (t > c.last) c.last = t;
  }
  return [...byCam.values()]
    .sort((a, b) => b.last - a.last)
    .map(({ last, ...c }) => ({ ...c, lastAt: new Date(last).toISOString() }));
}
