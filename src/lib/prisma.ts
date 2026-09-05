import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { TENANT_MODELS } from "./tenant-models";

// HTTP statt WebSocket fuer Pool.query: auf Vercel sonst haeufig
// "server login has been failing, cached error: connect failed (server_login_retry)",
// sobald viele parallele Snapshot-Requests den WS-Pool belasten.
neonConfig.poolQueryViaFetch = true;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL!,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Prisma-Client, wie ihn die Endpunkte bekommen: entweder der rohe Client
 * (Super-Admin, Cron, oeffentliche Token-Endpunkte) oder der mandanten-
 * gebundene Client aus `tenantClient`.
 *
 * Beide teilen sich bewusst denselben Typ. Waeren es zwei - der rohe Client
 * und der `$extends`-Typ - muesste TypeScript an jedem `db.model.query()` zwei
 * riesige, strukturell verschiedene Client-Typen gegeneinander aufloesen und
 * bricht ab Schema-Groessen wie unserer mit TS2349 bzw. TS2859 ("Excessive
 * complexity comparing types") ab - und zwar in beliebigen anderen Dateien,
 * sobald irgendwo ein Feld dazukommt.
 */
export type TenantDb = PrismaClient;

type AnyArgs = Record<string, unknown> | undefined;

export class TenantMismatchError extends Error {
  constructor(model: string, expected: number, got: unknown) {
    super(`Mandanten-Verstoss bei ${model}: accountId ${String(got)} statt ${expected}`);
    this.name = "TenantMismatchError";
  }
}

/** Filter, der auf den Mandanten einschraenkt (der Account selbst ueber `id`). */
function scopeFor(model: string, accountId: number): Record<string, number> {
  return model === "Account" ? { id: accountId } : { accountId };
}

function mergeWhere(where: unknown, scope: Record<string, number>): Record<string, unknown> {
  if (!where || typeof where !== "object") return scope;
  return { AND: [scope, where] };
}

/**
 * `data` einer Schreiboperation: accountId setzen, falls er fehlt. Ein
 * abweichender accountId (oder `account.connect` auf einen fremden Account)
 * ist ein Programmierfehler und wirft sofort, statt still in einen anderen
 * Mandanten zu schreiben.
 */
function scopeData(model: string, data: unknown, accountId: number): unknown {
  if (model === "Account" || !data || typeof data !== "object" || Array.isArray(data)) return data;
  const d = data as Record<string, unknown>;
  if (d.accountId !== undefined) {
    if (d.accountId !== accountId) throw new TenantMismatchError(model, accountId, d.accountId);
    return d;
  }
  if (d.account && typeof d.account === "object") {
    const rel = d.account as { connect?: { id?: unknown } };
    if (rel.connect && rel.connect.id !== undefined && rel.connect.id !== accountId) {
      throw new TenantMismatchError(model, accountId, rel.connect.id);
    }
    return d;
  }
  return { ...d, accountId };
}

/**
 * Haengt den Mandanten-Filter an die Argumente einer Prisma-Operation.
 *
 * Seit Prisma 5 duerfen `findUnique`/`update`/`delete` neben dem eindeutigen
 * Schluessel weitere Filter tragen. Ein fremder Datensatz wird damit zu
 * "nicht gefunden" (null bzw. P2025), nie zu einem Treffer.
 */
export function scopeTenantArgs(
  model: string,
  operation: string,
  args: AnyArgs,
  accountId: number,
): AnyArgs {
  if (!TENANT_MODELS.has(model) && model !== "Account") return args;
  const scope = scopeFor(model, accountId);
  const a = args ?? {};
  switch (operation) {
    case "findMany":
    case "findFirst":
    case "findFirstOrThrow":
    case "count":
    case "aggregate":
    case "groupBy":
    case "updateMany":
    case "updateManyAndReturn":
    case "deleteMany":
      return { ...a, where: mergeWhere(a.where, scope) };
    case "findUnique":
    case "findUniqueOrThrow":
    case "update":
    case "delete":
      return { ...a, where: { ...((a.where as Record<string, unknown>) ?? {}), ...scope } };
    case "upsert":
      return {
        ...a,
        where: { ...((a.where as Record<string, unknown>) ?? {}), ...scope },
        create: scopeData(model, a.create, accountId),
      };
    case "create":
      return { ...a, data: scopeData(model, a.data, accountId) };
    case "createMany":
    case "createManyAndReturn":
      return {
        ...a,
        data: Array.isArray(a.data)
          ? a.data.map((d) => scopeData(model, d, accountId))
          : scopeData(model, a.data, accountId),
      };
    default:
      return args;
  }
}

/**
 * Mandantengebundener Client: haengt an jede Query den Account-Filter an
 * (Lesen, Zaehlen, Aendern, Loeschen) und setzt beim Anlegen den accountId.
 *
 * Frueher setzte diese Erweiterung vor jeder Query per Transaktion
 * `set_config('app.current_tenant_id')` fuer die RLS-Policies. Das kostete
 * vier Roundtrips pro Query ueber die WebSocket-Verbindung, und die Policies
 * greifen fuer die Tabellen-Owner-Rolle, mit der die App verbunden ist,
 * ohnehin nicht (`npx tsx scripts/db-rls-check.ts` prueft das gegen die
 * Datenbank). Die Isolation passiert jetzt im ORM, ohne zusaetzlichen
 * Datenbank-Roundtrip. Der rohe `prisma`-Client bleibt fuer Cron, Super-Admin
 * und oeffentliche Token-Endpunkte, die den accountId selbst mitgeben.
 *
 * Der Rueckgabetyp ist absichtlich auf `PrismaClient` festgenagelt, siehe
 * `TenantDb`.
 */
export function tenantClient(accountId: number): PrismaClient {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeTenantArgs(model, operation, args as AnyArgs, accountId) as typeof args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

export { prisma as superAdminClient };
