/**
 * Ansage über den Kamera-Lautsprecher von Hand auslösen – für den Hörtest.
 *
 *   cd hub && npx tsx scripts/talk-test.ts <host> "<Text>" [Stimme]
 *
 * Zugangsdaten kommen aus der Kiosk-Config (webcams/config.json), damit hier
 * keine Passwörter in der Befehlszeile stehen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG } from "../src/config.js";
import { speakOnCamera } from "../src/camera-talk.js";

interface KioskCam {
  id: string;
  name: string;
  ip: string;
  username: string;
  password: string;
  rtspPort?: number;
  streamSub?: string;
}

const [ref, text, voice] = process.argv.slice(2);
if (!ref || !text) {
  console.error('Aufruf: npx tsx scripts/talk-test.ts <ip|kamera-id> "<Text>" [Stimme]');
  process.exit(1);
}

const cfgPath = path.join(CONFIG.repoDir, "webcams", "config.json");
const cams = (JSON.parse(readFileSync(cfgPath, "utf8")) as { cams: KioskCam[] }).cams;
const cam = cams.find((c) => c.ip === ref || c.id === ref);
if (!cam) {
  console.error(`Kamera "${ref}" steht nicht in webcams/config.json`);
  process.exit(1);
}

console.log(`Ansage an ${cam.name} (${cam.ip}) …`);
const result = await speakOnCamera(
  {
    host: cam.ip,
    username: cam.username,
    password: cam.password,
    rtspPort: cam.rtspPort,
    streamPath: cam.streamSub,
    label: cam.name,
  },
  text,
  voice ? { voice } : {},
);
console.log(`Fertig, ${result.seconds.toFixed(1)} s gesprochen.`);
