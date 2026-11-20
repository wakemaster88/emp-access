import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { markAwardsSeen } from "@/lib/rider-app";
import { riderApiManage } from "@/lib/rider-auth";

/**
 * POST: Die Freischalt-Momente der Person sind gezeigt. Danach erscheinen sie
 * nicht noch einmal, auch nicht auf einem anderen Gerät. Eltern dürfen das
 * für ihr Kind aufrufen (sie sehen dessen Awards in der Familienansicht).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "rider-awards-seen", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiManage(token);
  if ("error" in ctx) return ctx.error;

  const { id, accountId } = ctx.profile;
  const tickets = await prisma.ticket.findMany({ where: { accountId, riderProfileId: id }, select: { id: true } });
  const seen = await markAwardsSeen({ accountId, ticketIds: tickets.map((t) => t.id) });
  return NextResponse.json({ ok: true, seen });
}
