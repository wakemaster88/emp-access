/**
 * Zustand der go2rtc-Streams auswerten (ohne Abhaengigkeiten, damit testbar).
 *
 * Hintergrund (22.11.2026): In der Zentrale hingen alle Kacheln auf
 * „Verbindung wird aufgebaut …“, waehrend Schnappschuesse (direkt von der
 * Kamera) weiter ankamen. Weder das Hub-Log noch die Oberflaeche sagten, ob
 * go2rtc von der Kamera nichts bekommt, ob der Stream in einem Format kommt,
 * das der Browser nicht abspielt (H.265), oder ob nur die WebRTC-Verbindung
 * zum Fenster scheitert. Diese Auswertung liefert genau das, ohne die
 * RTSP-URLs (enthalten Passwoerter) weiterzugeben.
 *
 * go2rtc meldet je nach Version leicht unterschiedliche Felder; alles wird
 * deshalb defensiv gelesen.
 */

export interface Go2rtcRaw {
  producers?: Array<Record<string, unknown> | null> | null;
  consumers?: Array<Record<string, unknown> | null> | null;
}

export interface StreamSummary {
  name: string;
  /** Kamera-Host aus der Quell-URL (ohne Zugangsdaten). */
  host: string | null;
  /** Videoformat, z. B. "H264" oder "H265"; null = noch unbekannt (Stream ruht). */
  video: string | null;
  /** Empfangene Bytes von der Kamera (alle Producer). */
  bytes: number;
  /** Laufende Producer (RTSP-Verbindung zur Kamera steht). */
  active: boolean;
  /** Zuschauer (WebRTC, Standbild, Tracker …). */
  consumers: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Host aus einer Quell-URL, ohne Benutzer und Passwort. */
export function hostFromUrl(url: string): string | null {
  const m = url.match(/@([^:/@]+)[:/]/) ?? url.match(/^\w+:\/\/([^:/@]+)[:/]/);
  return m ? m[1] : null;
}

/** Videoformat eines Producers aus receivers[].codec oder medias. */
function producerVideo(p: Record<string, unknown>): string | null {
  const receivers = Array.isArray(p.receivers) ? (p.receivers as Array<Record<string, unknown> | null>) : [];
  for (const r of receivers) {
    const codec = (r?.codec ?? null) as Record<string, unknown> | null;
    if (!codec) continue;
    const type = String(codec.codec_type ?? codec.kind ?? "");
    const name = String(codec.codec_name ?? codec.name ?? "");
    if (name && (type === "video" || /^(h26[45]|hevc|mjpeg|vp[89]|av1)$/i.test(name))) return normCodec(name);
  }
  const medias = Array.isArray(p.medias) ? p.medias : [];
  for (const m of medias) {
    // z. B. "video, recvonly, H264" oder "video, recvonly, H265"
    const s = String(m ?? "");
    if (!/^video/i.test(s)) continue;
    const codec = s.split(",").map((x) => x.trim()).pop();
    if (codec && codec !== s) return normCodec(codec);
  }
  return null;
}

function normCodec(name: string): string {
  const n = name.toUpperCase();
  if (n === "HEVC") return "H265";
  return n;
}

function producerBytes(p: Record<string, unknown>): number {
  const direct = num(p.bytes_recv) || num(p.recv) || num(p.bytes);
  if (direct) return direct;
  const receivers = Array.isArray(p.receivers) ? (p.receivers as Array<Record<string, unknown> | null>) : [];
  return receivers.reduce((sum, r) => sum + num(r?.bytes), 0);
}

/** Ein Producer laeuft, wenn go2rtc mehr als die reine Quell-URL meldet. */
function producerActive(p: Record<string, unknown>): boolean {
  return (
    producerBytes(p) > 0 ||
    (Array.isArray(p.receivers) && p.receivers.length > 0) ||
    typeof p.remote_addr === "string" ||
    typeof p.format_name === "string"
  );
}

export function summarizeStreams(data: Record<string, Go2rtcRaw | null> | null | undefined): StreamSummary[] {
  return Object.entries(data ?? {}).map(([name, info]) => {
    const producers = (info?.producers ?? []).filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
    const url = String(producers[0]?.url ?? "");
    let video: string | null = null;
    for (const p of producers) {
      video = producerVideo(p);
      if (video) break;
    }
    return {
      name,
      host: hostFromUrl(url),
      video,
      bytes: producers.reduce((sum, p) => sum + producerBytes(p), 0),
      active: producers.some(producerActive),
      consumers: (info?.consumers ?? []).filter(Boolean).length,
    };
  });
}

/** Formate, die Browser per WebRTC sicher abspielen. H.265 kann nur Safari (und auch nicht immer). */
export function browserPlayable(video: string | null): boolean | null {
  if (!video) return null;
  return /^(H264|VP8|VP9|AV1)$/i.test(video);
}

/**
 * Probleme, die man im Log sehen will: Streams mit Zuschauern, die nichts
 * von der Kamera bekommen, und Streams in einem Format, das Browser nicht
 * zuverlaessig abspielen. `prevBytes` sind die Bytes beim letzten Blick
 * (gleicher Stream, gleiche Zahl = es kommt nichts mehr).
 */
export function liveProblems(
  streams: StreamSummary[],
  prevBytes: Map<string, number> = new Map()
): { stalled: string[]; unplayable: string[] } {
  const stalled: string[] = [];
  const unplayable: string[] = [];
  for (const s of streams) {
    if (s.consumers > 0) {
      const before = prevBytes.get(s.name);
      if (!s.active || s.bytes === 0 || (before != null && s.bytes <= before)) stalled.push(s.name);
    }
    if (/_sub$/.test(s.name) && browserPlayable(s.video) === false) unplayable.push(`${s.name} (${s.video})`);
  }
  return { stalled, unplayable };
}

/** Eine Zeile fuers Hub-Log; null, wenn alles gut ist. */
export function liveProblemLine(p: { stalled: string[]; unplayable: string[] }, total: number): string | null {
  const parts: string[] = [];
  if (p.stalled.length) parts.push(`${p.stalled.length}/${total} ohne Daten von der Kamera: ${p.stalled.join(", ")}`);
  if (p.unplayable.length) parts.push(`Format nicht abspielbar: ${p.unplayable.join(", ")}`);
  return parts.length ? `go2rtc: ${parts.join(" · ")}` : null;
}
