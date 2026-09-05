/**
 * Bilder und PDFs im Vercel-Blob-Speicher statt als BYTEA in Postgres.
 *
 * Neon berechnet Speicher plus History fuer Point-in-Time-Recovery; ein
 * JPEG pro Scan ein Jahr lang in der Datenbank war der groesste Posten. Im
 * Blob-Speicher liegen die Dateien privat (nur mit Server-Token lesbar) und
 * kosten einen Bruchteil. Die Datenbank haelt nur noch den Pfad.
 *
 * Ohne BLOB_READ_WRITE_TOKEN fallen alle Schreiber auf Bytes in der DB
 * zurueck; die Leser koennen beides. `scripts/migrate-images-to-blob.ts`
 * zieht den Altbestand um, `gcOrphanBlobs` raeumt Dateien weg, deren
 * Datensatz per Cascade verschwunden ist.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const BLOB_PREFIXES = [
  "scan-snapshots",
  "person-sightings",
  "vehicle-sightings",
  "alert-images",
  "key-pdfs",
] as const;
export type BlobPrefix = (typeof BLOB_PREFIXES)[number];

/** Frische Uploads, deren Datensatz vielleicht noch nicht geschrieben ist, bleiben unangetastet. */
const GC_MIN_AGE_MS = 24 * 60 * 60_000;
const DEL_BATCH = 100;

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Laedt Bytes privat in den Blob-Speicher. Liefert den Pfad, oder null,
 * wenn kein Token gesetzt ist oder der Upload fehlschlaegt – der Aufrufer
 * speichert dann die Bytes in der Datenbank.
 */
export async function storeBlob(
  prefix: BlobPrefix,
  accountId: number,
  bytes: Uint8Array,
  contentType: string,
  ext: string,
): Promise<string | null> {
  if (!blobConfigured() || bytes.length === 0) return null;
  const pathname = `${prefix}/${accountId}/${Date.now()}-${randomBytes(12).toString("base64url")}.${ext}`;
  try {
    const { put } = await import("@vercel/blob");
    const res = await put(pathname, Buffer.from(bytes), {
      access: "private",
      contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return res.pathname;
  } catch (err) {
    console.error(`[blob] Upload fehlgeschlagen (${pathname}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Datei aus dem Blob-Speicher lesen; null bei fehlendem Token, 404 oder Fehler. */
export async function readBlob(pathname: string): Promise<Buffer | null> {
  if (!blobConfigured()) return null;
  try {
    const { get } = await import("@vercel/blob");
    const res = await get(pathname, { access: "private" });
    if (!res || res.statusCode !== 200) return null;
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  } catch (err) {
    console.error(`[blob] Lesen fehlgeschlagen (${pathname}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Bytes eines Datensatzes: bevorzugt den Blob, sonst die Spalte in der DB.
 * Uebergangsfreundlich fuer Altbestand, der noch nicht umgezogen ist.
 */
export async function resolveBinary(row: {
  blob?: string | null;
  bytes?: Uint8Array | null;
}): Promise<Buffer | null> {
  if (row.blob) {
    const fromBlob = await readBlob(row.blob);
    if (fromBlob) return fromBlob;
  }
  if (row.bytes && row.bytes.length > 0) return Buffer.from(row.bytes);
  return null;
}

/** Dateien loeschen; unbekannte Pfade ignoriert der Dienst. */
export async function deleteBlobs(pathnames: Array<string | null | undefined>): Promise<number> {
  const list = pathnames.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (list.length === 0 || !blobConfigured()) return 0;
  const { del } = await import("@vercel/blob");
  for (let i = 0; i < list.length; i += DEL_BATCH) {
    try {
      await del(list.slice(i, i + DEL_BATCH));
    } catch (err) {
      console.error("[blob] Loeschen fehlgeschlagen:", err instanceof Error ? err.message : err);
    }
  }
  return list.length;
}

async function existingPaths(prefix: BlobPrefix, paths: string[]): Promise<Set<string>> {
  const where = { in: paths };
  switch (prefix) {
    case "scan-snapshots": {
      const rows = await prisma.scanSnapshot.findMany({ where: { blobPathname: where }, select: { blobPathname: true } });
      return new Set(rows.map((r) => r.blobPathname!));
    }
    case "person-sightings": {
      const rows = await prisma.personSighting.findMany({ where: { snapshotBlob: where }, select: { snapshotBlob: true } });
      return new Set(rows.map((r) => r.snapshotBlob!));
    }
    case "vehicle-sightings": {
      const rows = await prisma.vehicleSighting.findMany({ where: { snapshotBlob: where }, select: { snapshotBlob: true } });
      return new Set(rows.map((r) => r.snapshotBlob!));
    }
    case "alert-images": {
      const rows = await prisma.monitorAlertImage.findMany({ where: { blobPathname: where }, select: { blobPathname: true } });
      return new Set(rows.map((r) => r.blobPathname!));
    }
    case "key-pdfs": {
      const rows = await prisma.keySignature.findMany({ where: { pdfBlob: where }, select: { pdfBlob: true } });
      return new Set(rows.map((r) => r.pdfBlob!));
    }
  }
}

/**
 * Verwaiste Dateien einsammeln: Datensaetze verschwinden auch per Cascade
 * (Ticket geloescht → Scans → Snapshots), ohne dass ein Codepfad die Blobs
 * kennt. Der naechtliche Cron listet jeden Praefix und loescht, was in der
 * Datenbank nicht mehr referenziert wird.
 */
export async function gcOrphanBlobs(now = new Date()): Promise<{ listed: number; deleted: number }> {
  if (!blobConfigured()) return { listed: 0, deleted: 0 };
  const { list } = await import("@vercel/blob");
  let listed = 0;
  let deleted = 0;
  const minAge = now.getTime() - GC_MIN_AGE_MS;

  for (const prefix of BLOB_PREFIXES) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${prefix}/`, cursor, limit: 1000 });
      cursor = page.hasMore ? page.cursor : undefined;
      const candidates = page.blobs
        .filter((b) => new Date(b.uploadedAt).getTime() < minAge)
        .map((b) => b.pathname);
      listed += page.blobs.length;
      if (candidates.length === 0) continue;
      const known = await existingPaths(prefix, candidates);
      const orphans = candidates.filter((p) => !known.has(p));
      deleted += await deleteBlobs(orphans);
    } while (cursor);
  }
  return { listed, deleted };
}

/** Sichtungs-Snapshot: Blob-Pfad, sonst Bytes in der Spalte `snapshot`. */
export async function storeSightingSnapshot(
  prefix: "person-sightings" | "vehicle-sightings",
  accountId: number,
  snapshot: Uint8Array<ArrayBuffer> | null,
): Promise<{ snapshot?: Uint8Array<ArrayBuffer>; snapshotBlob?: string }> {
  if (!snapshot || snapshot.length === 0) return {};
  const path = await storeBlob(prefix, accountId, snapshot, "image/jpeg", "jpg");
  return path ? { snapshotBlob: path } : { snapshot };
}

/** Bild-Spalte (`image`/`blobPathname`) fuer ScanSnapshot und MonitorAlertImage. */
export async function storeImageColumn(
  prefix: "scan-snapshots" | "alert-images",
  accountId: number,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<{ image?: Uint8Array<ArrayBuffer>; blobPathname?: string }> {
  const path = await storeBlob(prefix, accountId, bytes, "image/jpeg", "jpg");
  return path ? { blobPathname: path } : { image: bytes };
}

/** PDF-Spalte (`pdf`/`pdfBlob`) fuer KeySignature. */
export async function storePdfColumn(
  accountId: number,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<{ pdf?: Uint8Array<ArrayBuffer>; pdfBlob?: string }> {
  const path = await storeBlob("key-pdfs", accountId, bytes, "application/pdf", "pdf");
  return path ? { pdfBlob: path } : { pdf: bytes };
}
