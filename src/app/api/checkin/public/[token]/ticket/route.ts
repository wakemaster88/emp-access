import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ticketCreateSchema } from "@/lib/validators";
import { resolveAnnyOrganizationId, fetchAnnyServiceMatch, resolveServiceResourceId } from "@/lib/anny-availability";
import { createAnnyBookingV2 } from "@/lib/anny-bookings";

const publicTicketCreateSchema = ticketCreateSchema.extend({
  voucherCode: z.string().min(1).optional(),
  // Bei Code-Konflikt mit einem bestehenden Ticket: wenn `transferCode`
  // true ist, wird der Code vom alten Ticket abgezogen und auf das neue
  // umgehaengt. Genutzt z.B. bei recycelten Tagesgast-Baendchen.
  transferCode: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = publicTicketCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const voucherCode = data.voucherCode?.trim() || null;
  const transferCode = data.transferCode === true;

  // Guard: endDate nie vor startDate (z.B. zukuenftiger Ferienkurs-Start
  // mit Fallback-Ende "heute"). Ohne Korrektur matcht der Shop-Monitor-
  // Datumsfilter keinen Tag.
  if (
    data.startDate
    && data.endDate
    && data.validityType !== "DURATION"
  ) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
      const fixedEnd = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
        23,
        59,
        59,
        999,
      );
      data.endDate = fixedEnd.toISOString();
    }
  }

  let serviceAreaIds: number[] = [];
  if (data.serviceId) {
    const svcRow = await prisma.service.findFirst({
      where: { id: data.serviceId, accountId: monitor.accountId },
      select: {
        defaultValidityType: true,
        defaultValidityDurationMinutes: true,
      },
    });
    // Service-Default sticht das Frontend: eine Stundenkarte darf nicht als
    // Zeitslot landen, sonst startet der Timer nie.
    if (svcRow?.defaultValidityType === "DURATION") {
      data.validityType = "DURATION";
      if (svcRow.defaultValidityDurationMinutes != null) {
        data.validityDurationMinutes = svcRow.defaultValidityDurationMinutes;
      }
      data.slotStart = undefined;
      data.slotEnd = undefined;
    }
    const svcAreas = await prisma.serviceArea.findMany({
      where: { serviceId: data.serviceId },
      select: { accessAreaId: true },
    });
    serviceAreaIds = svcAreas.map((sa: { accessAreaId: number }) => sa.accessAreaId);
  }

  // Pre-Check: Wenn barcode/qrCode/rfidCode bereits einem Ticket im
  // gleichen Account gehoeren, brechen wir mit 409 ab statt 500 - es sei
  // denn der Aufrufer setzt `transferCode: true`, dann wird der Code
  // vom alten Ticket abgezogen und auf das neue uebertragen.
  // (Frueher hat Prisma einen Unique-Constraint-Fehler ungebremst zum
  // 500 durchgereicht.)
  const codes = [data.barcode, data.qrCode, data.rfidCode].filter(
    (c): c is string => !!c,
  );
  let conflictTicketId: number | null = null;
  if (codes.length > 0) {
    const conflict = await prisma.ticket.findFirst({
      where: {
        accountId: monitor.accountId,
        OR: [
          { barcode: { in: codes } },
          { qrCode: { in: codes } },
          { rfidCode: { in: codes } },
        ],
      },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
      },
    });
    if (conflict) {
      if (!transferCode) {
        const owner =
          [conflict.firstName, conflict.lastName].filter(Boolean).join(" ")
          || conflict.name;
        return NextResponse.json(
          {
            error: {
              formErrors: [
                `Code ist bereits Ticket "${owner}" zugeordnet${
                  conflict.ticketTypeName ? ` (${conflict.ticketTypeName})` : ""
                }.`,
              ],
              code: "CODE_CONFLICT",
              conflictTicketId: conflict.id,
              conflictTicketLabel: owner,
              conflictTicketType: conflict.ticketTypeName,
            },
          },
          { status: 409 },
        );
      }
      conflictTicketId = conflict.id;
    }
  }

  // ANNY-Booking anlegen (Kapazitaet in ANNY blocken).
  //
  // Bedingungen:
  //   * Es wurde ein Service mit ANNY-Verknuepfung gewaehlt
  //   * Es ist ein konkreter Slot (start + end gesetzt, beide am selben Tag,
  //     Differenz <= 8h - sonst sind das Tagespaesse / DATE_RANGE-Tickets,
  //     die in ANNY keinen Sinn ergeben)
  //
  // Wenn ANNY die Buchung abweist (z.B. 422 "slot unavailable", weil parallel
  // jemand direkt in ANNY gebucht hat), brechen wir mit 409 ab - sonst
  // verkaufen wir Slots ueber Kapazitaet hinweg.
  // Wenn ANNY hingegen technisch nicht erreichbar ist (Netzwerk-Timeout,
  // 5xx etc.), legen wir das Ticket trotzdem an (best-effort - der Verkauf
  // soll an einem ANNY-Ausfall nicht scheitern). Wir loggen den Fehler.
  let annyBookingId: string | null = null;
  if (data.serviceId && data.startDate && data.endDate) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const durationMs = end.getTime() - start.getTime();
    const isPlausibleSlot =
      !isNaN(durationMs) && durationMs > 0 && durationMs <= 8 * 60 * 60 * 1000;

    if (isPlausibleSlot) {
      const svc = await prisma.service.findFirst({
        where: { id: data.serviceId, accountId: monitor.accountId },
        select: {
          name: true,
          annyNames: true,
          serviceAreas: {
            select: {
              area: {
                select: {
                  annyLinks: {
                    select: { annyResourceId: true },
                  },
                },
              },
            },
          },
        },
      });

      // Alle ueber AccessArea/AnnyResourceLink verknuepften ANNY-Resources
      // dieses Service. Die konkrete Resource (Seilbahn A vs B) wird unten
      // ueber die Schnittmenge mit dem ANNY-Service bestimmt.
      const serviceLinkedResourceIds = (svc?.serviceAreas ?? [])
        .flatMap((sa) => sa.area?.annyLinks ?? [])
        .map((l) => l.annyResourceId)
        .filter((x): x is string => !!x);
      const firstResourceUuid = serviceLinkedResourceIds[0];

      if (svc && firstResourceUuid) {
        const annyNames: string[] = [];
        if (svc.annyNames) {
          try {
            const parsed = JSON.parse(svc.annyNames);
            if (Array.isArray(parsed)) {
              for (const n of parsed) if (typeof n === "string" && n.trim()) annyNames.push(n.trim());
            }
          } catch { /* ignore */ }
        }
        if (svc.name) {
          annyNames.push(svc.name);
          const parts = svc.name.split(/\s[-–]\s/);
          if (parts.length > 1) for (const p of parts) if (p.trim()) annyNames.push(p.trim());
        }
        const uniqueNames = Array.from(new Set(annyNames));

        const annyConfig = await prisma.apiConfig.findFirst({
          where: { accountId: monitor.accountId, provider: "ANNY" },
          select: { token: true, baseUrl: true, extraConfig: true },
        });

        if (annyConfig?.token && uniqueNames.length > 0) {
          const baseUrl = (annyConfig.baseUrl || "https://b.anny.co").replace(/\/+$/, "");
          const organizationId = await resolveAnnyOrganizationId(
            baseUrl,
            annyConfig.token,
            annyConfig.extraConfig,
          );
          const match = await fetchAnnyServiceMatch(
            baseUrl,
            annyConfig.token,
            uniqueNames,
            organizationId,
          );
          const annyServiceUuid = match.id;

          // Bei Services, die mehrere Resources bedienen (Seilbahn A/B),
          // die zu DIESEM EMP-Service passende Resource bestimmen
          // (Schnittmenge EMP-Resources ∩ ANNY-Service-Resources), sonst
          // erste verknuepfte Resource.
          const resourceUuid =
            resolveServiceResourceId(serviceLinkedResourceIds, match.resourceIds ?? [])
            ?? firstResourceUuid;

          if (annyServiceUuid) {
            const ownerName =
              [data.firstName, data.lastName].filter(Boolean).join(" ") || data.name;
            // Buchung ueber POST /api/v1/bookings (createAnnyBookingV2) - der
            // alte /orders/from-config-Weg crasht fuer diesen Account mit 500.
            const result = await createAnnyBookingV2({
              baseUrl,
              token: annyConfig.token,
              serviceUuid: annyServiceUuid,
              resourceUuid,
              startIso: start.toISOString(),
              endIso: end.toISOString(),
              description: `EMP-Access${ownerName ? ` - ${ownerName}` : ""}`,
              notifyCustomer: false,
              organizationId,
            });

            if (result.ok) {
              annyBookingId = result.bookingId;
            } else if (result.status === 422) {
              // ANNY sagt "Slot voll / Konflikt". Verkauf abbrechen.
              return NextResponse.json(
                {
                  error: {
                    formErrors: [
                      "Slot ist in ANNY bereits ausgebucht oder gesperrt. Bitte einen anderen Slot waehlen.",
                    ],
                    code: "ANNY_SLOT_UNAVAILABLE",
                  },
                },
                { status: 409 },
              );
            } else {
              // ANNY-Ausfall (5xx, Timeout, etc.) - Ticket trotzdem anlegen.
              console.warn(
                "[checkin/ticket] ANNY-Booking fehlgeschlagen (Best-Effort, Ticket wird trotzdem angelegt)",
                { status: result.status, error: result.error },
              );
            }
          } else {
            console.warn(
              "[checkin/ticket] ANNY-Service nicht gefunden - kein Booking-Sync",
              { tried: uniqueNames },
            );
          }
        }
      }
    }
  }

  const ticketData = {
    name: data.name,
    qrCode: data.qrCode,
    rfidCode: data.rfidCode,
    startDate: data.startDate ? new Date(data.startDate) : undefined,
    endDate: data.endDate ? new Date(data.endDate) : undefined,
    accessAreaId: data.accessAreaId,
    subscriptionId: data.subscriptionId,
    serviceId: data.serviceId,
    status: data.status ?? "VALID",
    barcode: data.barcode,
    firstName: data.firstName,
    lastName: data.lastName,
    ticketTypeName: data.ticketTypeName,
    validityType: data.validityType ?? "DATE_RANGE",
    slotStart: data.slotStart,
    slotEnd: data.slotEnd,
    validityDurationMinutes: data.validityDurationMinutes,
    profileImage: data.profileImage,
    accountId: monitor.accountId,
    annyBookingId,
    ...(serviceAreaIds.length > 0
      ? {
          ticketAreas: {
            create: serviceAreaIds.map((areaId) => ({ accessAreaId: areaId })),
          },
        }
      : {}),
  };

  function handleCreateError(e: unknown): NextResponse {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return NextResponse.json(
        {
          error: {
            formErrors: [
              "Code ist bereits einem anderen Ticket zugeordnet. Bitte einen anderen Code verwenden.",
            ],
          },
        },
        { status: 409 },
      );
    }
    console.error("[/api/checkin/public/[token]/ticket] create failed", { err: msg });
    return NextResponse.json(
      {
        error: {
          formErrors: [
            "Ticket konnte nicht erstellt werden. Bitte erneut versuchen.",
          ],
          serverMessage: msg,
        },
      },
      { status: 500 },
    );
  }

  // Wenn ein Gutschein-Code mitkommt: Ticket erstellen + Voucher atomar
  // einloesen. Bei paralleler Einloesung (z.B. 2 Tabs) gewinnt genau
  // ein Request dank `updateMany` mit `redeemedAt: null`-Filter.
  if (voucherCode) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(monitor.accountId)}, TRUE)`;

        const voucher = await tx.voucher.findUnique({
          where: { code: voucherCode },
        });
        if (!voucher || voucher.accountId !== monitor.accountId) {
          throw new Error("VOUCHER_NOT_FOUND");
        }
        if (voucher.disabledAt) {
          throw new Error("VOUCHER_DISABLED");
        }
        if (voucher.redeemedAt) {
          throw new Error("VOUCHER_ALREADY_REDEEMED");
        }

        if (conflictTicketId != null) {
          await tx.ticket.update({
            where: { id: conflictTicketId },
            data: { barcode: null, qrCode: null, rfidCode: null },
          });
        }

        const newTicket = await tx.ticket.create({ data: ticketData });

        const updated = await tx.voucher.updateMany({
          where: { id: voucher.id, redeemedAt: null },
          data: { redeemedAt: new Date(), redeemedTicketId: newTicket.id },
        });
        if (updated.count === 0) {
          throw new Error("VOUCHER_ALREADY_REDEEMED");
        }

        return newTicket;
      });

      return NextResponse.json(result, { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "VOUCHER_NOT_FOUND") {
        return NextResponse.json(
          { error: { formErrors: ["Gutschein nicht gefunden."] } },
          { status: 404 },
        );
      }
      if (msg === "VOUCHER_ALREADY_REDEEMED") {
        return NextResponse.json(
          { error: { formErrors: ["Gutschein wurde bereits eingelöst."] } },
          { status: 409 },
        );
      }
      if (msg === "VOUCHER_DISABLED") {
        return NextResponse.json(
          { error: { formErrors: ["Gutschein wurde deaktiviert."] } },
          { status: 409 },
        );
      }
      return handleCreateError(e);
    }
  }

  try {
    if (conflictTicketId != null) {
      // Code-Transfer: in einer Transaktion alten Code abziehen und
      // neues Ticket mit dem Code erstellen.
      const ticket = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(monitor.accountId)}, TRUE)`;
        await tx.ticket.update({
          where: { id: conflictTicketId! },
          data: { barcode: null, qrCode: null, rfidCode: null },
        });
        return tx.ticket.create({ data: ticketData });
      });
      return NextResponse.json(ticket, { status: 201 });
    }

    const ticket = await prisma.ticket.create({ data: ticketData });
    return NextResponse.json(ticket, { status: 201 });
  } catch (e) {
    return handleCreateError(e);
  }
}
