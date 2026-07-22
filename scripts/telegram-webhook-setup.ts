import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const BASE_URL = "https://emp-access.vercel.app";

async function main() {
  const configs = await prisma.telegramConfig.findMany({
    where: { isActive: true },
    select: { id: true, accountId: true, chatId: true, botToken: true },
  });
  for (const c of configs) {
    const url = `${BASE_URL}/api/telegram/webhook?token=${encodeURIComponent(c.botToken)}`;
    const res = await fetch(`https://api.telegram.org/bot${c.botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, allowed_updates: ["callback_query", "message"] }),
    });
    const data = await res.json();
    console.log(`Config #${c.id} (Account ${c.accountId}, Chat ${c.chatId}): setWebhook →`, JSON.stringify(data));
    const info = await (await fetch(`https://api.telegram.org/bot${c.botToken}/getWebhookInfo`)).json();
    console.log("  Webhook-Info:", info.result?.url, "| pending:", info.result?.pending_update_count);
  }
  await prisma.$disconnect();
}
main();
