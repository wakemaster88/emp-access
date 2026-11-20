import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/day-guest";
import { riderApiSession } from "@/lib/rider-auth";
import { createFamilyInvite, FamilyError, leaveFamily, removeFamilyChild } from "@/lib/rider-family";
import { requestFamilyChildLink } from "@/lib/rider-family-link";
import { inviteFamilyByMail } from "@/lib/rider-family-invite";
import { appOrigin } from "@/lib/rider-invite";
import { prisma } from "@/lib/prisma";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), email: z.string().trim().max(200) }),
  z.object({ action: z.literal("mail"), email: z.string().trim().max(200) }),
  z.object({ action: z.literal("invite") }),
  z.object({ action: z.literal("remove"), memberId: z.number().int().positive() }),
  z.object({ action: z.literal("leave") }),
]);

/**
 * POST: Familie der angemeldeten Person verwalten. `mail` lädt eine
 * erwachsene Person per Mail in App und Familie ein (lib/rider-family-invite),
 * `link` schickt einem Kind mit eigener Adresse einen Link zum Bestätigen
 * (Antwort immer gleich), `invite` liefert den Einladungslink zum Teilen, `remove` nimmt ein
 * Kind heraus, `leave` verlässt die Familie. Kinder ohne eigene Adresse
 * verknüpft die Kasse per App-Code (lib/rider-kasse-link) oder die
 * Verwaltung; per Kartennummer geht es nicht mehr (Aaron, 20.11.2026).
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
    if (input.action === "mail") {
      const mails = publicRateLimit(token, "rider-family-mail", { limit: 10, windowMs: 60 * 60_000 });
      if (mails) return mails;
      const me = await prisma.riderProfile.findUnique({ where: { id: viewer.id }, select: { email: true } });
      const origin = appOrigin() ?? new URL(request.url).origin;
      const result = await inviteFamilyByMail({ ...viewer, email: me?.email ?? null }, input.email, origin);
      return NextResponse.json({ ok: true, result });
    }
    if (input.action === "link") {
      if (viewer.familyId != null && !viewer.familyAdult) {
        return NextResponse.json({ error: "Nur Erwachsene der Familie können Mitglieder hinzufügen." }, { status: 409 });
      }
      const email = normalizeEmail(input.email);
      if (!email) return NextResponse.json({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }, { status: 400 });
      const mails = publicRateLimit(token, "rider-family-link", { limit: 5, windowMs: 10 * 60_000 });
      if (mails) return mails;
      const origin = appOrigin() ?? new URL(request.url).origin;
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
    await removeFamilyChild(viewer, input.memberId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof FamilyError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
