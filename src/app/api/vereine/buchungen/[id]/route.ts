import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";
import { approveVereinRequest, cancelVereinBooking, rejectVereinRequest } from "@/lib/verein-portal";
import { loadRequestSummary, sendDecisionToTelegram } from "@/lib/verein-request-telegram";

export const maxDuration = 30;

async function session() {
  const s = await getSessionWithDb();
  if ("error" in s) return { error: s.error };
  if (s.accountId == null) return { error: NextResponse.json({ error: "Kein Mandant" }, { status: 403 }) };
  return { accountId: s.accountId };
}

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

/** Backoffice-Storno einer Vereinsbuchung (ohne Frist, wird nicht abgerechnet). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await session();
  if ("error" in s) return s.error;
  const bookingId = parseId((await params).id);
  if (bookingId == null) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const result = await cancelVereinBooking(s.accountId, bookingId, "ADMIN");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

const decideSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), priceCents: z.coerce.number().int().min(0).max(10_000_000).optional() }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().max(500).optional().nullable() }),
]);

/** Wunschzeit-Anfrage freigeben oder ablehnen. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await session();
  if ("error" in s) return s.error;
  const requestId = parseId((await params).id);
  if (requestId == null) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const parsed = decideSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Angaben" }, { status: 400 });

  const result = parsed.data.action === "approve"
    ? await approveVereinRequest(s.accountId, requestId, { priceCents: parsed.data.priceCents })
    : await rejectVereinRequest(s.accountId, requestId, parsed.data.reason || null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Telegram-Chat auf dem Laufenden halten (dort kam die Anfrage mit Tasten an).
  const summary = await loadRequestSummary(s.accountId, requestId).catch(() => null);
  if (summary) {
    await sendDecisionToTelegram(s.accountId, summary, {
      approved: parsed.data.action === "approve",
      reason: parsed.data.action === "reject" ? parsed.data.reason : null,
    }).catch((e) => console.error("[vereine/buchungen] telegram failed:", e));
  }
  return NextResponse.json({ ok: true });
}
