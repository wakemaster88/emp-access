import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json();
  const ticketId = Number(body.ticketId);
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: "ticketId erforderlich" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, accountId: monitor.accountId },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  if (body.profileImage !== undefined) {
    updateData.profileImage = body.profileImage || null;
  }

  if (body.rfidCode !== undefined) {
    const rfid = (body.rfidCode as string)?.trim() || null;

    if (rfid) {
      const existing = await prisma.ticket.findFirst({
        where: {
          rfidCode: rfid,
          accountId: monitor.accountId,
          id: { not: ticket.id },
        },
        select: { id: true, name: true, firstName: true, lastName: true, ticketTypeName: true },
      });

      if (existing && !body.force) {
        const ownerName = [existing.firstName, existing.lastName].filter(Boolean).join(" ") || existing.name;
        return NextResponse.json({
          conflict: true,
          existingTicketId: existing.id,
          existingOwner: ownerName,
          existingType: existing.ticketTypeName,
          message: `RFID ist bereits vergeben an ${ownerName}`,
        }, { status: 409 });
      }

      if (existing && body.force) {
        await prisma.ticket.update({
          where: { id: existing.id },
          data: { rfidCode: null, version: { increment: 1 } },
        });
      }
    }

    updateData.rfidCode = rfid;
  }

  if (body.startDate !== undefined) {
    updateData.startDate = body.startDate ? new Date(body.startDate) : null;
  }
  if (body.endDate !== undefined) {
    updateData.endDate = body.endDate ? new Date(body.endDate) : null;
  }

  // Slot-Wechsel: slotStart/slotEnd als "HH:MM" string. Wenn beides gesetzt
  // ist UND ein startDate gesetzt ist (bzw. das Ticket schon eines hat),
  // ziehen wir start/end automatisch nach, damit ANNY-Listings + Frontend-
  // Filter konsistent bleiben (z.B. "Tickets dieses Slots heute"). Wer nur
  // slotStart/slotEnd ohne Datum schickt, bekommt nur die HH:MM-Felder
  // aktualisiert.
  const slotStartIn = typeof body.slotStart === "string" ? body.slotStart.trim() : undefined;
  const slotEndIn = typeof body.slotEnd === "string" ? body.slotEnd.trim() : undefined;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (slotStartIn !== undefined) {
    if (slotStartIn !== "" && !TIME_RE.test(slotStartIn)) {
      return NextResponse.json({ error: "slotStart muss HH:MM (00:00-23:59) sein" }, { status: 400 });
    }
    updateData.slotStart = slotStartIn || null;
  }
  if (slotEndIn !== undefined) {
    if (slotEndIn !== "" && !TIME_RE.test(slotEndIn)) {
      return NextResponse.json({ error: "slotEnd muss HH:MM (00:00-23:59) sein" }, { status: 400 });
    }
    updateData.slotEnd = slotEndIn || null;
  }
  if (slotStartIn || slotEndIn) {
    // Datums-Basis fuer start/end aktualisieren: bevorzugt body.startDate
    // (z.B. wenn der User auf "morgen" verschiebt), sonst das Datum am
    // bestehenden Ticket. Ohne Datums-Basis lassen wir start/end unangetastet.
    const baseStartIso =
      typeof body.startDate === "string" && body.startDate
        ? body.startDate
        : ticket.startDate?.toISOString() ?? null;
    if (baseStartIso) {
      const baseDate = new Date(baseStartIso);
      if (!isNaN(baseDate.getTime())) {
        const yyyy = baseDate.getUTCFullYear();
        const mm = String(baseDate.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(baseDate.getUTCDate()).padStart(2, "0");
        const dayKey = `${yyyy}-${mm}-${dd}`;
        // Berlin-Offset abschaetzen: Europe/Berlin ist UTC+1 (CET) bzw.
        // UTC+2 (CEST). Anny-Daten kommen sowieso mit konkretem Offset -
        // wir nehmen den vom Eingabedatum, damit Hin- und Rueckkonvertierung
        // stabil bleibt.
        const offsetMs = baseDate.getTimezoneOffset() * 60 * 1000;
        const buildAt = (hhmm: string): Date => {
          const [h, m] = hhmm.split(":").map(Number);
          // Wir wollen die Uhrzeit als "local Berlin"-Zeit interpretieren -
          // im Browser ist `new Date("YYYY-MM-DDTHH:MM")` lokal, hier auf
          // dem Server muessen wir explizit Berlin-Offset annehmen. Wir
          // konstruieren UTC-Datum und subtrahieren den (vermuteten)
          // Berlin-Offset des baseDate.
          const utc = new Date(`${dayKey}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);
          return new Date(utc.getTime() + offsetMs);
        };
        if (slotStartIn && TIME_RE.test(slotStartIn)) {
          updateData.startDate = buildAt(slotStartIn);
        }
        if (slotEndIn && TIME_RE.test(slotEndIn)) {
          updateData.endDate = buildAt(slotEndIn);
        }
      }
    }
  }

  if (body.firstName !== undefined) {
    const v = typeof body.firstName === "string" ? body.firstName.trim() : "";
    updateData.firstName = v || null;
  }
  if (body.lastName !== undefined) {
    const v = typeof body.lastName === "string" ? body.lastName.trim() : "";
    updateData.lastName = v || null;
  }
  if (body.birthDate !== undefined) {
    updateData.birthDate = body.birthDate ? new Date(body.birthDate) : null;
  }

  // Wenn Vor-/Nachname aktualisiert wurden, ziehen wir den `name`
  // automatisch nach. So bleibt das, was im Listing/Header angezeigt
  // wird, konsistent.
  if (body.firstName !== undefined || body.lastName !== undefined) {
    const newFirst =
      body.firstName !== undefined
        ? (typeof body.firstName === "string" ? body.firstName.trim() : "")
        : ticket.firstName ?? "";
    const newLast =
      body.lastName !== undefined
        ? (typeof body.lastName === "string" ? body.lastName.trim() : "")
        : ticket.lastName ?? "";
    const fullName = `${newFirst} ${newLast}`.trim();
    if (fullName) {
      updateData.name = fullName;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Keine Änderungen" }, { status: 400 });
  }

  updateData.version = { increment: 1 };

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: updateData,
  });

  return NextResponse.json({
    success: true,
    ticket: {
      id: updated.id,
      name: updated.name,
      firstName: updated.firstName,
      lastName: updated.lastName,
      birthDate: updated.birthDate,
      profileImage: updated.profileImage,
      rfidCode: updated.rfidCode,
      startDate: updated.startDate,
      endDate: updated.endDate,
      slotStart: updated.slotStart,
      slotEnd: updated.slotEnd,
    },
  });
}
