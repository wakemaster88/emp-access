import { redirect } from "next/navigation";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";

/**
 * Sitzung für die Seiten der Warenwirtschaft. Die Daten gehören zu einem
 * Konto; der Super-Admin ohne Konto landet auf der Startseite.
 */
export async function wawiPageSession() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  const accountId = session.user.accountId;
  if (!accountId) redirect("/");
  return { session, accountId, db: tenantClient(accountId) };
}
