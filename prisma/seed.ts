import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Superadmin (no account)
  const superAdminPassword = await hash(
    process.env.SUPERADMIN_PASSWORD || "admin123",
    12
  );

  const superAdmin = await prisma.admin.upsert({
    where: { email: process.env.SUPERADMIN_EMAIL || "admin@emp-access.de" },
    update: {},
    create: {
      email: process.env.SUPERADMIN_EMAIL || "admin@emp-access.de",
      password: superAdminPassword,
      name: "Super Admin",
      role: "SUPER_ADMIN",
      accountId: null,
    },
  });
  console.log(`  Superadmin: ${superAdmin.email}`);

  // Demo Account
  const account = await prisma.account.upsert({
    where: { subdomain: "demo" },
    update: {},
    create: {
      subdomain: "demo",
      name: "Demo Freizeitpark",
      isActive: true,
    },
  });
  console.log(`  Account: ${account.name} (token: ${account.apiToken})`);

  // Tenant Admin
  const adminPassword = await hash("demo123", 12);
  const admin = await prisma.admin.upsert({
    where: { email: "demo@emp-access.de" },
    update: {},
    create: {
      email: "demo@emp-access.de",
      password: adminPassword,
      name: "Demo Admin",
      role: "ADMIN",
      accountId: account.id,
    },
  });
  console.log(`  Tenant Admin: ${admin.email}`);

  // Access Areas
  const mainArea = await prisma.accessArea.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: "Haupteingang",
      personLimit: 500,
      allowReentry: true,
      accountId: account.id,
    },
  });

  const poolArea = await prisma.accessArea.upsert({
    where: { id: 2 },
    update: {},
    create: {
      name: "Aquapark",
      personLimit: 200,
      parentId: mainArea.id,
      allowReentry: false,
      accountId: account.id,
    },
  });

  const vipArea = await prisma.accessArea.upsert({
    where: { id: 3 },
    update: {},
    create: {
      name: "VIP Bereich",
      personLimit: 50,
      parentId: mainArea.id,
      allowReentry: true,
      accountId: account.id,
    },
  });
  console.log(`  Areas: ${mainArea.name}, ${poolArea.name}, ${vipArea.name}`);

  // Devices - Raspberry Pi
  const pi1 = await prisma.device.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: "Drehkreuz Eingang",
      type: "RASPBERRY_PI",
      isActive: true,
      accessIn: mainArea.id,
      firmware: "v2.1.0",
      lastUpdate: new Date(),
      accountId: account.id,
    },
  });

  const pi2 = await prisma.device.upsert({
    where: { id: 2 },
    update: {},
    create: {
      name: "Drehkreuz Ausgang",
      type: "RASPBERRY_PI",
      isActive: true,
      accessOut: mainArea.id,
      firmware: "v2.1.0",
      lastUpdate: new Date(),
      accountId: account.id,
    },
  });

  // Devices - Shelly
  const shelly1 = await prisma.device.upsert({
    where: { id: 3 },
    update: {},
    create: {
      name: "Tür VIP Lounge",
      type: "SHELLY",
      ipAddress: "192.168.1.100",
      isActive: true,
      accessIn: vipArea.id,
      lastUpdate: new Date(),
      accountId: account.id,
    },
  });

  const shelly2 = await prisma.device.upsert({
    where: { id: 4 },
    update: {},
    create: {
      name: "Tor Aquapark",
      type: "SHELLY",
      ipAddress: "192.168.1.101",
      isActive: true,
      accessIn: poolArea.id,
      lastUpdate: new Date(),
      accountId: account.id,
    },
  });
  console.log(`  Devices: ${pi1.name}, ${pi2.name}, ${shelly1.name}, ${shelly2.name}`);

  // Test Tickets
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const tickets = await Promise.all([
    prisma.ticket.upsert({
      where: { barcode: "DEMO-001" },
      update: {},
      create: {
        name: "Max Mustermann",
        barcode: "DEMO-001",
        qrCode: "DEMO-001",
        firstName: "Max",
        lastName: "Mustermann",
        status: "VALID",
        startDate: now,
        endDate: tomorrow,
        accessAreaId: mainArea.id,
        ticketTypeName: "Tageskarte",
        accountId: account.id,
      },
    }),
    prisma.ticket.upsert({
      where: { barcode: "DEMO-002" },
      update: {},
      create: {
        name: "Anna Schmidt",
        barcode: "DEMO-002",
        qrCode: "DEMO-002",
        rfidCode: "1002193100",
        firstName: "Anna",
        lastName: "Schmidt",
        status: "VALID",
        startDate: now,
        endDate: nextWeek,
        accessAreaId: poolArea.id,
        ticketTypeName: "Wochenkarte Aquapark",
        accountId: account.id,
      },
    }),
    prisma.ticket.upsert({
      where: { barcode: "DEMO-VIP-001" },
      update: {},
      create: {
        name: "Thomas VIP",
        barcode: "DEMO-VIP-001",
        rfidCode: "9999888777",
        firstName: "Thomas",
        lastName: "VIP",
        status: "PROTECTED",
        accessAreaId: vipArea.id,
        ticketTypeName: "VIP Dauerkarte",
        accountId: account.id,
      },
    }),
    prisma.ticket.upsert({
      where: { uuid: "emp-42" },
      update: {},
      create: {
        name: "Lisa Mitarbeiter",
        uuid: "emp-42",
        rfidCode: "5551234567",
        firstName: "Lisa",
        lastName: "Mitarbeiter",
        status: "VALID",
        accessAreaId: mainArea.id,
        ticketTypeName: "Mitarbeiter",
        source: "EMP_CONTROL",
        accountId: account.id,
      },
    }),
  ]);
  console.log(`  Tickets: ${tickets.length} created`);

  // Sample Scans
  const scanTimes = Array.from({ length: 10 }, (_, i) => new Date(now.getTime() - i * 15 * 60 * 1000));

  for (const [i, time] of scanTimes.entries()) {
    await prisma.scan.create({
      data: {
        code: tickets[i % tickets.length].barcode || tickets[i % tickets.length].rfidCode || "UNKNOWN",
        deviceId: [pi1.id, pi2.id, shelly1.id, shelly2.id][i % 4],
        scanTime: time,
        result: i % 5 === 0 ? "DENIED" : "GRANTED",
        ticketId: tickets[i % tickets.length].id,
        accountId: account.id,
      },
    });
  }
  console.log(`  Scans: ${scanTimes.length} created`);

  console.log("\nSeed complete!");
  console.log(`\nLogin credentials:`);
  console.log(`  Superadmin: ${superAdmin.email} / ${process.env.SUPERADMIN_PASSWORD || "admin123"}`);
  console.log(`  Demo Admin: demo@emp-access.de / demo123`);
  console.log(`  API Token:  ${account.apiToken}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
