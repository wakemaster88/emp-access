/**
 * Prueft die Integrations-Helfer fuer Audio-Zonen (URL, Aktions-Mapping).
 * Ausfuehren: npx tsx scripts/audio-integration-check.ts
 */
import {
  audioCommandLabel,
  audioInputFromDeviceAction,
  parseAudioControlBody,
  parseStreamUrl,
} from "../src/lib/audio-integration";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failed++;
    console.log(` FEHL  ${label}${detail ? ` – ${detail}` : ""}`);
    return;
  }
  console.log(`  ok   ${label}`);
}

check("https-Stream gültig", "url" in parseStreamUrl("https://stream.example/radio"));
check("http-Stream gültig", "url" in parseStreamUrl("http://radio.local/stream"));
check("javascript abgelehnt", "error" in parseStreamUrl("javascript:alert(1)"));
check("leer abgelehnt", "error" in parseStreamUrl("   "));
check("open → PLAY", audioInputFromDeviceAction("open")?.action === "PLAY");
check("stop → STOP", audioInputFromDeviceAction("stop")?.action === "STOP");
check("emergency nicht Audio", audioInputFromDeviceAction("emergency") === null);

const playBody = parseAudioControlBody({
  action: "PLAY",
  playlistId: 3,
  persistStreamUrl: true,
});
check(
  "PLAY-Body mit Playlist",
  !("error" in playBody) && playBody.action === "PLAY" && playBody.playlistId === 3,
);

const volumeBody = parseAudioControlBody({ action: "VOLUME", volume: 40 });
check(
  "VOLUME-Label",
  !("error" in volumeBody) && audioCommandLabel(volumeBody) === "Lautstärke 40 %",
);

console.log(failed === 0 ? "\nAlle Pruefungen bestanden." : `\n${failed} Pruefung(en) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
