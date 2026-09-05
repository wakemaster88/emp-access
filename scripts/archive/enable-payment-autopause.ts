/**
 * Schaltet paymentAutoPause in der ANNY-ApiConfig scharf (Merge, erhaelt alle
 * bestehenden Werte). Aufruf: npx tsx scripts/enable-payment-autopause.ts [graceDays] [on|off]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

const graceDays = Number(process.argv[2] ?? "0");
const enabled = (process.argv[3] ?? "on").toLowerCase() !== "off";

async function main() {
  const cfgs = await prisma.apiConfig.findMany({ where: { provider: "ANNY" } });
  for (const cfg of cfgs) {
    let parsed: Record<string, unknown> = {};
    try { parsed = cfg.extraConfig ? JSON.parse(cfg.extraConfig) : {}; } catch { parsed = {}; }
    parsed.paymentAutoPause = { enabled, graceDays: Math.max(0, graceDays) };
    await prisma.apiConfig.update({ where: { id: cfg.id }, data: { extraConfig: JSON.stringify(parsed) } });
    console.log(`Account ${cfg.accountId}: paymentAutoPause = { enabled: ${enabled}, graceDays: ${Math.max(0, graceDays)} }`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
