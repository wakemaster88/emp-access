import { test } from "node:test";
import assert from "node:assert/strict";
import { busyPct, parseGpuUtil, parseOllamaPs } from "./ai-load-rules.js";

test("GPU-Auslastung aus ioreg", () => {
  const io = '  "PerformanceStatistics" = {"In use system memory"=123,"Device Utilization %"=42,"Renderer Utilization %"=40}';
  assert.equal(parseGpuUtil(io), 42);
  assert.equal(parseGpuUtil("nichts"), null);
});

test("Ollama-Prozesse aus ps, CPU je Kern normiert", () => {
  const ps = " 180.0 2048000 /opt/homebrew/opt/ollama/bin/ollama\n  20.0 1024 /Applications/Safari.app\n   0,5 4096 ollama";
  const r = parseOllamaPs(ps, 18);
  assert.equal(r.procs, 2);
  assert.equal(r.cpuPct, 10);
  assert.equal(r.rssBytes, (2048000 + 4096) * 1024);
});

test("Rechenzeit im Fenster, Überlappungen einmal", () => {
  const now = 100_000;
  assert.equal(busyPct([{ start: 90_000, end: 95_000 }, { start: 92_000, end: 96_000 }], now, 10_000), 60);
  assert.equal(busyPct([{ start: 0, end: 50_000 }], now, 10_000), 0);
  assert.equal(busyPct([], now, 10_000), 0);
});
