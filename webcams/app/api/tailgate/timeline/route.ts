import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { fetchRecentCrossings } from "@/lib/people-tracker";
import { fetchScanRows } from "@/lib/emp-access-scans";

export const dynamic = "force-dynamic";

/**
 * Stellt Scans und gezählte Durchgänge gegenüber, damit man der Kontrolle
 * nicht blind vertrauen muss.
 *
 * Der Zähler allein sagt nur „drei ungedeckt". Erst die Paarung zeigt, ob
 * das echte Mitläufer waren oder ob die Kamera schlicht danebenlag.
 */

/**
 * Wie lange nach einem Scan der zugehörige Durchgang erwartet wird.
 * Gemessen liegen zwischen Piepton und Fußpunkt über der Linie zwei bis
 * fünf Sekunden; bei Andrang staut es sich etwas.
 */
const MAX_LAG_MS = 30_000;
/** Kleiner Vorlauf gegen Uhren-Versatz zwischen Cloud und Sidecar. */
const MAX_LEAD_MS = 3_000;

type Entry =
  | {
      kind: "paired";
      ts: number;
      scanTs: number;
      device: string;
      ticket: string | null;
      lagSec: number;
    }
  | { kind: "crossing-only"; ts: number }
  | { kind: "scan-only"; ts: number; device: string; ticket: string | null }
  | {
      kind: "denied";
      ts: number;
      device: string;
      ticket: string | null;
      result: "DENIED" | "PROTECTED";
    };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = await loadConfig();

  const camId = url.searchParams.get("camId");
  const cam = camId
    ? cfg.cams.find((c) => c.id === camId)
    : cfg.cams.find((c) => c.enabled && c.tailgate.enabled);
  if (!cam) {
    return NextResponse.json({ error: "keine Kamera mit Kontrolle" }, { status: 404 });
  }

  const requested = Number(url.searchParams.get("minutes") ?? 60);
  const minutes = Math.min(Math.max(Number.isFinite(requested) ? requested : 60, 5), 720);
  const since = Date.now() - minutes * 60_000;

  const emp = cfg.settings.empAccess;
  const token = emp.apiToken?.trim() ?? "";
  if (!emp.enabled || !token) {
    return NextResponse.json({ error: "emp-access ist nicht eingerichtet" }, { status: 400 });
  }

  const devices = new Set(cam.tailgate.deviceIds);
  const [crossingsRaw, scansRaw] = await Promise.all([
    fetchRecentCrossings(cam.id, 800),
    fetchScanRows(emp.baseUrl, token, 300),
  ]);

  const crossings = crossingsRaw
    .filter((c) => c.dir === cam.tailgate.countDirection && c.ts >= since)
    .sort((a, b) => a.ts - b.ts);

  const scans = scansRaw
    .filter((s) => s.deviceId !== null && devices.has(s.deviceId) && s.ts >= since)
    .sort((a, b) => a.ts - b.ts);

  // Beide Quellen reichen unterschiedlich weit zurück, und beide Lücken
  // würden die Bilanz verfälschen:
  //   – Die Cloud liefert nur die letzten N Scans über alle Geräte. Davor
  //     stünden Durchgänge scheinbar ohne Berechtigung da.
  //   – Die Durchgänge beginnen beim letzten Zurücksetzen des Zählers. Davor
  //     stünden Scans scheinbar ohne Durchgang da.
  // Ausgewertet wird deshalb erst ab dem Zeitpunkt, ab dem beides vorliegt.
  const oldestScan = scansRaw.length > 0 ? Math.min(...scansRaw.map((s) => s.ts)) : since;
  const oldestCrossing =
    crossingsRaw.length > 0 ? Math.min(...crossingsRaw.map((c) => c.ts)) : since;
  const from = Math.max(since, oldestScan, oldestCrossing);

  const granted = scans.filter((s) => s.result === "GRANTED");
  const used = new Set<number>();
  const entries: Entry[] = [];

  for (const c of crossings) {
    if (c.ts < from) continue;
    // Der jüngste noch freie Scan davor gewinnt — bei einer Schlange gehen
    // die Leute in der Reihenfolge durch, in der sie gescannt haben.
    // Ein Scan nach dem Durchgang kommt nur zum Zug, wenn davor keiner frei
    // ist; sonst zöge ein Nachzügler die Zuordnung an sich, obwohl er die
    // Person, die man durchgehen sah, gar nicht sein kann.
    let match: (typeof granted)[number] | null = null;
    let best = Infinity;
    for (const s of granted) {
      if (used.has(s.id)) continue;
      if (s.ts > c.ts + MAX_LEAD_MS) break;
      const lag = c.ts - s.ts;
      if (lag > MAX_LAG_MS) continue;
      // Versatz nach hinten wird bestraft, damit er nur als Notnagel greift.
      const score = lag >= 0 ? lag : MAX_LAG_MS + Math.abs(lag);
      if (score < best) {
        best = score;
        match = s;
      }
    }
    if (match) {
      used.add(match.id);
      entries.push({
        kind: "paired",
        ts: c.ts,
        scanTs: match.ts,
        device: match.device,
        ticket: match.ticket,
        lagSec: Math.round(((c.ts - match.ts) / 1000) * 10) / 10,
      });
    } else {
      entries.push({ kind: "crossing-only", ts: c.ts });
    }
  }

  for (const s of scans) {
    if (s.ts < from) continue;
    if (s.result !== "GRANTED") {
      entries.push({
        kind: "denied",
        ts: s.ts,
        device: s.device,
        ticket: s.ticket,
        result: s.result,
      });
    } else if (!used.has(s.id)) {
      entries.push({
        kind: "scan-only",
        ts: s.ts,
        device: s.device,
        ticket: s.ticket,
      });
    }
  }

  entries.sort((a, b) => b.ts - a.ts);

  const paired = entries.filter((e) => e.kind === "paired").length;
  const crossingOnly = entries.filter((e) => e.kind === "crossing-only").length;
  const scanOnly = entries.filter((e) => e.kind === "scan-only").length;

  return NextResponse.json({
    camId: cam.id,
    camName: cam.name,
    from,
    minutes,
    /** Reicht die Cloud-Antwort nicht über den ganzen Zeitraum? */
    truncated: oldestScan > since,
    summary: {
      paired,
      crossingOnly,
      scanOnly,
      denied: entries.filter((e) => e.kind === "denied").length,
      /** Anteil der Durchgänge mit passendem Scan. */
      matchRate:
        paired + crossingOnly > 0
          ? Math.round((paired / (paired + crossingOnly)) * 100)
          : null,
    },
    entries: entries.slice(0, 400),
  });
}
