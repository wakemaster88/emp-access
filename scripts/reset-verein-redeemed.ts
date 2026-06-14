/**
 * Einmal-Skript: Setzt faelschlich auf REDEEMED stehende Vereinsmitglieder-
 * Tickets zurueck auf VALID.
 *
 * Hintergrund: Ein frueherer Bug hat Vereinsmitglieder (Ticket mit vereinId,
 * aber ohne subscriptionId) beim Check-in/Scan dauerhaft auf REDEEMED gesetzt,
 * als waeren es Einzeltickets. Dadurch standen sie an JEDEM Tag als
 * „eingecheckt" und wurden am Drehkreuz spaeter mit „bereits eingelöst"
 * abgewiesen. Jahres-Mitgliedschaften muessen aber VALID bleiben.
 *
 * Dieses Skript betrifft NUR Tickets mit vereinId != null, subscriptionId == null
 * und status == REDEEMED. Vorhandene Scans (Audit/Tages-Check-in) bleiben
 * unangetastet – die tagesbezogene „eingecheckt"-Anzeige wird daraus abgeleitet.
 *
 * Aufruf:
 *   npx tsx scripts/reset-verein-redeemed.ts            # Dry-Run (nur Anzeige)
 *   npx tsx scripts/reset-verein-redeemed.ts --apply    # tatsaechlich zuruecksetzen
 *   VEREIN_NAME="Tristar Oelde" npx tsx scripts/reset-verein-redeemed.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const apply = process.argv.includes("--apply");
  const vereinName = process.env.VEREIN_NAME?.trim();

  const where = {
    vereinId: { not: null },
    subscriptionId: null,
    status: "REDEEMED" as const,
    ...(vereinName ? { verein: { is: { name: vereinName } } } : {}),
  };

  const affected = await prisma.ticket.findMany({
    where,
    orderBy: [{ verein: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      verein: { select: { name: true } },
    },
  });

  if (affected.length === 0) {
    console.log(
      `Keine faelschlich auf REDEEMED stehenden Vereinsmitglieder gefunden${
        vereinName ? ` (Verein "${vereinName}")` : ""
      }.`,
    );
    return;
  }

  console.log(
    `${affected.length} Vereinsmitglieder-Ticket(s) auf REDEEMED${
      vereinName ? ` (Verein "${vereinName}")` : ""
    }:`,
  );
  for (const t of affected) {
    console.log(
      `  #${t.id} ${t.firstName ?? ""} ${t.lastName ?? ""}`.trimEnd() +
        ` [Verein: ${t.verein?.name ?? "—"}]`,
    );
  }

  if (!apply) {
    console.log(
      `\nDry-Run – es wurde nichts geaendert. Zum Zuruecksetzen auf VALID erneut mit --apply ausfuehren.`,
    );
    return;
  }

  const res = await prisma.ticket.updateMany({
    where,
    data: { status: "VALID", version: { increment: 1 } },
  });
  console.log(`\nOK: ${res.count} Ticket(s) auf status=VALID zurueckgesetzt.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
