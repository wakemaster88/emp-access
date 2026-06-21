/**
 * Fix: Anfaengerkurse gehen am Strandbad-Drehkreuz nicht.
 *
 * Ursache (Konfiguration): Die beiden Anfaengerkurs-Services sind NICHT wie
 * ihre "Exklusiv"-Gegenstuecke konfiguriert (vgl. "Exklusive Bahnmiete B" =
 * areas[Seilbahn B, Strandbad] + main=Seilbahn B):
 *
 *   - "Anfängerkurs - Übungslift": serviceAreas=[Übungslift] -> der Strandbad-
 *     Bereich fehlt komplett -> Eintritt am Strandbad-Drehkreuz = `wrong_resource`.
 *     Ausserdem keine Hauptressource gesetzt.
 *   - "Anfängerkurs - Seilbahn B": serviceAreas korrekt, aber KEINE
 *     Hauptressource -> der Kurs-Slot (z.B. 13:00-14:00) wird faelschlich schon
 *     am Strandbad-Eingang als `slot_window` durchgesetzt.
 *
 * Dieses Skript stellt die korrekte Konfiguration her (idempotent):
 *   1. Strandbad als ServiceArea ergaenzen (falls fehlt).
 *   2. Aktivitaets-Area als Hauptressource (mainAccessAreaId) setzen.
 *   3. Validitaet auf DURATION 60 min setzen - exakt wie "Öffentlicher Betrieb
 *      - 1 Stunde" (#1). Die ANNY-Namen der Kurse lauten "Anfängerkurs - 1
 *      Stunde ..." -> 1-Stunden-Kurse. Dadurch werden kuenftige Buchungen
 *      (ANNY-Sync) als DURATION angelegt statt TIME_SLOT, und das Strandbad-
 *      Drehkreuz behandelt sie als Transit (kein Slot-Fenster, kein Redeem,
 *      Reentry frei) - genau wie die Wasserski-Tickets.
 *
 * Die Hauptressource-Logik (zusammen mit dem Code-Fix in der Scan-Route)
 * behandelt das Strandbad-Drehkreuz dann als Transit: Zutritt wird gewaehrt,
 * Slot/Timer gelten erst an der Aktivitaet.
 *
 * Sicherheit:
 *   - Match per Service-NAME (kein hartkodiertes ID-Raten).
 *   - Areas werden per NAME im selben Account aufgeloest.
 *   - Idempotent: bereits korrekte Werte bleiben unangetastet.
 *
 * Aufruf:
 *   npx tsx scripts/fix-anfaengerkurs-strandbad.ts            # Vorschau (dry-run)
 *   APPLY=1 npx tsx scripts/fix-anfaengerkurs-strandbad.ts    # tatsaechlich schreiben
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

/** Validitaet wie "Öffentlicher Betrieb - 1 Stunde" (#1): DURATION, 60 min. */
const DURATION_MINUTES = 60;

/** Service-Name -> { mainArea: Name der Hauptressource, requireAreas: Areas, die ServiceArea sein muessen } */
const PLAN: Record<string, { mainArea: string; requireAreas: string[] }> = {
  "Anfängerkurs - Übungslift": { mainArea: "Übungslift", requireAreas: ["Übungslift", "Strandbad"] },
  "Anfängerkurs - Seilbahn B": { mainArea: "Seilbahn B", requireAreas: ["Seilbahn B", "Strandbad"] },
};

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(apply ? "MODUS: APPLY (schreibt)\n" : "MODUS: DRY-RUN (zeigt nur, schreibt nichts)\n");

  const services = await prisma.service.findMany({
    where: { name: { in: Object.keys(PLAN) } },
    select: {
      id: true, name: true, accountId: true, mainAccessAreaId: true,
      defaultValidityType: true, defaultValidityDurationMinutes: true,
      defaultSlotStart: true, defaultSlotEnd: true,
      serviceAreas: { select: { accessAreaId: true, area: { select: { name: true } } } },
    },
  });

  if (services.length === 0) {
    console.error("Keine passenden Services gefunden – Namen pruefen.");
    process.exitCode = 1;
    return;
  }

  let changed = 0;
  for (const svc of services) {
    const plan = PLAN[svc.name];
    console.log(`\n#${svc.id} "${svc.name}" (account=${svc.accountId})`);

    // Alle benoetigten Areas im selben Account per Name aufloesen.
    const areas = await prisma.accessArea.findMany({
      where: { accountId: svc.accountId, name: { in: plan.requireAreas } },
      select: { id: true, name: true },
    });
    const areaByName = new Map(areas.map((a) => [a.name, a.id]));

    const missingArea = plan.requireAreas.find((n) => !areaByName.has(n));
    if (missingArea) {
      console.warn(`  SKIP: Area "${missingArea}" existiert nicht im Account ${svc.accountId}.`);
      continue;
    }

    // 1) Fehlende ServiceAreas ergaenzen.
    const existingAreaIds = new Set(svc.serviceAreas.map((sa) => sa.accessAreaId));
    for (const areaName of plan.requireAreas) {
      const areaId = areaByName.get(areaName)!;
      if (existingAreaIds.has(areaId)) {
        console.log(`  OK   ServiceArea "${areaName}" (${areaId}) vorhanden.`);
        continue;
      }
      console.log(`  ADD  ServiceArea "${areaName}" (${areaId}).`);
      if (apply) {
        await prisma.serviceArea.create({
          data: { serviceId: svc.id, accessAreaId: areaId },
        });
      }
      changed++;
    }

    // 2) Hauptressource setzen.
    const mainAreaId = areaByName.get(plan.mainArea)!;
    if (svc.mainAccessAreaId === mainAreaId) {
      console.log(`  OK   mainAccessAreaId bereits "${plan.mainArea}" (${mainAreaId}).`);
    } else {
      console.log(`  SET  mainAccessAreaId ${svc.mainAccessAreaId ?? "—"} -> ${mainAreaId} (${plan.mainArea}).`);
      if (apply) {
        await prisma.service.update({
          where: { id: svc.id },
          data: { mainAccessAreaId: mainAreaId },
        });
      }
      changed++;
    }

    // 3) Validitaet auf DURATION 60 min (wie "Öffentlicher Betrieb - 1 Stunde").
    const durationOk =
      svc.defaultValidityType === "DURATION" &&
      svc.defaultValidityDurationMinutes === DURATION_MINUTES &&
      svc.defaultSlotStart == null &&
      svc.defaultSlotEnd == null;
    if (durationOk) {
      console.log(`  OK   Validitaet bereits DURATION ${DURATION_MINUTES}min (ohne Slot).`);
    } else {
      console.log(
        `  SET  Validitaet ${svc.defaultValidityType ?? "—"}/${svc.defaultValidityDurationMinutes ?? "—"}min ` +
          `slot=${svc.defaultSlotStart ?? "—"}-${svc.defaultSlotEnd ?? "—"} -> DURATION ${DURATION_MINUTES}min (ohne Slot).`,
      );
      if (apply) {
        await prisma.service.update({
          where: { id: svc.id },
          data: {
            defaultValidityType: "DURATION",
            defaultValidityDurationMinutes: DURATION_MINUTES,
            defaultSlotStart: null,
            defaultSlotEnd: null,
          },
        });
      }
      changed++;
    }
  }

  console.log(
    `\n${apply ? "Geschrieben" : "Wuerde aendern"}: ${changed} Aenderung(en).` +
      (apply ? "" : "\nZum Anwenden erneut mit  APPLY=1  ausfuehren."),
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
