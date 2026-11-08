import { prisma } from "@/lib/prisma";
import { escapeHtml } from "@/lib/email-templates";
import { formatCents } from "@/lib/verein-portal-rules";
import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Wunschzeit-Anfragen der Vereine im Telegram-Chat des Mandanten:
 * neue Anfrage mit „Freigeben“/„Ablehnen“-Tasten (Callback `vreq:ok:<id>`
 * bzw. `vreq:no:<id>`, verarbeitet im Telegram-Webhook), Entscheidungen
 * aus dem Backoffice als kurze Info.
 */

export const VEREIN_REQUEST_CALLBACK_RE = /^vreq:(ok|no):(\d+)$/;

export interface RequestSummary {
  vereinName: string;
  serviceName: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  priceCents: number;
  bookedBy: string | null;
  note: string | null;
}

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

/** Text der Anfrage-Nachricht (HTML), auch Basis für die bearbeitete Fassung nach der Entscheidung. */
export function requestTelegramText(r: RequestSummary): string {
  const lines = [
    `<b>📝 Anfrage von ${escapeHtml(r.vereinName)}</b>`,
    `${escapeHtml(r.serviceName)} · ${fmtDate(r.date)}, ${r.slotStart}–${r.slotEnd} Uhr`,
    `Preis ${escapeHtml(formatCents(r.priceCents))}${r.bookedBy ? ` · ${escapeHtml(r.bookedBy)}` : ""}`,
  ];
  if (r.note) lines.push(`„${escapeHtml(r.note)}“`);
  return lines.join("\n");
}

async function activeConfigs(accountId: number) {
  return prisma.telegramConfig.findMany({
    where: { accountId, isActive: true },
    select: { botToken: true, chatId: true },
  });
}

/** Neue Anfrage mit Entscheidungs-Tasten an alle aktiven Telegram-Chats. */
export async function sendRequestToTelegram(accountId: number, requestId: number, r: RequestSummary): Promise<number> {
  let sent = 0;
  for (const tg of await activeConfigs(accountId)) {
    try {
      const res = await sendTelegramMessage(tg.botToken, tg.chatId, requestTelegramText(r), "HTML", {
        inline_keyboard: [[
          { text: "✅ Freigeben", callback_data: `vreq:ok:${requestId}` },
          { text: "❌ Ablehnen", callback_data: `vreq:no:${requestId}` },
        ]],
      });
      if (res.ok) sent++;
      else console.error("[verein-request] telegram failed:", res.description);
    } catch (err) {
      console.error("[verein-request] telegram error:", err);
    }
  }
  return sent;
}

/** Kurze Info, wenn eine Anfrage im Backoffice entschieden wurde. */
export async function sendDecisionToTelegram(
  accountId: number,
  r: RequestSummary,
  decision: { approved: boolean; reason?: string | null },
): Promise<void> {
  const head = decision.approved ? "✅ Anfrage freigegeben" : "❌ Anfrage abgelehnt";
  const text = [
    `<b>${head}</b> (Backoffice)`,
    `${escapeHtml(r.vereinName)}: ${escapeHtml(r.serviceName)} · ${fmtDate(r.date)}, ${r.slotStart}–${r.slotEnd} Uhr`,
    ...(decision.reason ? [`Grund: ${escapeHtml(decision.reason)}`] : []),
  ].join("\n");
  for (const tg of await activeConfigs(accountId)) {
    await sendTelegramMessage(tg.botToken, tg.chatId, text).catch((err) => {
      console.error("[verein-request] telegram error:", err);
    });
  }
}

/** Lädt die Anfrage für Telegram-Texte. */
export async function loadRequestSummary(accountId: number, requestId: number): Promise<RequestSummary | null> {
  const b = await prisma.vereinSlotBooking.findFirst({
    where: { id: requestId, accountId },
    include: { verein: { select: { name: true } } },
  });
  if (!b) return null;
  return {
    vereinName: b.verein.name,
    serviceName: b.serviceName,
    date: b.date,
    slotStart: b.slotStart,
    slotEnd: b.slotEnd,
    priceCents: b.priceCents,
    bookedBy: b.bookedBy,
    note: b.note,
  };
}
