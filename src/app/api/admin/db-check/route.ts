import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Row = {
  current_user: string;
  owner: string | null;
  bypassrls: boolean | null;
  forced: boolean | null;
  rls_enabled: boolean | null;
  policies: number;
};

/**
 * GET (SUPER_ADMIN): Zeigt, ob die RLS-Policies fuer die App-Verbindung
 * greifen. Gleiche Abfrage wie scripts/db-rls-check.ts, nur ohne Shell.
 */
export async function GET() {
  const session = await safeAuth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

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

  return NextResponse.json({
    currentUser: row.current_user,
    tableOwner: row.owner,
    bypassRls: row.bypassrls,
    rlsEnabled: row.rls_enabled,
    forced: row.forced,
    policies: row.policies,
    rlsEnforced: enforced,
    isolation: enforced ? "datenbank + tenantClient" : "tenantClient (ORM)",
  });
}
