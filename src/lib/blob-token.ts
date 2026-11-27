/**
 * Token des privaten Blob-Speichers (src/lib/blob-store.ts). Der Speicher
 * hinter BLOB_READ_WRITE_TOKEN ist oeffentlich (Audio) und lehnt private
 * Dateien ab; er zaehlt hier deshalb nicht. Ohne Wert gibt es keinen Token.
 */
export function privateBlobToken(env: Record<string, string | undefined> = process.env): string | undefined {
  const token = env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim();
  return token ? token : undefined;
}
