/**
 * IPv4-Subnetz-Helfer fuer die automatische VLAN-Erkennung: Ein Geraet wird
 * dem VLAN zugeordnet, in dessen `subnet` (CIDR) seine IP-Adresse faellt.
 */

export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

/** Prueft, ob eine IPv4-Adresse in einem CIDR-Bereich liegt (z. B. "192.168.10.0/24"). */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.trim().split("/");
  const prefix = Number(prefixRaw);
  if (!network || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;

  const ipInt = ipToInt(ip);
  const netInt = ipToInt(network);
  if (ipInt === null || netInt === null) return false;
  if (prefix === 0) return true;

  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/**
 * Findet das passende VLAN fuer eine IP. Bei mehreren Treffern gewinnt das
 * spezifischste Subnetz (laengster Prefix).
 */
export function findVlanForIp<T extends { id: number; subnet: string | null }>(
  ip: string | null | undefined,
  vlans: T[]
): T | null {
  if (!ip) return null;
  let best: T | null = null;
  let bestPrefix = -1;
  for (const vlan of vlans) {
    if (!vlan.subnet) continue;
    const prefix = Number(vlan.subnet.split("/")[1]);
    if (!Number.isInteger(prefix)) continue;
    if (ipInCidr(ip, vlan.subnet) && prefix > bestPrefix) {
      best = vlan;
      bestPrefix = prefix;
    }
  }
  return best;
}

/**
 * Findet den passenden Netzwerk-Bereich fuer eine IP anhand von ipFrom/ipTo.
 * Bei Ueberlappungen gewinnt die engste Range (kleinste Spanne).
 */
export function findAreaForIp<
  T extends { id: number; ipFrom: string | null; ipTo: string | null },
>(ip: string | null | undefined, areas: T[]): T | null {
  if (!ip) return null;
  const ipInt = ipToInt(ip);
  if (ipInt === null) return null;
  let best: T | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const area of areas) {
    if (!area.ipFrom || !area.ipTo) continue;
    const from = ipToInt(area.ipFrom);
    const to = ipToInt(area.ipTo);
    if (from === null || to === null) continue;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (ipInt < lo || ipInt > hi) continue;
    const span = hi - lo;
    if (span < bestSpan) {
      best = area;
      bestSpan = span;
    }
  }
  return best;
}
