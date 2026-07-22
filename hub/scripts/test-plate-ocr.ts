/**
 * Plate-OCR gegen lokale Snaps testen:
 *   npx tsx scripts/test-plate-ocr.ts [/path/to.jpg ...]
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import path from "path";
import { readPlateFromJpeg } from "../src/plate.js";

async function main() {
  const args = process.argv.slice(2);
  let files = args.filter((a) => a.endsWith(".jpg") || a.endsWith(".jpeg"));
  if (files.length === 0) {
    const dirs = ["/tmp/veh-snaps", "/tmp/veh-snaps2"];
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".jpg"))) {
        files.push(path.join(d, f));
      }
    }
    files = files
      .map((f) => ({ f, m: statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .map((x) => x.f);
  }

  console.log(`Teste ${files.length} Bilder …`);
  for (const f of files) {
    const t0 = Date.now();
    const plate = await readPlateFromJpeg(readFileSync(f));
    console.log(`${path.basename(f)} → ${plate ?? "—"} (${Date.now() - t0}ms)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
