import { after, NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { RiderError } from "@/lib/customers";
import { createKonto, loadChipView, searchPersons, undoSale } from "@/lib/chips";
import { requestAppLink } from "@/lib/rider-onboarding";

/**
 * Kundenfenster der Kasse (Bändchen am Kunden, lib/chips):
 *
 * GET  ?q=…                 Kunde suchen (Name oder E-Mail)
 * GET  ?code=…&personId=…&annyTicketId=…   Kundenfenster neu laden
 * POST {action:"konto", …}  Kundenkonto anlegen, Bändchen an die Person
 * POST {action:"undo", ticketId}  gerade verkauftes Ticket zurücknehmen
 */
async function checkinMonitor(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return null;
  return monitor;
}

function fail(e: unknown): NextResponse {
  if (e instanceof RiderError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[checkin/kunde]", e);
  return NextResponse.json({ error: "Das hat nicht geklappt. Bitte noch einmal versuchen." }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "checkin-kunde-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const monitor = await checkinMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  try {
    const q = sp.get("q");
    if (q != null) return NextResponse.json({ persons: await searchPersons(monitor.accountId, q) });
    const code = sp.get("code")?.trim();
    const personId = Number(sp.get("personId")) || null;
    if (!code && personId == null) return NextResponse.json({ error: "code oder personId fehlt" }, { status: 400 });
    if (personId != null) {
      const p = await prisma.riderProfile.findFirst({ where: { id: personId, accountId: monitor.accountId }, select: { id: true } });
      if (!p) return NextResponse.json({ error: "Person nicht gefunden" }, { status: 404 });
    }
    // Ohne Code: Kundenfenster nur über die Person.
    const annyTicketId = Number(sp.get("annyTicketId")) || null;
    const view = await loadChipView(monitor.accountId, code || null, { personId, annyTicketId });
    return NextResponse.json({ customer: view });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "checkin-kunde");
  if (limited) return limited;
  const monitor = await checkinMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  try {
    if (body.action === "undo") {
      const ticketId = Number(body.ticketId);
      if (!ticketId) return NextResponse.json({ error: "ticketId fehlt" }, { status: 400 });
      await undoSale(monitor.accountId, ticketId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "konto") {
      const birth = str(body.birthDate);
      const birthDate = birth ? new Date(`${birth.slice(0, 10)}T00:00:00.000Z`) : null;
      const email = str(body.email);
      if (!email) throw new RiderError("Bitte die E-Mail-Adresse eintragen.");
      const code = str(body.code);
      const result = await createKonto(monitor.accountId, {
        code,
        firstName: str(body.firstName),
        lastName: str(body.lastName),
        email,
        birthDate,
        owner: body.owner === "BETRIEB" ? "BETRIEB" : "KUNDE",
        adopt: body.adopt !== false,
      });
      if (body.sendLink === true) {
        const origin = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
        after(() =>
          requestAppLink(email, origin).catch((err) => {
            console.error("[checkin/kunde] App-Link", err);
          }),
        );
      }
      const customer = await loadChipView(monitor.accountId, code, { personId: result.personId });
      return NextResponse.json({ ...result, customer });
    }
    return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
