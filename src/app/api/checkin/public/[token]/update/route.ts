import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rescheduleAnnyBooking } from "@/lib/anny-availability";

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
  // Berlin-Offset fuer ein gegebenes Datum (CET=+01:00, CEST=+02:00).
  const berlinOffset = (d: Date): string => {
    const jan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 12, 0, 0));
    const jul = new Date(Date.UTC(d.getUTCFullYear(), 6, 1, 12, 0, 0));
    const stdTzMinutes = Math.max(
      -jan.getTimezoneOffset(),
      -jul.getTimezoneOffset(),
    );
    // Server-Zeitzone ist nicht zwingend Berlin - daher hardcoded ueber
    // Date.toLocaleString-Trick die Berlin-lokale Stunde holen.
    const local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
    const offsetMin = (local.getTime() - utc.getTime()) / 60000;
    const sign = offsetMin >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    void stdTzMinutes;
    return `${sign}${hh}:${mm}`;
  };

  let newStartIso: string | null = null;
  let newEndIso: string | null = null;
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
        // Wir extrahieren das Datum in Berlin-Zeit (wichtig wenn baseDate
        // UTC 22:00 = naechster Tag in Berlin). Ein ISO-String wie
        // "2026-05-23T22:00:00.000Z" ist in Berlin der 24.05. - das sollte
        // beim Slot-Wechsel respektiert werden.
        const berlinDateStr = baseDate.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
        const offset = berlinOffset(baseDate);
        const buildIso = (hhmm: string): string =>
          `${berlinDateStr}T${hhmm}:00${offset}`;
        if (slotStartIn && TIME_RE.test(slotStartIn)) {
          newStartIso = buildIso(slotStartIn);
          updateData.startDate = new Date(newStartIso);
        }
        if (slotEndIn && TIME_RE.test(slotEndIn)) {
          newEndIso = buildIso(slotEndIn);
          updateData.endDate = new Date(newEndIso);
        }
      }
    }
  }

  // Wenn der Slot gewechselt wird UND das Ticket aus ANNY stammt, versuchen
  // wir die ANNY-Buchung mitzuverschieben. Schlaegt das fehl (Slot voll,
  // Anny untersagt Edit etc.), brechen wir den lokalen Update auch ab -
  // sonst laufen ANNY und EMP auseinander und der naechste Sync zieht den
  // EMP-Stand zurueck.
  let annySyncedSlot = false;
  if ((slotStartIn || slotEndIn) && newStartIso && newEndIso && ticket.source === "ANNY" && ticket.uuid) {
    // UUID-Format ist "anny:<customer>:<svc>:<bookingId>". Plan-Subs starten
    // mit "anny-sub:" und haben keine Booking-ID - die ueberspringen wir.
    const isBooking = ticket.uuid.startsWith("anny:");
    const parts = ticket.uuid.split(":");
    const bookingIdAny = isBooking ? parts[3] : undefined;
    if (bookingIdAny) {
      const annyCfg = await prisma.apiConfig.findFirst({
        where: { accountId: monitor.accountId, provider: "ANNY" },
        select: { token: true, baseUrl: true },
      });
      if (annyCfg?.token) {
        const result = await rescheduleAnnyBooking(
          annyCfg.baseUrl?.replace(/\/+$/, "") || "https://b.anny.co",
          annyCfg.token,
          bookingIdAny,
          newStartIso,
          newEndIso,
        );
        if (!result.ok) {
          return NextResponse.json({
            error: `ANNY-Buchung konnte nicht verschoben werden: ${result.message}`,
            annyStatus: result.status,
            // Wir geben dem UI einen Hinweis, dass der lokale Stand
            // unveraendert ist - kein partieller Erfolg.
            partial: false,
          }, { status: result.status >= 400 && result.status < 600 ? result.status : 502 });
        }
        annySyncedSlot = true;
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

  // Freitext-Notiz - leerer String wird zu null (entfernt die Notiz).
  if (body.notes !== undefined) {
    const v = typeof body.notes === "string" ? body.notes.trim() : "";
    updateData.notes = v || null;
  }

  // Gaeste-Infos (Antworten aus Info-Anfragen bzw. manuelle Erfassung am
  // Monitor): Objekt mit Label->Wert-Strings. Leere Werte werden entfernt,
  // leeres Objekt loescht die Infos (null).
  if (body.guestInfo !== undefined) {
    if (body.guestInfo === null) {
      updateData.guestInfo = null;
    } else if (typeof body.guestInfo === "object" && !Array.isArray(body.guestInfo)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.guestInfo as Record<string, unknown>)) {
        const key = String(k).trim().slice(0, 80);
        const val = typeof v === "string" ? v.trim().slice(0, 160) : "";
        if (key && val) clean[key] = val;
      }
      updateData.guestInfo = Object.keys(clean).length > 0 ? clean : null;
    } else {
      return NextResponse.json({ error: "guestInfo muss ein Objekt sein" }, { status: 400 });
    }
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
    annySynced: annySyncedSlot,
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
      notes: updated.notes,
      guestInfo: updated.guestInfo,
    },
  });
}
