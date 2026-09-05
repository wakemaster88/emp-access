/**
 * Prueft, ob die Row-Level-Security-Policies fuer die Verbindung der App
 * ueberhaupt greifen. PostgreSQL wendet RLS NICHT an fuer den Tabellen-Owner
 * (ohne FORCE ROW LEVEL SECURITY) und fuer Rollen mit BYPASSRLS. Verbindet
 * die App als Owner (Neon-Standard: neondb_owner), sind die Policies reine
 * Dekoration – die Mandantentrennung passiert dann allein im Code
 * (src/lib/prisma.ts, tenantClient).
 *
 * Aufruf: DATABASE_URL=... npx tsx scripts/db-rls-check.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import "dotenv/config";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

type Row = {
  current_user: string;
  owner: string | null;
  bypassrls: boolean | null;
  forced: boolean | null;
  rls_enabled: boolean | null;
  policies: number;
};

async function main() {
  const [row] = await prisma.$queryRaw<Row[]>`
    SELECT current_user::text AS current_user,
           (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'Ticket') AS owner,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls,
           (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'Ticket' AND relnamespace = 'public'::regnamespace) AS forced,
           (SELECT relrowsecurity FROM pg_class WHERE relname = 'Ticket' AND relnamespace = 'public'::regnamespace) AS rls_enabled,
           (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') AS policies
  `;

  const isOwner = row.owner === row.current_user;
  const enforced = Boolean(row.rls_enabled) && !row.bypassrls && (!isOwner || Boolean(row.forced));

  console.log(`Verbunden als:        ${row.current_user}`);
  console.log(`Owner von "Ticket":   ${row.owner}`);
  console.log(`BYPASSRLS:            ${row.bypassrls}`);
  console.log(`RLS aktiv / FORCE:    ${row.rls_enabled} / ${row.forced}`);
  console.log(`Policies (public):    ${row.policies}`);
  console.log("");
  console.log(
    enforced
      ? "RLS GREIFT fuer diese Verbindung. Achtung: der rohe Client (Cron, oeffentliche Token-Endpunkte) wuerde ohne set_config keine Zeilen sehen."
      : "RLS greift NICHT fuer diese Verbindung (Owner bzw. BYPASSRLS). Mandantentrennung laeuft ueber tenantClient im Code.",
  );
  await prisma.$disconnect();
  process.exit(enforced ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
