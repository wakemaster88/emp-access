import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { parsePersonInput } from "@/lib/rider-person";

/**
 * Profilbild eines Tickets fuer den Scan-Monitor (nur Link-Typ MONITOR).
 * Die Liste laedt die Bilder einzeln beim Scrollen; die Lese-Grenze reicht
 * fuer mehrere Monitore mit voller Ticketliste hinter einer IP.
 */
const PHOTO_READ_LIMIT = { limit: 1500, windowMs: 60_000 } as const;
const PHOTO_WRITE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-photo-read", PHOTO_READ_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "MONITOR") {
    return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
  }

  const ticketId = Number(request.nextUrl.searchParams.get("ticketId"));
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId: monitor.accountId },
    select: { profileImage: true },
  });

  return NextResponse.json(
    { profileImage: ticket?.profileImage ?? null },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-photo-write", PHOTO_WRITE_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "MONITOR") {
    return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { ticketId?: unknown; profileImage?: unknown } | null;
  const ticketId = Number(body?.ticketId);
  const rawImage = body?.profileImage;

  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
  }
  if (!rawImage || typeof rawImage !== "string") {
    return NextResponse.json({ error: "profileImage erforderlich" }, { status: 400 });
  }
  // Gleiche Regel wie in der Kunden-App: nur JPG, PNG oder WebP als
  // Base64-Data-URL und hoechstens PHOTO_MAX_CHARS Zeichen.
  const parsed = parsePersonInput({ photo: rawImage });
  if ("error" in parsed || !parsed.data.photo) {
    return NextResponse.json(
      { error: "error" in parsed ? parsed.error : "profileImage erforderlich" },
      { status: 400 },
    );
  }
  const profileImage = parsed.data.photo;

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId: monitor.accountId },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 404 });
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { profileImage },
  });

  return NextResponse.json({ success: true });
}
