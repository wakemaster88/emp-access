import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
    if (!monitor || !monitor.isActive) {
      return NextResponse.json({ error: "Monitor nicht gefunden" }, { status: 404 });
    }

    const body = await request.json();
    const action = body.action as string;

    if (action === "pause") {
      const result = await prisma.ticket.updateMany({
        where: {
          accountId: monitor.accountId,
          status: { in: ["VALID", "REDEEMED"] },
        },
        data: { status: "PAUSED" },
      });
      return NextResponse.json({ success: true, action: "paused", count: result.count });
    }

    if (action === "resume") {
      const result = await prisma.ticket.updateMany({
        where: {
          accountId: monitor.accountId,
          status: "PAUSED",
        },
        data: { status: "VALID" },
      });
      return NextResponse.json({ success: true, action: "resumed", count: result.count });
    }

    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  } catch (err) {
    console.error("pause-all error:", err);
    return NextResponse.json(
      { error: "Interner Fehler", detail: String(err) },
      { status: 500 }
    );
  }
}
