/**
 * Challenge-Fotos auf dem Server neu kodieren: gespeichert und an andere
 * Kunden ausgeliefert wird nur das Ergebnis, nie die hochgeladene Datei.
 */
import {
  CHALLENGE_PHOTO_MAX_INPUT_PIXELS,
  CHALLENGE_PHOTO_PX,
  CHALLENGE_THUMB_PX,
} from "./challenge-voting-rules";

export interface EncodedJpeg {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: "image/jpeg";
  ext: "jpg";
}

async function toJpeg(bytes: Uint8Array, maxPx: number, quality: number): Promise<EncodedJpeg> {
  const sharp = (await import("sharp")).default;
  // rotate() ohne Winkel richtet nach EXIF aus; ohne withMetadata() schreibt
  // sharp keine Metadaten (EXIF, GPS, Profile) in die Ausgabe.
  const out = await sharp(bytes, { limitInputPixels: CHALLENGE_PHOTO_MAX_INPUT_PIXELS, failOn: "error" })
    .rotate()
    .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return { bytes: new Uint8Array(out), contentType: "image/jpeg", ext: "jpg" };
}

/**
 * Foto als JPEG mit höchstens CHALLENGE_PHOTO_PX an der längsten Kante, nach
 * EXIF gedreht und ohne Metadaten. null, wenn sich das Bild nicht lesen lässt
 * oder zu groß ist.
 */
export async function encodeChallengePhoto(bytes: Uint8Array): Promise<EncodedJpeg | null> {
  try {
    return await toJpeg(bytes, CHALLENGE_PHOTO_PX, 85);
  } catch (e) {
    console.error("[challenge] Foto nicht lesbar:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Vorschaubild mit höchstens CHALLENGE_THUMB_PX an der längsten Kante, oder null. */
export async function encodeChallengeThumb(bytes: Uint8Array): Promise<EncodedJpeg | null> {
  try {
    return await toJpeg(bytes, CHALLENGE_THUMB_PX, 78);
  } catch (e) {
    console.error("[challenge] Vorschaubild fehlgeschlagen:", e instanceof Error ? e.message : e);
    return null;
  }
}
