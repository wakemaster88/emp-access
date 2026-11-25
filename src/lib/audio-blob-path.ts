/**
 * Pfade der Audio-Dateien im Blob-Speicher – reine Hilfsfunktionen für
 * Browser, API und Tests, ohne Server-Importe.
 *
 * Neue Dateien liegen je Mandant unter `audio/<accountId>/` (Uploads) und
 * `audio/tts/<accountId>/` (gerenderte Ansagen). Ältere Einträge haben noch
 * Pfade ohne Mandant: einen blanken Dateinamen (Upload) oder
 * `audio/tts/<hash>.mp3` (Ansage, gemeinsam für gleiche Texte).
 */

/** Präfix für hochgeladene Audio-Dateien eines Mandanten. */
export function audioUploadPrefix(accountId: number | null | undefined): string {
  return `audio/${accountId ?? "shared"}/`;
}

/** Präfix für gerenderte Sprachansagen eines Mandanten. */
export function ttsBlobPrefix(accountId: number): string {
  return `audio/tts/${accountId}/`;
}

/** Pfad, unter dem der Browser eine Datei hochlädt. */
export function audioUploadPath(accountId: number | null | undefined, fileName: string): string {
  return audioUploadPrefix(accountId) + safeFileName(fileName);
}

/** Pfad einer gerenderten Ansage. */
export function ttsBlobPath(accountId: number, hash: string): string {
  return `${ttsBlobPrefix(accountId)}${hash}.mp3`;
}

/** Dateiname ohne Verzeichnisanteile, damit er unter dem Präfix bleibt. */
function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop()?.trim() ?? "";
  return base && base !== "." && base !== ".." ? base : "datei";
}

/** Ein einzelner Dateiname: kein Verzeichnis, kein Steuerzeichen. */
function isPlainFileName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !/[\\/\u0000-\u001f]/.test(name);
}

/**
 * Welche Upload-Pfade das Upload-Token zulässt: der Mandanten-Pfad aus dem
 * aktuellen Browser-Code oder – für noch offene Tabs mit älterem Code – ein
 * blanker Dateiname.
 */
export function isAllowedAudioUploadPath(
  pathname: string,
  accountId: number | null | undefined,
): boolean {
  const prefix = audioUploadPrefix(accountId);
  if (pathname.startsWith(prefix)) return isPlainFileName(pathname.slice(prefix.length));
  return isPlainFileName(pathname);
}

/** Pfad, der zu einer Blob-URL gehört, oder null, wenn es keine Blob-URL ist. */
export function blobPathFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".blob.vercel-storage.com")) {
    return null;
  }
  try {
    const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return path || null;
  } catch {
    return null;
  }
}

/** Liegt der Pfad im Bereich des Mandanten (Upload oder Ansage)? */
export function isOwnAudioBlobPath(pathname: string, accountId: number): boolean {
  for (const prefix of [audioUploadPrefix(accountId), ttsBlobPrefix(accountId)]) {
    if (pathname.startsWith(prefix)) return isPlainFileName(pathname.slice(prefix.length));
  }
  return false;
}

/**
 * Den vom Client gemeldeten Pfad nur übernehmen, wenn er zur gespeicherten URL
 * passt und im Bereich des Mandanten liegt – sonst bleibt der Eintrag ohne
 * Pfad (die Datei spielt trotzdem, wird beim Löschen aber nicht angefasst).
 */
export function acceptedAudioBlobPath(
  clientPath: unknown,
  url: string,
  accountId: number,
): string | null {
  if (typeof clientPath !== "string") return null;
  const path = clientPath.trim();
  if (!path || blobPathFromUrl(url) !== path) return null;
  return isOwnAudioBlobPath(path, accountId) ? path : null;
}

/** Endungen, die ein alter Upload-Dateiname haben muss, damit er als Audio-Datei gilt. */
const LEGACY_AUDIO_EXTENSION = /\.(mp3|mpeg|mpga|wav|ogg|oga|opus|flac|m4a|mp4|aac|webm)$/i;

/**
 * Pfad aus der Zeit ohne Mandanten-Präfix: Upload-Dateiname mit Audio-Endung
 * oder gemeinsame Ansage.
 */
export function isLegacyAudioBlobPath(pathname: string): boolean {
  return (
    (isPlainFileName(pathname) && LEGACY_AUDIO_EXTENSION.test(pathname)) ||
    /^audio\/tts\/[0-9a-f]{16,128}\.mp3$/.test(pathname)
  );
}

/**
 * Wie die Datei eines Eintrags beim Löschen behandelt wird:
 * "own" – im Bereich des Mandanten;
 * "legacy" – alter Pfad ohne Mandant;
 * "keep" – Datei bleibt liegen.
 * In beiden Fällen darf die Datei nur weg, wenn kein anderer Eintrag sie nutzt.
 * Maßgeblich sind der gespeicherte Pfad und die gespeicherte URL des Eintrags.
 */
export function audioBlobDeleteMode(
  row: { blobPathname: string | null; url: string },
  accountId: number,
): "own" | "legacy" | "keep" {
  const path = row.blobPathname;
  if (!path || blobPathFromUrl(row.url) !== path) return "keep";
  if (isOwnAudioBlobPath(path, accountId)) return "own";
  if (isLegacyAudioBlobPath(path)) return "legacy";
  return "keep";
}
