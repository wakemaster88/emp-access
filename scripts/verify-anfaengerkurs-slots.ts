/**
 * Verifiziert ueber den echten slot-overview-Endpoint, dass die Anfaengerkurse
 * getrennte Kapazitaeten melden.
 *
 * Aufruf: npx tsx --env-file=.env.local scripts/verify-anfaengerkurs-slots.ts [baseUrl] [datum]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

interface Slot {
  startTime: string;
  available: boolean;
  capacity: number | null;
  remaining: number | null;
  empBookings: number;
  unavailabilityType: string | null;
  blockId: number | null;
}

async function main() {
  const host = process.argv[2] ?? "http://localhost:3000";
  const date = process.argv[3] ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

  const monitor = await prisma.monitorConfig.findFirst({
    where: { type: "CHECKIN", isActive: true },
    select: { token: true, name: true },
  });
  if (!monitor) throw new Error("Kein aktiver CHECKIN-Monitor gefunden");

  const url = `${host}/api/checkin/public/${monitor.token}/slot-overview?date=${date}`;
  console.log(`Monitor "${monitor.name}" | ${date}\n${url}\n`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    services: Array<{ name: string; slots: Slot[]; totalEmpBookings: number }>;
  };

  console.log("--- Monitor-Auslastung (slot-overview) ---\n");
  for (const svc of json.services) {
    if (svc.slots.length === 0) continue;
    console.log(`=== ${svc.name} (EMP-Tickets heute: ${svc.totalEmpBookings}) ===`);
    for (const s of svc.slots) {
      const used = s.capacity != null && s.remaining != null ? s.capacity - s.remaining : null;
      console.log(
        `   ${s.startTime}  ${s.remaining ?? "?"} von ${s.capacity ?? "?"} frei`
        + `  (belegt=${used ?? "?"}, EMP-Tickets=${s.empBookings})`
        + `  available=${s.available}`
        + (s.unavailabilityType ? ` grund=${s.unavailabilityType}` : "")
        + (s.blockId != null ? `  GESPERRT(#${s.blockId})` : ""),
      );
    }
    console.log("");
  }

  // Verkaufs-Picker: derselbe Slot muss dort dieselbe Restkapazitaet zeigen,
  // sonst laesst sich ein freier Slot am Schalter nicht verkaufen.
  console.log("--- Verkaufs-Picker (slots) ---\n");
  const kurse = await prisma.service.findMany({
    where: { slotCapacity: { not: null } },
    select: { id: true, name: true, slotCapacity: true },
    orderBy: { name: "asc" },
  });
  for (const svc of kurse) {
    const r = await fetch(
      `${host}/api/checkin/public/${monitor.token}/slots?serviceId=${svc.id}&date=${date}`,
    );
    const j = (await r.json()) as {
      slots?: Array<{ startTime: string; available?: boolean; capacity?: number; remaining?: number; unavailabilityType?: string }>;
      note?: string;
    };
    console.log(`=== ${svc.name} (konfiguriert: ${svc.slotCapacity} Plaetze) ===`);
    if (j.note) console.log(`   Hinweis: ${j.note}`);
    for (const s of j.slots ?? []) {
      console.log(
        `   ${s.startTime}  ${s.remaining ?? "?"} von ${s.capacity ?? "?"} frei`
        + `  available=${s.available}`
        + (s.unavailabilityType ? ` grund=${s.unavailabilityType}` : ""),
      );
    }
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
