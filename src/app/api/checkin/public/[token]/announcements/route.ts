import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 10;

const MAX_MESSAGE_LENGTH = 500;

/**
 * Schickt einen Hinweis vom Shop-/Check-in-Monitor an ALLE Public-Monitore
 * desselben Accounts. Wird dort als Banner oben angezeigt, bis manuell per X
 * geschlossen.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungueltige JSON-Daten" }, { status: 400 });
  }

  const raw =
    body && typeof body === "object" && "message" in body
      ? (body as { message: unknown }).message
      : null;
  const message = typeof raw === "string" ? raw.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Nachricht fehlt" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Nachricht zu lang (max. ${MAX_MESSAGE_LENGTH} Zeichen)` },
      { status: 400 },
    );
  }

  const announcement = await prisma.monitorAnnouncement.create({
    data: {
      accountId: monitor.accountId,
      message,
      sourceLabel: monitor.name,
    },
    select: { id: true, message: true, sourceLabel: true, createdAt: true },
  });

  return NextResponse.json({ ok: true, announcement });
}
