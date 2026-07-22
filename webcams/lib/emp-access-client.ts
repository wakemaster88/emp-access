/**
 * HTTP-Client für emp-access.de (Bearer-Token).
 * Response-Formate können je nach Version variieren — wir parsen defensiv.
 */

export class EmpAccessHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public bodySnippet: string,
  ) {
    super(message);
    this.name = "EmpAccessHttpError";
  }
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export async function empAccessGetJson(
  baseUrl: string,
  apiToken: string,
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = joinUrl(baseUrl, path);
  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new EmpAccessHttpError(
      `emp-access HTTP ${r.status}`,
      r.status,
      text.slice(0, 400),
    );
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/** Extrahiert eine Geräteliste aus typischen API-Antwortformen. */
export function extractDevicesArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.filter((x) => x && typeof x === "object") as Record<
      string,
      unknown
    >[];
  }
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["devices", "data", "items", "results"]) {
      const v = o[key];
      if (Array.isArray(v)) {
        return v.filter((x) => x && typeof x === "object") as Record<
          string,
          unknown
        >[];
      }
    }
  }
  return [];
}

export function deviceNumericId(d: Record<string, unknown>): number | null {
  const v = d.id ?? d.deviceId ?? d.ID;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

export function findDeviceById(
  list: Record<string, unknown>[],
  id: number,
): Record<string, unknown> | undefined {
  return list.find((d) => deviceNumericId(d) === id);
}
