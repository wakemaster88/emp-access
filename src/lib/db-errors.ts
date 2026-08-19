/** Neon-WebSocket / Prisma-Adapter: Login wird nach Fehlschlag gecacht. */
const TRANSIENT_DB_RE =
  /server_login_retry|server login has been failing|connect failed|Can't reach database|Connection terminated|Timed out fetching|ECONNRESET|ETIMEDOUT/i;

export function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_DB_RE.test(msg);
}

export function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

export function userFacingDbError(err: unknown): string {
  if (isTransientDbError(err)) {
    return "Die Datenbank ist gerade überlastet. Bitte in ein paar Sekunden erneut versuchen.";
  }
  if (isUniqueConstraintError(err)) {
    return "Dieses Kennzeichen ist bereits angelegt. Bitte unter „Bestehendes“ zuordnen.";
  }
  return err instanceof Error ? err.message : "Fehler";
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientDbError(err) || i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
  throw last;
}
