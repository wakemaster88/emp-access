/**
 * Bilder für Social-Media-Beiträge: auf dem Server neu kodiert (nach EXIF
 * gedreht, ohne Metadaten und GPS) und im öffentlichen Blob-Speicher
 * (BLOB_READ_WRITE_TOKEN, derselbe wie Audio) unter social/<accountId>/
 * abgelegt. Die Bilder sind für die Veröffentlichung gedacht; die Adresse
 * hat einen zufälligen Teil und steht nirgends in einer Liste.
 *
 * Gelöscht wird nichts automatisch: Eine kopierte Bildadresse kann in einem
 * Newsletter stehen, der sonst ein kaputtes Bild zeigte.
 */
import { randomBytes } from "node:crypto";
import { publicBlobToken } from "@/lib/blob-token";

/** Größte Datei, die der Browser schicken darf (Vercel nimmt 4,5 MB). */
export const SOCIAL_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Längste Kante: reicht für Instagram (1080 × 1350) mit Reserve. */
export const SOCIAL_IMAGE_PX = 1440;
const MAX_INPUT_PIXELS = 40_000_000;

export interface EncodedImage {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: "image/jpeg";
}

/** JPEG mit höchstens SOCIAL_IMAGE_PX an der längsten Kante, oder null, wenn das Bild nicht lesbar ist. */
export async function encodeSocialImage(bytes: Uint8Array): Promise<EncodedImage | null> {
  try {
    const sharp = (await import("sharp")).default;
    // rotate() ohne Winkel richtet nach EXIF aus; ohne withMetadata() schreibt
    // sharp keine Metadaten (EXIF, GPS, Profile) in die Ausgabe.
    const out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize(SOCIAL_IMAGE_PX, SOCIAL_IMAGE_PX, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    return { bytes: new Uint8Array(out), contentType: "image/jpeg" };
  } catch (e) {
    console.error("[social] Bild nicht lesbar:", e instanceof Error ? e.message : e);
    return null;
  }
}

export function socialMediaPath(accountId: number, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `social/${accountId}/${stamp}-${randomBytes(6).toString("hex")}.jpg`;
}

/** Öffentlicher Speicher konfiguriert? Token immer ausdrücklich, sonst nimmt @vercel/blob per OIDC den privaten Speicher. */
export function socialMediaToken(): string | undefined {
  return publicBlobToken();
}

/** Bild ablegen; liefert die öffentliche Adresse. */
export async function storeSocialImage(accountId: number, image: EncodedImage): Promise<string> {
  const token = socialMediaToken();
  if (!token) throw new Error("Der Bilder-Speicher ist nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt)");
  const { put } = await import("@vercel/blob");
  const blob = await put(socialMediaPath(accountId), Buffer.from(image.bytes), {
    access: "public",
    contentType: image.contentType,
    addRandomSuffix: false,
    cacheControlMaxAge: 60 * 60 * 24 * 365,
    token,
  });
  return blob.url;
}
