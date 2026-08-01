import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { fetchRecentCrossings } from "@/lib/people-tracker";
import { fetchScanRows, type ScanRow } from "@/lib/emp-access-scans";
import { archiveScans, archiveStart, readScansSince } from "@/lib/scan-archive";
import { pairCrossings } from "@/lib/tailgate-pairing";

export const dynamic = "force-dynamic";

/**
 * Stellt Scans und gezählte Durchgänge gegenüber, damit man der Kontrolle
 * nicht blind vertrauen muss.
 *
 * Der Zähler allein sagt nur „drei ungedeckt". Erst die Paarung zeigt, ob
 * das echte Mitläufer waren oder ob die Kamera schlicht danebenlag.
 *
 * Die Zuordnung selbst steckt in `lib/tailgate-pairing.ts` — dieselbe
 * Rechnung entscheidet live, ob ein Alarm losgeht.
 */

type Entry =
  | {
      kind: "paired";
      ts: number;
      scanTs: number;
      device: string;
      ticket: string | null;
      lagSec: number;
    }
  | { kind: "crossing-only"; ts: number; snap: boolean; ctx: string[] }
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

  // Die Scans kommen aus dem lokalen Archiv, nicht direkt aus der Cloud —
  // die gibt nur die letzten 200 über alle Geräte heraus. Ergänzt wird der
  // Abruf um die jüngsten Zeilen, damit die Liste bis zur Sekunde stimmt.
  const [crossingsRaw, archived, live] = await Promise.all([
    fetchRecentCrossings(cam.id, 800),
    readScansSince(since),
    fetchScanRows(emp.baseUrl, token, 50).catch(() => [] as ScanRow[]),
  ]);
  void archiveScans(live);

  const byId = new Map<number, ScanRow>();
  for (const s of archived) byId.set(s.id, s);
  for (const s of live) if (s.ts >= since) byId.set(s.id, s);
  const scansRaw = [...byId.values()];

  const crossings = crossingsRaw
    .filter((c) => c.dir === cam.tailgate.countDirection && c.ts >= since)
    .sort((a, b) => a.ts - b.ts);

  const scans = scansRaw
    .filter((s) => s.deviceId !== null && devices.has(s.deviceId) && s.ts >= since)
    .sort((a, b) => a.ts - b.ts);

  // Beide Quellen reichen unterschiedlich weit zurück, und beide Lücken
  // würden die Bilanz verfälschen:
  //   – Das Scan-Archiv beginnt, seit der Server mitschreibt. Davor stünden
  //     Durchgänge scheinbar ohne Berechtigung da.
  //   – Die Durchgänge beginnen beim letzten Zurücksetzen des Zählers. Davor
  //     stünden Scans scheinbar ohne Durchgang da.
  // Ausgewertet wird deshalb erst ab dem Zeitpunkt, ab dem beides vorliegt.
  const scanStart = (await archiveStart()) ?? since;
  const oldestCrossing =
    crossingsRaw.length > 0 ? Math.min(...crossingsRaw.map((c) => c.ts)) : since;
  const from = Math.max(since, scanStart, oldestCrossing);

  const granted = scans.filter((s) => s.result === "GRANTED");
  const { results, usedScanIds: used } = pairCrossings(
    crossings.filter((c) => c.ts >= from),
    granted,
  );
  const entries: Entry[] = [];

  for (const { crossing: c, scan: match } of results) {
    if (match) {
      entries.push({
        kind: "paired",
        ts: c.ts,
        scanTs: match.ts,
        device: match.device,
        ticket: match.ticket,
        lagSec: Math.round(((c.ts - match.ts) / 1000) * 10) / 10,
      });
    } else {
      entries.push({
        kind: "crossing-only",
        ts: c.ts,
        snap: c.snap,
        ctx: c.ctx,
      });
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
    /** Klarnamen der Kameras, damit das UI die Blickwinkel benennen kann. */
    camNames: Object.fromEntries(cfg.cams.map((c) => [c.id, c.name])),
    from,
    minutes,
    /** Reicht eine der beiden Quellen nicht über den ganzen Zeitraum? */
    truncated: from > since + 60_000,
    /** Welche Quelle den Zeitraum beschneidet — für einen ehrlichen Hinweis. */
    limitedBy:
      from <= since + 60_000
        ? null
        : oldestCrossing >= scanStart
          ? "crossings"
          : "scans",
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
