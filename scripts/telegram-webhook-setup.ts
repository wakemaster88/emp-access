/**
 * Registriert (oder erneuert) den Telegram-Webhook fuer alle aktiven Bots.
 *
 * Die URL traegt nur die Config-ID; das Geheimnis geht als `secret_token`
 * an Telegram und kommt bei jedem Update im Header zurueck. Nach dem Lauf
 * steht das Bot-Token nicht mehr in URL oder Request-Logs.
 *
 * Aufruf: DATABASE_URL=... AUTH_SECRET=... npx tsx scripts/telegram-webhook-setup.ts [https://deine-domain]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import "dotenv/config";
import { setTelegramWebhook, telegramWebhookSecret } from "../src/lib/telegram";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const BASE_URL = (process.argv[2] || process.env.PUBLIC_BASE_URL || "https://emp-access.vercel.app").replace(/\/$/, "");

async function main() {
  if (!process.env.AUTH_SECRET && !process.env.TWO_FACTOR_KEY) {
    throw new Error("AUTH_SECRET fehlt – das Webhook-Geheimnis wird daraus abgeleitet und muss dem Wert auf Vercel entsprechen.");
  }
  const configs = await prisma.telegramConfig.findMany({
    where: { isActive: true },
    select: { id: true, accountId: true, chatId: true, botToken: true },
  });
  for (const c of configs) {
    const url = `${BASE_URL}/api/telegram/webhook?id=${c.id}`;
    const data = await setTelegramWebhook(c.botToken, url, telegramWebhookSecret(c.botToken));
    console.log(`Config #${c.id} (Account ${c.accountId}, Chat ${c.chatId}): setWebhook →`, JSON.stringify(data));
    const info = await (await fetch(`https://api.telegram.org/bot${c.botToken}/getWebhookInfo`)).json();
    console.log("  Webhook-Info:", info.result?.url, "| pending:", info.result?.pending_update_count);
  }
  await prisma.$disconnect();
}
main();
