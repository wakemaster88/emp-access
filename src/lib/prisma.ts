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

export function tenantClient(accountId: number) {
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
  });
}

export { prisma as superAdminClient };
