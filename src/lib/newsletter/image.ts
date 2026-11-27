/**
 * Bilder für den Newsletter: Der Server kodiert jede hochgeladene Datei neu,
 * damit in der Mail nur Formate stehen, die Gmail, Outlook und Apple Mail
 * zeigen (JPEG, bei Transparenz PNG). AVIF und WebP von der Website werden so
 * brauchbar. Metadaten (EXIF, GPS) fallen dabei weg.
 */

/** Grenze der Anfrage bei Vercel liegt bei 4,5 MB; der Editor verkleinert größere Dateien vorher. */
export const NEWSLETTER_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** Doppelte Breite der Mail (600 px), damit Bilder auf Handys mit hoher Auflösung scharf sind. */
export const NEWSLETTER_IMAGE_WIDTH = 1200;
/** Sehr hohe Bilder (Plakate) nicht endlos lang werden lassen. */
export const NEWSLETTER_IMAGE_MAX_HEIGHT = 2400;
const MAX_INPUT_PIXELS = 40_000_000;

export interface EncodedNewsletterImage {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: "image/jpeg" | "image/png";
  ext: "jpg" | "png";
  width: number;
  height: number;
}

/**
 * Bild für die Mail: höchstens 1200 px breit, nach EXIF gedreht, ohne
 * Metadaten. Fotos werden JPEG, Bilder mit Transparenz (Logos) PNG.
 * null, wenn sich die Datei nicht als Bild lesen lässt oder zu groß ist.
 */
export async function encodeNewsletterImage(input: Uint8Array): Promise<EncodedNewsletterImage | null> {
  if (input.length === 0 || input.length > NEWSLETTER_IMAGE_MAX_BYTES) return null;
  try {
    const sharp = (await import("sharp")).default;
    const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const meta = await source.metadata();
    const transparent = meta.hasAlpha === true;
    const pipeline = source
      .rotate()
      .resize(NEWSLETTER_IMAGE_WIDTH, NEWSLETTER_IMAGE_MAX_HEIGHT, { fit: "inside", withoutEnlargement: true });
    const { data, info } = transparent
      ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer({ resolveWithObject: true })
      : await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return {
      bytes: new Uint8Array(data),
      contentType: transparent ? "image/png" : "image/jpeg",
      ext: transparent ? "png" : "jpg",
      width: info.width,
      height: info.height,
    };
  } catch (e) {
    console.error("[newsletter] Bild nicht lesbar:", e instanceof Error ? e.message : e);
    return null;
  }
}
