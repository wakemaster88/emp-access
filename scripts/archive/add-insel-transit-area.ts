/**
 * Zone "Insel": Transit-Bereich fuer alle gueltigen Wake-&-Ski- und SUP-Tickets.
 *
 * Analog zum Strandbad: Wer Wake/Ski oder SUP hat, darf durch die Insel, ohne
 * dass Slot/DURATION/Redeem an diesem Gate greifen. Strandbad-only und
 * Aquapark-only bleiben draussen.
 *
 * Idempotent, Namens-Match (keine hartkodierten IDs).
 *
 * Aufruf:
 *   npx tsx scripts/add-insel-transit-area.ts            # Vorschau
 *   APPLY=1 npx tsx scripts/add-insel-transit-area.ts    # schreiben
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const AREA_NAME = "Insel";

const WAKE_AND_SUP_SERVICES = [
  "Öffentlicher Betrieb - 1 Stunde",
  "Öffentlicher Betrieb - 2 Stunden",
  "Öffentlicher Betrieb - Tageskarte",
  "Ferienkurs",
  "Exklusive Bahnmiete A",
  "Exklusive Bahnmiete B",
  "Exklusiver Übungslift",
  "Anfängerkurs - Übungslift",
  "Anfängerkurs - Seilbahn B",
  "SUP",
];

const WAKE_AND_SUP_SUBSCRIPTIONS = [
  "Ride Abo",
  "Kids Abo",
  "Ride + Gear Abo",
  "Mitarbeiter",
];

/** Service, deren Hauptressource fehlt und sonst Insel als verbrauchend zaehlen wuerde. */
const REQUIRE_MAIN: Record<string, string> = {
  SUP: "SUP",
};

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(apply ? "MODUS: APPLY (schreibt)\n" : "MODUS: DRY-RUN (zeigt nur, schreibt nichts)\n");

  const accounts = await prisma.account.findMany({ select: { id: true, name: true } });
  let changed = 0;

  for (const account of accounts) {
    const existing = await prisma.accessArea.findFirst({
      where: { accountId: account.id, name: AREA_NAME },
      select: { id: true },
    });

    let inselId = existing?.id ?? null;
    if (inselId == null) {
      console.log(`Account #${account.id} "${account.name}": Area "${AREA_NAME}" anlegen.`);
      if (apply) {
        const created = await prisma.accessArea.create({
          data: {
            name: AREA_NAME,
            allowReentry: true,
            showOnDashboard: true,
            accountId: account.id,
          },
        });
        inselId = created.id;
      }
      changed++;
    } else {
      console.log(`Account #${account.id} "${account.name}": Area "${AREA_NAME}" bereits #${inselId}.`);
    }

    if (inselId == null && !apply) {
      console.log("  (dry-run: weitere Schritte so tun, als waere die Area da)\n");
      continue;
    }
    if (inselId == null) continue;

    const services = await prisma.service.findMany({
      where: { accountId: account.id, name: { in: WAKE_AND_SUP_SERVICES } },
      select: {
        id: true,
        name: true,
        mainAccessAreaId: true,
        serviceAreas: { select: { accessAreaId: true } },
      },
    });

    for (const svc of services) {
      const hasInsel = svc.serviceAreas.some((sa) => sa.accessAreaId === inselId);
      if (hasInsel) {
        console.log(`  OK   Service #${svc.id} "${svc.name}" hat Insel.`);
      } else {
        console.log(`  ADD  ServiceArea Insel an #${svc.id} "${svc.name}".`);
        if (apply) {
          await prisma.serviceArea.create({
            data: { serviceId: svc.id, accessAreaId: inselId },
          });
        }
        changed++;
      }

      const requiredMainName = REQUIRE_MAIN[svc.name];
      if (!requiredMainName) continue;
      const mainArea = await prisma.accessArea.findFirst({
        where: { accountId: account.id, name: requiredMainName },
        select: { id: true },
      });
      if (!mainArea) {
        console.warn(`  SKIP Hauptressource "${requiredMainName}" fehlt.`);
        continue;
      }
      if (svc.mainAccessAreaId === mainArea.id) {
        console.log(`  OK   "${svc.name}" mainAccessAreaId bereits ${mainArea.id}.`);
      } else {
        console.log(`  SET  "${svc.name}" mainAccessAreaId ${svc.mainAccessAreaId ?? "—"} -> ${mainArea.id}.`);
        if (apply) {
          await prisma.service.update({
            where: { id: svc.id },
            data: { mainAccessAreaId: mainArea.id },
          });
        }
        changed++;
      }
    }

    const subscriptions = await prisma.subscription.findMany({
      where: { accountId: account.id, name: { in: WAKE_AND_SUP_SUBSCRIPTIONS } },
      select: { id: true, name: true, areas: { select: { id: true } } },
    });
    for (const sub of subscriptions) {
      if (sub.areas.some((a) => a.id === inselId)) {
        console.log(`  OK   Abo #${sub.id} "${sub.name}" hat Insel.`);
      } else {
        console.log(`  ADD  Insel an Abo #${sub.id} "${sub.name}".`);
        if (apply) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { areas: { connect: { id: inselId } } },
          });
        }
        changed++;
      }
    }
  }

  console.log(
    `\n${apply ? "Geschrieben" : "Wuerde aendern"}: ${changed} Aenderung(en).` +
      (apply ? "" : "\nZum Anwenden erneut mit  APPLY=1  ausfuehren."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
