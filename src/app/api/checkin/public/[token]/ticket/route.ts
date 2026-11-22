import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ticketCreateSchema } from "@/lib/validators";
import { resolveAnnyOrganizationId, fetchAnnyServiceMatch, resolveServiceResourceId } from "@/lib/anny-availability";
import { createAnnyBookingV2 } from "@/lib/anny-bookings";
import { aboEmailError } from "@/lib/abo-email";
import { linkAboCustomerSafe, RiderError } from "@/lib/customers";
import { codesForDecision, countForPerson, decideSale, recordChipSale, type SaleCheck } from "@/lib/chips";
import { conflictText, isTicketInUse } from "@/lib/chip-rules";

const publicTicketCreateSchema = ticketCreateSchema.extend({
  voucherCode: z.string().min(1).optional(),
  // Baendchen am Kunden (lib/chips): ein Code darf an mehreren Tickets
  // derselben Person haengen. Bei einem Konflikt entscheidet die Kasse:
  // `shareCode` = alte Tickets behalten den Code, das neue bekommt ihn dazu;
  // `transferCode` = Code von den alten Tickets abziehen (Baendchen geht an
  // jemand anderen).
  transferCode: z.boolean().optional(),
  shareCode: z.boolean().optional(),
  /** Person aus dem Kundenfenster, fuer die verkauft wird. */
  personId: z.number().int().positive().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const limited = publicRateLimit(token, "checkin-ticket");
  if (limited) return limited;
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

  // Jedes Abo hängt an einer E-Mail-Adresse (siehe lib/abo-email).
  const emailError = aboEmailError(null, { subscriptionId: data.subscriptionId, email: data.email });
  if (emailError) {
    return NextResponse.json({ error: { formErrors: [emailError], fieldErrors: { email: [emailError] } } }, { status: 400 });
  }
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

  // Baendchen am Kunden (lib/chips): Gehoert der Code derselben Person (oder
  // niemandem), behalten die alten Tickets ihn und das neue bekommt ihn
  // dazu. Statistik und laufende Abos bleiben so am Baendchen. Konflikte
  // (anderer Gast, Leihbaendchen noch in Benutzung, Mitarbeiter-Chip) gehen
  // mit 409 zurueck; die Kasse entscheidet mit shareCode/transferCode.
  const code = data.rfidCode || data.qrCode || data.barcode || null;
  let sale: SaleCheck | null = null;
  if (code) {
    try {
      sale = await decideSale(monitor.accountId, {
        code,
        personId: data.personId ?? null,
        typedName: data.firstName || data.lastName ? { firstName: data.firstName, lastName: data.lastName } : undefined,
        resolve: transferCode ? "transfer" : data.shareCode ? "share" : null,
      });
    } catch (e) {
      if (e instanceof RiderError) {
        return NextResponse.json({ error: { formErrors: [e.message] } }, { status: e.status });
      }
      throw e;
    }
    const d = sale.decision;
    if (d.kind === "CONFLICT") {
      const holderName = [sale.holder?.firstName, sale.holder?.lastName].filter(Boolean).join(" ") || null;
      const first = sale.tickets.find((t) => d.ticketIds.includes(t.id)) ?? sale.tickets[0];
      const owner = holderName
        || [first?.firstName, first?.lastName].filter(Boolean).join(" ")
        || "ein anderes Ticket";
      return NextResponse.json(
        {
          error: {
            formErrors: [conflictText(d.reason, holderName)],
            code: "CODE_CONFLICT",
            reason: d.reason,
            conflictTicketId: first?.id ?? null,
            conflictTicketLabel: owner,
            conflictTicketType: null,
            holderId: sale.holder?.id ?? null,
            holderName,
            // Uebergeben nimmt einem laufenden Abo das Baendchen: Kasse warnt.
            runningAbo: sale.tickets.some((t) => d.ticketIds.includes(t.id) && t.subscriptionId != null && isTicketInUse(t)),
            // Uebergeben (Code abziehen) bietet die Kasse nur an, wo es Sinn hat.
            canShare: d.reason !== "BLOCKED",
            canTransfer: d.reason !== "BLOCKED",
          },
        },
        { status: 409 },
      );
    }
  }
  const decision = sale?.decision ?? null;
  const stripTicketIds = decision?.kind === "TRANSFER" ? decision.stripTicketIds : [];
  const codeFields = code && decision ? codesForDecision(code, decision) : {};
  const saleRiderProfileId =
    decision && decision.kind !== "CONFLICT" ? decision.personId : (data.personId ?? null);

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
    barcode: data.barcode,
    qrCode: data.qrCode,
    rfidCode: data.rfidCode,
    ...codeFields,
    ...(saleRiderProfileId != null ? { riderProfileId: saleRiderProfileId } : {}),
    startDate: data.startDate ? new Date(data.startDate) : undefined,
    endDate: data.endDate ? new Date(data.endDate) : undefined,
    accessAreaId: data.accessAreaId,
    subscriptionId: data.subscriptionId,
    serviceId: data.serviceId,
    status: data.status ?? "VALID",
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email?.trim().toLowerCase() || undefined,
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

  /** Baendchen und Verlauf fortschreiben, Tagesticket der Person zaehlen. */
  async function afterSale(ticket: { id: number; riderProfileId: number | null }) {
    if (code && sale && sale.decision.kind !== "CONFLICT") {
      await recordChipSale(monitor!.accountId, {
        code,
        decision: sale.decision,
        ticketId: ticket.id,
        owner: sale.owner,
        previousHolder: sale.holder?.id ?? null,
      }).catch((e) => console.error("[checkin/ticket] Baendchen-Verlauf", e));
    }
    if (ticket.riderProfileId != null) {
      await countForPerson(monitor!.accountId, [ticket.id]).catch((e) => console.error("[checkin/ticket] Zaehlen", e));
    }
  }

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

        const voucher = await tx.voucher.findUnique({
          where: { code: voucherCode },
        });
        if (!voucher || voucher.accountId !== monitor.accountId) {
          throw new Error("VOUCHER_NOT_FOUND");
        }
        if (voucher.kind === "BENEFIT") {
          // Leistungs-Gutscheine werden nur entwertet, nie zu einem Ticket.
          throw new Error("VOUCHER_NOT_FOUND");
        }
        if (voucher.disabledAt) {
          throw new Error("VOUCHER_DISABLED");
        }
        if (voucher.redeemedAt) {
          throw new Error("VOUCHER_ALREADY_REDEEMED");
        }

        if (stripTicketIds.length > 0) await stripCodes(tx, stripTicketIds, code!);

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

      await afterSale(result);
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
    const ticket = stripTicketIds.length > 0
      ? await prisma.$transaction(async (tx) => {
          // Baendchen uebergeben: alte Tickets verlieren den Code.
          await stripCodes(tx, stripTicketIds, code!);
          return tx.ticket.create({ data: ticketData });
        })
      : await prisma.ticket.create({ data: ticketData });
    if (ticket.subscriptionId != null) await linkAboCustomerSafe(ticket.accountId, ticket.id);
    await afterSale(ticket);
    return NextResponse.json(ticket, { status: 201 });
  } catch (e) {
    return handleCreateError(e);
  }
}

/**
 * Code von alten Tickets abziehen (nur die Felder, in denen genau dieser
 * Code steht). Statistik bleibt am alten Ticket und an seiner Person.
 */
async function stripCodes(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ticketIds: number[],
  code: string,
): Promise<void> {
  await tx.ticket.updateMany({ where: { id: { in: ticketIds }, rfidCode: code }, data: { rfidCode: null } });
  await tx.ticket.updateMany({ where: { id: { in: ticketIds }, qrCode: code }, data: { qrCode: null } });
  await tx.ticket.updateMany({ where: { id: { in: ticketIds }, barcode: code }, data: { barcode: null } });
}
