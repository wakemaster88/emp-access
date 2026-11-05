/** Auslastung des KI-Modells: Parser und Rechenregeln (reine Logik). */

/** GPU-Auslastung aus `ioreg -r -d 1 -w 0 -c IOAccelerator` (Apple Silicon). */
export function parseGpuUtil(ioreg: string): number | null {
  const m = ioreg.match(/"Device Utilization %"\s*=\s*(\d+)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
}

/**
 * CPU (% der ganzen Maschine) und Speicher (Bytes) aller Ollama-Prozesse aus
 * `ps -A -o %cpu=,rss=,comm=`. ps zaehlt %cpu je Kern, daher durch Kerne teilen.
 */
export function parseOllamaPs(ps: string, cores: number): { cpuPct: number; rssBytes: number; procs: number } {
  let cpu = 0;
  let rss = 0;
  let procs = 0;
  for (const line of ps.split("\n")) {
    const m = line.trim().match(/^([\d.,]+)\s+(\d+)\s+(.+)$/);
    if (!m || !/ollama/i.test(m[3])) continue;
    cpu += Number(m[1].replace(",", ".")) || 0;
    rss += (Number(m[2]) || 0) * 1024;
    procs++;
  }
  return { cpuPct: Math.min(100, Math.round((cpu / Math.max(1, cores)) * 10) / 10), rssBytes: rss, procs };
}

/** Anteil der Zeit (0..100), in der das Modell im Fenster gerechnet hat. */
export function busyPct(spans: Array<{ start: number; end: number }>, now: number, windowMs: number): number {
  const from = now - windowMs;
  // Ueberlappende Anfragen (Chat + Bild gleichzeitig) nicht doppelt zaehlen.
  const parts = spans
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, now) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let curS = -1;
  let curE = -1;
  for (const p of parts) {
    if (p.start > curE) {
      if (curE > curS) total += curE - curS;
      curS = p.start;
      curE = p.end;
    } else curE = Math.max(curE, p.end);
  }
  if (curE > curS) total += curE - curS;
  return Math.round((total / windowMs) * 1000) / 10;
}
