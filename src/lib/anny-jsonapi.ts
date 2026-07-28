/**
 * ANNY listet Buchungen oft im JSON:API-Format ({ id, type, attributes, relationships } + included).
 * Ohne Normalisierung fehlen u. a. `status`, `number`, Scan-Felder und `customer` auf Top-Level —
 * das führt zu leeren Status-Arrays (fälschlich INVALID) und Fallback auf die Buchungsnr. statt QR-Token.
 */

import type { AnnyBooking } from "@/lib/anny-types";

type JsonApiRel = {
  data?: { id?: string | number; type?: string } | { id?: string | number; type?: string }[] | null;
};

type JsonApiResource = {
  id?: string | number;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, JsonApiRel>;
};

function flattenResource(r: JsonApiResource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (r.attributes && typeof r.attributes === "object") {
    Object.assign(out, r.attributes);
  }
  if (r.id != null) out.id = r.id;
  return out;
}

function buildIncludedMap(included: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(included)) return map;
  for (const item of included) {
    if (!item || typeof item !== "object") continue;
    const r = item as JsonApiResource;
    if (r.type == null || r.id == null) continue;
    const key = `${r.type}:${String(r.id)}`;
    map.set(key, flattenResource(r));
  }
  return map;
}

function resolveRel(
  rel: JsonApiRel | undefined,
  inc: Map<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  if (!rel?.data) return undefined;
  const d = Array.isArray(rel.data) ? rel.data[0] : rel.data;
  if (!d?.type || d.id == null) return undefined;
  return inc.get(`${d.type}:${String(d.id)}`);
}

/**
 * Ein Listeneintrag aus GET /bookings → flaches Objekt wie unser AnnyBooking-Shape.
 */
export function normalizeAnnyBookingItem(
  raw: unknown,
  includedMap: Map<string, Record<string, unknown>>,
): AnnyBooking | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // Bereits „flach“ (Webhook, Tests)
  if (o.attributes === undefined && o.relationships === undefined) {
    return raw as AnnyBooking;
  }

  const r = raw as JsonApiResource;
  const flat = flattenResource(r);
  const rels = r.relationships;

  if (rels) {
    const pairs: [string, string][] = [
      ["customer", "customer"],
      ["resource", "resource"],
      ["service", "service"],
      ["subscription", "subscription"],
      ["ticket", "ticket"],
      ["order", "order"],
    ];
    for (const [relKey, prop] of pairs) {
      const resolved = resolveRel(rels[relKey], includedMap);
      if (resolved) flat[prop] = resolved;
    }
  }

  return flat as unknown as AnnyBooking;
}

/** Parst die komplette Antwort von GET /api/v1/bookings (o. ä.). */
export function normalizeAnnyBookingsResponse(json: unknown): AnnyBooking[] {
  const root = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const data = (Array.isArray(json) ? json : root?.data) as unknown[] | undefined;
  if (!Array.isArray(data)) return [];

  const included = root?.included;
  const incMap = buildIncludedMap(included);

  const out: AnnyBooking[] = [];
  for (const item of data) {
    const b = normalizeAnnyBookingItem(item, incMap);
    if (b) out.push(b);
  }
  return out;
}
