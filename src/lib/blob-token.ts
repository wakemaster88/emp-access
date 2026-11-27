/**
 * Zugang zu den beiden Blob-Speichern.
 *
 * Privat (src/lib/blob-store.ts, Bilder und PDFs): ein eigener Speicher,
 * angebunden mit dem Praefix BLOB_PRIVATE. Mit statischem Token ergibt das
 * BLOB_PRIVATE_READ_WRITE_TOKEN, mit OIDC-Anbindung BLOB_PRIVATE_STORE_ID;
 * den OIDC-Token liefert Vercel mit jeder Anfrage. Bei OIDC geben wir Token
 * und Store-ID immer zusammen mit. Fehlt der Token, gibt es keinen Zugang:
 * @vercel/blob fiele sonst still auf BLOB_READ_WRITE_TOKEN zurueck, also auf
 * den oeffentlichen Audio-Speicher.
 *
 * Oeffentlich (Audio): BLOB_READ_WRITE_TOKEN, immer ausdruecklich
 * uebergeben. Ohne ausdruecklichen Token nimmt @vercel/blob zuerst
 * VERCEL_OIDC_TOKEN mit BLOB_STORE_ID, also unter Umstaenden einen anderen
 * Speicher.
 */
export type PrivateBlobAuth = { token: string } | { storeId: string; oidcToken: string };

type Env = Record<string, string | undefined>;

function clean(value: string | undefined | null): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Reine Auswahl aus Umgebung und (falls vorhanden) OIDC-Token der Anfrage. */
export function privateBlobAuthFrom(env: Env, oidcToken: string | undefined): PrivateBlobAuth | undefined {
  const token = clean(env.BLOB_PRIVATE_READ_WRITE_TOKEN);
  if (token) return { token };
  const storeId = clean(env.BLOB_PRIVATE_STORE_ID);
  const oidc = clean(oidcToken);
  if (storeId && oidc) return { storeId, oidcToken: oidc };
  return undefined;
}

/** Ist ein privater Speicher eingetragen (ohne zu pruefen, ob OIDC gerade da ist)? */
export function privateBlobConfigured(env: Env = process.env): boolean {
  return clean(env.BLOB_PRIVATE_READ_WRITE_TOKEN) !== undefined || clean(env.BLOB_PRIVATE_STORE_ID) !== undefined;
}

async function currentOidcToken(): Promise<string | undefined> {
  try {
    const { getVercelOidcTokenSync } = await import("@vercel/oidc");
    return clean(getVercelOidcTokenSync());
  } catch {
    return undefined;
  }
}

let warnedMissingOidc = false;

export async function privateBlobAuth(env: Env = process.env): Promise<PrivateBlobAuth | undefined> {
  const needsOidc = !clean(env.BLOB_PRIVATE_READ_WRITE_TOKEN) && clean(env.BLOB_PRIVATE_STORE_ID) !== undefined;
  const auth = privateBlobAuthFrom(env, needsOidc ? await currentOidcToken() : undefined);
  if (needsOidc && !auth && !warnedMissingOidc) {
    warnedMissingOidc = true;
    console.warn("[blob] BLOB_PRIVATE_STORE_ID gesetzt, aber kein OIDC-Token; Bilder bleiben in der Datenbank");
  }
  return auth;
}

export function publicBlobToken(env: Env = process.env): string | undefined {
  return clean(env.BLOB_READ_WRITE_TOKEN);
}
