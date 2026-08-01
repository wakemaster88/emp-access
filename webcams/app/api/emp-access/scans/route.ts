import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { fetchScanRows, type ScanRow } from "@/lib/emp-access-scans";
import { archiveScans } from "@/lib/scan-archive";

export const dynamic = "force-dynamic";

/**
 * Zutritts-Scans aus emp-access für die Scan-Monitor-Kachel.
 *
 * Mehrere offene Dashboards teilen sich einen kurzen Cache, damit die
 * Cloud-API nicht pro Browser-Tab getroffen wird.
 */

export type { ScanRow };

type CacheEntry = { at: number; rows: ScanRow[] };

const CACHE_MS = 1500;
const cache = new Map<number, CacheEntry>();
let inflight: Promise<ScanRow[]> | null = null;

export async function GET(req: Request) {
  const cfg = await loadConfig();
  const emp = cfg.settings.empAccess;
  const apiToken = emp.apiToken?.trim() ?? "";

  if (!emp.enabled || !apiToken) {
    return NextResponse.json({
      configured: false,
      scans: [],
      error: null,
      fetchedAt: Date.now(),
    });
  }

  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("limit") ?? 12);
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 12, 3), 50);

  const hit = cache.get(limit);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json({
      configured: true,
      scans: hit.rows,
      error: null,
      fetchedAt: hit.at,
    });
  }

  try {
    // Parallele Requests bündeln — sonst schlägt jeder Tab einzeln auf.
    inflight ??= fetchScanRows(emp.baseUrl, apiToken, limit).finally(() => {
      inflight = null;
    });
    const rows = await inflight;
    cache.set(limit, { at: Date.now(), rows });
    // Das Dashboard fragt im Dauerbetrieb alle paar Sekunden — damit füllt
    // sich das Archiv nebenbei, ohne die Cloud zusätzlich zu belasten.
    void archiveScans(rows);
    return NextResponse.json({
      configured: true,
      scans: rows,
      error: null,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    // Bei Netzproblemen lieber den letzten bekannten Stand zeigen als eine
    // leere Kachel — das Alter steht über `fetchedAt` in der UI.
    const stale = cache.get(limit);
    return NextResponse.json({
      configured: true,
      scans: stale?.rows ?? [],
      error: err instanceof Error ? err.message : "Abruf fehlgeschlagen",
      fetchedAt: stale?.at ?? 0,
    });
  }
}
