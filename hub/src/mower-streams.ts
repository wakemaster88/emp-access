/**
 * go2rtc-Streams fuer die Maeher-Kameras (ohne Abhaengigkeiten, damit testbar).
 *
 * Pro Kamera zwei Streams:
 *  - `mower_<name>_<uid>` holt das Bild per WHEP vom Maeher-Dienst (der
 *    tritt dafuer dem Agora-Kanal bei). Der Maeher sendet H265.
 *  - `mower_<name>_<uid>_h264` rechnet es mit ffmpeg in H264 um, damit jeder
 *    Browser es abspielen kann. Die Kamera-Zentrale nutzt diesen Stream.
 *
 * Beide starten erst, wenn jemand zuschaut. Die Vorschaubild-Auffrischung
 * laesst sie aus (isMowerStream), sonst liefe die Kamera dauernd und die
 * Mammotion-App verloere ihr Bild.
 */

export const MOWER_STREAM_PREFIX = "mower_";

export function mowerStreamName(mower: string, uid: number): string {
  const slug = mower
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${MOWER_STREAM_PREFIX}${slug || "x"}_${uid}`;
}

export function isMowerStream(name: string): boolean {
  return name.startsWith(MOWER_STREAM_PREFIX);
}

/** Gewuenschte go2rtc-Quellen fuer eine Maeher-Kamera, nach Stream-Name. */
export function mowerStreamSources(mower: string, uid: number, port: number): Record<string, string> {
  const raw = mowerStreamName(mower, uid);
  return {
    [raw]: `webrtc:http://127.0.0.1:${port}/whep/${encodeURIComponent(mower)}/${uid}?stream=${raw}`,
    [`${raw}_h264`]: `ffmpeg:${raw}#video=h264#hardware`,
  };
}

interface Go2rtcStreamInfo {
  producers?: Array<{ url?: string } | null> | null;
  consumers?: unknown[] | null;
}

/**
 * Muss der Stream in go2rtc (neu) eingetragen werden? Nie, solange jemand
 * zuschaut: Ein laufender Producer meldet statt der Quelle seine eigene URL,
 * und ein Neueintrag wuerde das Livebild abreissen.
 */
export function needsStreamUpdate(info: Go2rtcStreamInfo | null | undefined, src: string): boolean {
  if (!info) return true;
  if ((info.consumers ?? []).length > 0) return false;
  const urls = (info.producers ?? []).map((p) => p?.url ?? "").filter(Boolean);
  if (urls.length !== 1) return true;
  // Verbunden steht dort die WHEP-URL ohne "webrtc:" davor.
  return !(urls[0] === src || src.endsWith(`:${urls[0]}`));
}
