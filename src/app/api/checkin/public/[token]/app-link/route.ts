import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { RiderError } from "@/lib/customers";
import { aboAppOwner, AboLinkedError, linkAboToApp, ownerText, readAppCode } from "@/lib/rider-kasse-link";

const schema = z.object({
  code: z.string().trim().min(10).max(80),
  ticketId: z.number().int().positive(),
  role: z.enum(["self", "child"]),
  /** Bisherige Verknüpfung lösen (nach Rückfrage an der Kasse). */
  replace: z.boolean().optional(),
});

async function checkinMonitor(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  return monitor && monitor.isActive && monitor.type === "CHECKIN" ? monitor : null;
}

/** GET `?ticketId=`: wo das Abo in der App steht (für den Dialog an der Kasse). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "checkin-app-owner", { limit: 120, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const monitor = await checkinMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const ticketId = Number(request.nextUrl.searchParams.get("ticketId"));
  if (!Number.isInteger(ticketId) || ticketId <= 0) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const owner = await aboAppOwner(monitor.accountId, ticketId);
  return NextResponse.json({ owner: owner ? { ...owner, text: ownerText(owner) } : null });
}

/**
 * POST: Abo mit der Kunden-App verknüpfen (Shop-Monitor). Das Personal hat
 * die Abo-Karte und den App-Code gescannt und gewählt, ob die Person der App
 * selbst fährt oder ein Kind. Body: `{ code, ticketId, role, replace? }`.
 * Hängt das Abo schon an einer anderen Person, kommt 409 mit
 * `replaceable: true`; nach Rückfrage löst `replace: true` die bisherige
 * Verknüpfung.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "checkin-app-link", { limit: 30, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const monitor = await checkinMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const { code, ticketId, role, replace = false } = parsed.data;

  const app = readAppCode(code);
  if (!app || "invalid" in app) {
    return NextResponse.json({ error: "App-Code abgelaufen oder ungültig. Bitte in der App neu anzeigen lassen." }, { status: 400 });
  }

  try {
    const message = await linkAboToApp(monitor.accountId, ticketId, app.profileId, role, new Date(), replace);
    console.log(`[checkin] monitor=${monitor.id} Abo ${ticketId} mit App ${app.profileId} verknüpft (${role}${replace ? ", bisherige gelöst" : ""})`);
    return NextResponse.json({ ok: true, message });
  } catch (err) {
    if (err instanceof AboLinkedError) return NextResponse.json({ error: err.message, replaceable: true }, { status: err.status });
    if (err instanceof RiderError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
