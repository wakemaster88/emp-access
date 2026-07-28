/**
 * Notfallschluessel: schaltet die Zwei-Faktor-Anmeldung eines Admins ab.
 *
 * Gedacht fuer den Fall, dass niemand mehr hineinkommt – typischerweise der
 * SUPER_ADMIN, den kein anderer zuruecksetzen kann. Fuer Mandanten-Benutzer
 * geht es bequemer ueber /admin/accounts.
 *
 * Aufruf:
 *   npx tsx scripts/reset-2fa.ts admin@emp-access.de
 *   npx tsx scripts/reset-2fa.ts admin@emp-access.de --list
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  const email = args.find((a) => !a.startsWith("--"))?.trim();

  if (listOnly && !email) {
    const admins = await prisma.admin.findMany({
      select: { email: true, name: true, role: true, twoFactorEnabledAt: true, twoFactorLockedUntil: true },
      orderBy: { email: "asc" },
    });
    for (const a of admins) {
      const state = a.twoFactorEnabledAt ? "2FA aktiv" : "2FA aus";
      const locked = a.twoFactorLockedUntil && a.twoFactorLockedUntil > new Date() ? " (gesperrt)" : "";
      console.log(`${a.email.padEnd(34)} ${a.role.padEnd(12)} ${state}${locked}`);
    }
    return;
  }

  if (!email) {
    console.error("Aufruf: npx tsx scripts/reset-2fa.ts <email> [--list]");
    process.exitCode = 1;
    return;
  }

  const admin = await prisma.admin.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, twoFactorEnabledAt: true },
  });

  if (!admin) {
    console.error(`Kein Admin mit E-Mail ${email} gefunden.`);
    process.exitCode = 1;
    return;
  }

  if (listOnly) {
    console.log(`${admin.email} – 2FA ${admin.twoFactorEnabledAt ? "aktiv" : "aus"}`);
    return;
  }

  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorRecoveryCodes: [],
      twoFactorLastStep: null,
      twoFactorFailures: 0,
      twoFactorLockedUntil: null,
    },
  });

  console.log(`Zwei-Faktor fuer ${admin.email} (${admin.name}) zurueckgesetzt.`);
  console.log("Anmeldung laeuft jetzt wieder nur ueber das Passwort – bitte umgehend neu einrichten.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
