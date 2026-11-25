import { createHash } from "node:crypto";

/**
 * Schwaches ETag ueber eine JSON-Antwort. Gleiche Daten ergeben dasselbe
 * ETag, jede Aenderung im Body ein anderes.
 */
export function jsonEtag(body: unknown): string {
  const hash = createHash("sha1").update(JSON.stringify(body)).digest("base64url").slice(0, 16);
  return `W/"${hash}"`;
}

/** Prueft `If-None-Match` gegen ein ETag (Liste mit ", ", weak oder strong). */
export function ifNoneMatchMatches(headerValue: string | null, etag: string): boolean {
  if (!headerValue) return false;
  return headerValue
    .split(",")
    .map((v) => v.trim())
    .some((v) => v === etag || v === etag.replace(/^W\//, "") || `W/${v}` === etag);
}
