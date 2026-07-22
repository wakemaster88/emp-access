/** Testet die zweistufige Plate-Pipeline (fast-alpr → Vision) gegen Burst-Dumps. */
import { readFileSync, readdirSync } from "node:fs";
import { scorePlateFromJpeg, setVehicleWhitelist } from "../src/plate.js";

async function main() {
  setVehicleWhitelist([]); // ohne Whitelist = strengster Fall
  const dirs = process.argv.slice(2);
  for (const dir of dirs) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).slice(0, 4);
    for (const f of files) {
      const t = Date.now();
      const score = await scorePlateFromJpeg(readFileSync(`${dir}/${f}`));
      console.log(
        dir.split("_").slice(-2).join(" "), f,
        `${Date.now() - t}ms`,
        "→", score.plate ?? "—",
        score.plate ? `(${score.confidence.toFixed(2)})` : "",
        score.candidates.slice(0, 2).map((c) => `${c.plate}@${c.source}`).join(", ")
      );
    }
  }
  process.exit(0);
}
main();
