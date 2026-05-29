import "dotenv/config";
import { syncAnnyForAccount } from "../src/lib/anny-sync";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const accountId = Number(process.argv[2] ?? "1");
  const res = await syncAnnyForAccount(accountId);
  console.log("Sync:", JSON.stringify({ created: res.created, updated: res.updated, skipped: res.skipped, errors: res.errors, planSubscriptions: res.planSubscriptions }, null, 2));

  const paused = await prisma.ticket.findMany({
    where: { accountId, status: "PAUSED", uuid: { startsWith: "anny-sub:" } },
    select: { name: true, status: true, extras: true, endDate: true },
  });
  const payPaused = paused.filter((t) => (t.extras as Record<string, unknown> | null)?.paymentPause);
  console.log(`\nZahlungs-pausierte Abos: ${payPaused.length}`);
  for (const t of payPaused) {
    const pp = (t.extras as Record<string, unknown>).paymentPause as Record<string, unknown>;
    console.log(`  ${t.name}: ${pp.note} | Rechnung ${pp.invoiceNumber} | ${pp.amount}€ | faellig ${pp.dueDate} | endDate ${t.endDate?.toISOString?.() ?? t.endDate}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
