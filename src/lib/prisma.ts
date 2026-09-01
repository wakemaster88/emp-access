import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";

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
 * (Super-Admin) oder der mandantengebundene Client aus `tenantClient`.
 *
 * Beide teilen sich bewusst denselben Typ. Waeren es zwei - der rohe Client
 * und der `$extends`-Typ - muesste TypeScript an jedem `db.model.query()` zwei
 * riesige, strukturell verschiedene Client-Typen gegeneinander aufloesen und
 * bricht ab Schema-Groessen wie unserer mit TS2349 bzw. TS2859 ("Excessive
 * complexity comparing types") ab - und zwar in beliebigen anderen Dateien,
 * sobald irgendwo ein Feld dazukommt.
 */
export type TenantDb = PrismaClient;

/**
 * Mandantengebundener Client: setzt vor jeder Query `app.current_tenant_id`,
 * damit die RLS-Policies greifen.
 *
 * Der Rueckgabetyp ist absichtlich auf `PrismaClient` festgenagelt. Die
 * Erweiterung haengt nur Kontext an jede Query und laesst die Client-API
 * unveraendert - siehe `TenantDb` fuer den Grund.
 */
export function tenantClient(accountId: number): PrismaClient {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(accountId)}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  }) as unknown as PrismaClient;
}

export { prisma as superAdminClient };
