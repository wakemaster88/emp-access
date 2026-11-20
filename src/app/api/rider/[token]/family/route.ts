import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { buildScanCodeVariants } from "@/lib/scan-code-variants";
import { normalizeEmail } from "@/lib/day-guest";
import { sameBirthDate } from "@/lib/gamification";
import { ensureRiderProfile } from "@/lib/rider-app";
import { riderApiSession } from "@/lib/rider-auth";
import {
  addFamilyChild, createFamilyInvite, FamilyError, leaveFamily, removeFamilyChild,
} from "@/lib/rider-family";
import { requestFamilyChildLink } from "@/lib/rider-family-link";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    code: z.string().trim().min(3).max(100),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({ action: z.literal("link"), email: z.string().trim().max(200) }),
  z.object({ action: z.literal("invite") }),
  z.object({ action: z.literal("remove"), memberId: z.number().int().positive() }),
  z.object({ action: z.literal("leave") }),
]);

const NO_MATCH = "Karte und Geburtsdatum passen nicht zusammen. Ohne Geburtsdatum am Abo hilft der persönliche Link von der Kasse.";

/**
 * POST: Familie der angemeldeten Person verwalten. `add` holt ein Abo per
 * Kartennummer und Geburtsdatum als Kind dazu, `link` schickt einem Kind mit
 * eigener Adresse einen Link zum Bestätigen (Antwort immer gleich),
 * `invite` liefert den Einladungslink für den Partner, `remove` nimmt ein
 * Kind heraus, `leave` verlässt die Familie.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited =
    publicRateLimit(ip, "rider-family-ip", { limit: 30, windowMs: 10 * 60_000 }) ??
    publicRateLimit(token, "rider-family", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const ctx = await riderApiSession(token);
  if ("error" in ctx) return ctx.error;
  const viewer = ctx.profile;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const input = parsed.data;

  try {
    if (input.action === "invite") {
      return NextResponse.json({ path: await createFamilyInvite(viewer) });
    }
    if (input.action === "link") {
      if (viewer.familyId != null && !viewer.familyAdult) {
        return NextResponse.json({ error: "Nur Erwachsene der Familie können Mitglieder hinzufügen." }, { status: 409 });
      }
      const email = normalizeEmail(input.email);
      if (!email) return NextResponse.json({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }, { status: 400 });
      const mails = publicRateLimit(token, "rider-family-link", { limit: 5, windowMs: 10 * 60_000 });
      if (mails) return mails;
      const origin = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
      // Erst nach der Antwort suchen und senden: so verrät auch die Dauer nichts.
      after(() =>
        requestFamilyChildLink(viewer, email, origin).catch((err) => {
          if (!(err instanceof FamilyError)) console.error("[rider] family link failed:", err);
        }),
      );
      return NextResponse.json({ ok: true });
    }
    if (input.action === "leave") {
      await leaveFamily(viewer);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "remove") {
      await removeFamilyChild(viewer, input.memberId);
      return NextResponse.json({ ok: true });
    }

    // Geburtsdaten nicht durchprobieren lassen.
    const guess = publicRateLimit(token, "rider-family-add", { limit: 8, windowMs: 10 * 60_000 });
    if (guess) return guess;
    const variants = buildScanCodeVariants(input.code);
    const tickets = await prisma.ticket.findMany({
      where: {
        accountId: viewer.accountId,
        subscriptionId: { not: null },
        birthDate: { not: null },
        status: { in: ["VALID", "REDEEMED", "PAUSED"] },
        OR: variants.flatMap((c) => [{ rfidCode: c }, { barcode: c }, { qrCode: c }]),
      },
      select: { id: true, birthDate: true },
      take: 20,
    });
    const match = tickets.find((t) => sameBirthDate(t.birthDate, input.birthDate));
    if (!match) return NextResponse.json({ error: NO_MATCH }, { status: 404 });
    const profile = await ensureRiderProfile(viewer.accountId, match.id);
    const target = profile ? await prisma.riderProfile.findUnique({ where: { token: profile.token }, select: { id: true } }) : null;
    if (!target) return NextResponse.json({ error: NO_MATCH }, { status: 404 });
    await addFamilyChild(viewer, target.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof FamilyError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
