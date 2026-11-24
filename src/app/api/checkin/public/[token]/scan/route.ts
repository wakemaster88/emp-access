import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { berlinOffset } from "@/lib/anny-availability";
import { buildScanCodeVariants } from "@/lib/scan-code-variants";
import { pickBestScanCandidate } from "@/lib/scan-candidate";
import { redeemBenefitVoucher } from "@/lib/gamification-service";
import { checkVoucherAccess } from "@/lib/voucher-access";
import { riderView } from "@/lib/customer-person";
import { appLinkInfo, readAppCode } from "@/lib/rider-kasse-link";
import { ensureAnnyBooker, loadAnnyOrder, loadChipView } from "@/lib/chips";
import type { ChipView } from "@/lib/chip-rules";

/** Kundenfenster: Fehler hier dürfen den Scan nicht kaputt machen. */
async function customerView(
  accountId: number,
  code: string | null,
  opts: { personId?: number | null; annyTicketId?: number | null } = {},
): Promise<ChipView | null> {
  try {
    return await loadChipView(accountId, code, opts);
  } catch (e) {
    console.error("[checkin/scan] Kundenfenster", e);
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const limited = publicRateLimit(token, "checkin-scan");
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json();
  const rawCode = String(body.code ?? "").trim();
  if (!rawCode) {
    return NextResponse.json({ found: false, message: "Kein Code" });
  }

  // App-Code aus der Kunden-App (Profil › „Abo fehlt?“): Abo mit der App
  // verknüpfen, siehe lib/rider-kasse-link und POST …/app-link.
  const app = readAppCode(rawCode);
  if (app) {
    if ("invalid" in app) {
      return NextResponse.json({ found: false, appCodeInvalid: true, message: "App-Code abgelaufen oder ungültig. Bitte in der App neu anzeigen lassen." });
    }
    const info = await appLinkInfo(monitor.accountId, app.profileId);
    if (!info) return NextResponse.json({ found: false, appCodeInvalid: true, message: "Diese App kennen wir nicht." });
    return NextResponse.json({ found: false, appLink: { code: rawCode, ...info } });
  }

  // Robust gegen DE/US-Tastaturlayout des Scanners (z.B. "GS-1234"
  // wird auf DE-Layout zu "gsß1234"), Praefix-Zeichen wie "#"/"%" und
  // unterschiedliche Schreibweisen.
  const codesToTry = buildScanCodeVariants(rawCode);
  let ticket = null;
  let matchedCode = rawCode;
  for (const c of codesToTry) {
    const candidates = await prisma.ticket.findMany({
      where: {
        accountId: monitor.accountId,
        OR: [
          { qrCode: c },
          { rfidCode: c },
          { barcode: c },
          { uuid: c },
        ],
      },
      include: {
        accessArea: { select: { id: true, name: true } },
        subscription: { select: { id: true, name: true, requiresPhoto: true, requiresRfid: true } },
        service: { select: { id: true, name: true, requiresPhoto: true, requiresRfid: true } },
        riderProfile: { select: { firstName: true, lastName: true, birthDate: true } },
      },
    });
    if (candidates.length > 0) {
      // Bei mehreren Treffern (rfidCode/qrCode sind NICHT eindeutig) das am
      // besten geeignete Ticket waehlen: ein gueltiges Abo/Vereins-Ticket
      // schlaegt ein abgelaufenes Einzel-Zeitticket (DURATION). Siehe
      // scan-candidate.ts.
      ticket = pickBestScanCandidate(candidates);
      matchedCode = c;
      break;
    }
  }

  if (!ticket) {
    // Gutschein: nicht automatisch einlösen, sondern dem Frontend
    // Voucher-Infos zurueckgeben, damit der Mitarbeiter Vor-/Nachname
    // erfasst und das Ticket bewusst erstellt. Eingeloest wird der
    // Voucher dann atomar im /ticket-Endpoint (mit voucherCode-Param).
    //
    // Wir suchen den Voucher unabhaengig vom "GS-"-Praefix, weil Codes
    // bei manchen Scannern Sonderzeichen vorne dranhaengen oder per
    // URL/QR-Code in einer abweichenden Form ankommen koennen. Die
    // Voucher-Erkennung laeuft jetzt ueber alle codeVarianten -
    // gefunden = Gutschein.
    const voucher = await prisma.voucher.findFirst({
      where: {
        accountId: monitor.accountId,
        OR: codesToTry.map((c) => ({ code: c })),
      },
    });
    if (voucher?.kind === "BENEFIT") {
      // Leistungs-Gutschein (Gamification): an der Kasse scannen = entwerten.
      // Es entsteht kein Ticket.
      const result = await redeemBenefitVoucher(prisma, monitor.accountId, voucher, "CHECKIN");
      return NextResponse.json({
        found: false,
        benefitRedeemed: result.ok,
        message: result.ok ? `Gutschein entwertet: ${result.label}` : result.message,
      });
    }
    if (voucher) {
      // Deaktivierte, eingelöste und abgelaufene Zutritts-Gutscheine werden
      // nicht angeboten (gemeinsame Regel aller Einlasswege).
      const access = checkVoucherAccess(voucher);
      if (!access.ok) {
        return NextResponse.json({
          found: false,
          message: access.message,
        });
      }

      const [service, accessArea] = await Promise.all([
        voucher.serviceId
          ? prisma.service.findUnique({
              where: { id: voucher.serviceId },
              select: { name: true },
            })
          : Promise.resolve(null),
        voucher.accessAreaId
          ? prisma.accessArea.findUnique({
              where: { id: voucher.accessAreaId },
              select: { name: true },
            })
          : Promise.resolve(null),
      ]);

      return NextResponse.json({
        found: false,
        voucher: {
          code: voucher.code,
          ticketTypeName: voucher.ticketTypeName,
          serviceId: voucher.serviceId,
          serviceName: service?.name ?? null,
          accessAreaId: voucher.accessAreaId,
          accessAreaName: accessArea?.name ?? null,
          validityType: voucher.validityType,
          validityDurationMinutes: voucher.validityDurationMinutes,
          discountPercent: voucher.discountPercent,
        },
        message: "Gutschein erkannt – bitte Ticket vervollständigen",
      });
    }

    // Unbekanntes Bändchen: Kundenfenster mit Vorschlag nach Uhrzeit.
    return NextResponse.json({
      found: false,
      message: "Ticket nicht gefunden",
      customer: await customerView(monitor.accountId, rawCode),
    });
  }

  let checkedIn = ticket.status === "REDEEMED";
  // Abos UND Vereinsmitglieder (vereinId): „eingecheckt“ ist tagesbezogen
  // (GRANTED-Scan heute), nicht dauerhaft über REDEEMED.
  if (ticket.subscriptionId != null || ticket.vereinId != null) {
    const berlinDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    const tz = berlinOffset(berlinDate);
    const dayStart = new Date(`${berlinDate}T00:00:00${tz}`);
    const dayEnd = new Date(`${berlinDate}T23:59:59${tz}`);
    const scanToday = await prisma.scan.findFirst({
      where: {
        ticketId: ticket.id,
        accountId: monitor.accountId,
        result: "GRANTED",
        scanTime: { gte: dayStart, lte: dayEnd },
      },
    });
    checkedIn = !!scanToday;
  }

  // Kundenfenster: anny-Buchung über den Bucher (Konto über die E-Mail aus
  // anny), sonst über das Bändchen.
  const isAnnyDay = ticket.source === "ANNY" && ticket.subscriptionId == null;
  let annyPerson: number | null = null;
  if (isAnnyDay) {
    annyPerson = await ensureAnnyBooker(monitor.accountId, ticket.id).catch((e) => {
      console.error("[checkin/scan] anny-Bucher", e);
      return null;
    });
  }
  // anny: der Barcode der Buchung ist kein Bändchen; das Bändchen des Buchers zählt.
  const annyOrder = isAnnyDay ? await loadAnnyOrder(monitor.accountId, ticket.id).catch(() => null) : null;
  const viewCode = isAnnyDay ? (annyOrder?.tickets.find((t) => t.booker)?.rfidCode ?? null) : matchedCode;
  const customer = await customerView(monitor.accountId, viewCode, {
    personId: annyPerson ?? ticket.riderProfileId ?? null,
    annyTicketId: isAnnyDay ? ticket.id : null,
  });

  // Abo: Name der Person, die damit fährt (lib/customer-person).
  const rider = riderView(ticket);
  return NextResponse.json({
    customer,
    found: true,
    ticket: {
      id: ticket.id,
      name: ticket.name,
      firstName: rider.firstName,
      lastName: rider.lastName,
      birthDate: rider.birthDate,
      riderOpen: rider.riderOpen,
      ticketTypeName: ticket.ticketTypeName,
      status: ticket.status,
      validityType: ticket.validityType,
      slotStart: ticket.slotStart,
      slotEnd: ticket.slotEnd,
      validityDurationMinutes: ticket.validityDurationMinutes,
      firstScanAt: ticket.firstScanAt,
      startDate: ticket.startDate,
      endDate: ticket.endDate,
      profileImage: ticket.profileImage,
      rfidCode: ticket.rfidCode,
      extras: ticket.extras,
      source: ticket.source,
      subscriptionId: ticket.subscriptionId,
      accessArea: ticket.accessArea,
      subscription: ticket.subscription,
      service: ticket.service,
      checkedIn,
    },
  });
}
