import { NextRequest, NextResponse } from "next/server";
import { validateApiToken, getSessionWithDb } from "@/lib/api-auth";
import { isValueValid } from "@/lib/wakesys";

/**
 * Wakesys API (query_operator.php) – wie api_wakesys.php.
 * Gültig wenn: card_valid === "yes" ODER next_tickets[0] ODER valid_until >= aktuelle Zeit.
 */

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const scan = request.nextUrl.searchParams.get("scan");
  if (!scan) {
    return NextResponse.json({ error: "Missing scan parameter" }, { status: 400 });
  }

  const { db } = auth;
  const config = await db.apiConfig.findFirst({
    where: { accountId: auth.account.id, provider: "WAKESYS" },
  });

  if (!config) {
    return NextResponse.json({ error: "Wakesys not configured" }, { status: 404 });
  }

  const extraConfig = config.extraConfig ? JSON.parse(config.extraConfig) : {};
  const account = extraConfig.account || (config.baseUrl ? new URL(config.baseUrl).hostname.split(".")[0] : null) || "default";
  const interfaceType = extraConfig.interfaceType || "gate";
  const interfaceIds: number[] = Array.isArray(extraConfig.interfaceIds)
    ? extraConfig.interfaceIds
    : extraConfig.interfaceId != null
      ? [Number(extraConfig.interfaceId)]
      : [2];

  try {
    const idsToTry = interfaceIds.length > 0 ? interfaceIds : [2];
    let lastData: unknown = null;

    for (const interfaceId of idsToTry) {
      const url = `https://${account}.wakesys.com/files_for_admin_and_browser/sql_query/query_operator.php?interface=gate&interface_id=${interfaceId}&controller_interface_type=${interfaceType}&id=${encodeURIComponent(scan)}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const value = data?.data?.value ?? null;
      lastData = value;

      if (isValueValid(value)) {
        return NextResponse.json({
          valid: true,
          scan,
          interfaceId,
          data: value,
        });
      }
    }

    return NextResponse.json({ valid: false, scan, data: lastData });
  } catch (err) {
    return NextResponse.json(
      { error: `Wakesys error: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const raw = String(body.code ?? "").trim();
  const code = raw.replace(/^#+/, "").replace(/\s+/g, "");
  if (!code) {
    return NextResponse.json({ error: "Kein Code eingegeben" }, { status: 400 });
  }

  const { db, accountId } = session;
  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "WAKESYS" },
  });
  if (!config) {
    return NextResponse.json({ error: "Wakesys nicht konfiguriert" }, { status: 404 });
  }

  const extraConfig = config.extraConfig ? JSON.parse(config.extraConfig) : {};
  const account =
    extraConfig.account ||
    (config.baseUrl ? new URL(config.baseUrl).hostname.split(".")[0] : null) ||
    "default";
  const interfaceType = extraConfig.interfaceType || "gate";
  const interfaceIds: number[] = Array.isArray(extraConfig.interfaceIds)
    ? extraConfig.interfaceIds
    : extraConfig.interfaceId != null
      ? [Number(extraConfig.interfaceId)]
      : [2];

  const idsToTry = interfaceIds.length > 0 ? interfaceIds : [2];

  try {
    for (const interfaceId of idsToTry) {
      const url = `https://${account}.wakesys.com/files_for_admin_and_browser/sql_query/query_operator.php?interface=gate&interface_id=${interfaceId}&controller_interface_type=${interfaceType}&id=${encodeURIComponent(code)}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const value = data?.data?.value ?? null;

      if (isValueValid(value)) {
        const firstName = value.col_first_name || null;
        const lastName = value.col_last_name || null;

        let matchingTickets: { id: number; name: string; firstName: string | null; lastName: string | null; ticketTypeName: string | null; rfidCode: string | null; status: string; subscriptionId: number | null }[] = [];
        if (firstName || lastName) {
          const nameWhere: Record<string, unknown> = { accountId: accountId! };
          if (firstName && lastName) {
            nameWhere.firstName = { contains: firstName, mode: "insensitive" };
            nameWhere.lastName = { contains: lastName, mode: "insensitive" };
          } else if (lastName) {
            nameWhere.lastName = { contains: lastName, mode: "insensitive" };
          } else {
            nameWhere.firstName = { contains: firstName, mode: "insensitive" };
          }
          nameWhere.status = { in: ["VALID", "REDEEMED"] };
          matchingTickets = await db.ticket.findMany({
            where: nameWhere,
            select: { id: true, name: true, firstName: true, lastName: true, ticketTypeName: true, rfidCode: true, status: true, subscriptionId: true },
            take: 10,
          });
        }

        return NextResponse.json({
          valid: true,
          code,
          interfaceId,
          name: [firstName, lastName].filter(Boolean).join(" ") || null,
          firstName,
          lastName,
          category: value.col_category_name || null,
          cardName: value.card_name || null,
          validUntil: value.valid_until || null,
          interface: value.interface || null,
          state: value.state || null,
          matchingTickets,
        });
      }
    }

    return NextResponse.json({ valid: false, code, message: "Code nicht gültig" });
  } catch (err) {
    return NextResponse.json(
      { error: `Wakesys-Fehler: ${err instanceof Error ? err.message : "unbekannt"}` },
      { status: 502 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();
  const ticketId = Number(body.ticketId);
  const rfidCode = String(body.rfidCode ?? "").trim().replace(/^#+/, "");

  if (!ticketId || !rfidCode) {
    return NextResponse.json({ error: "ticketId und rfidCode erforderlich" }, { status: 400 });
  }

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, accountId: accountId! },
    select: { id: true, name: true, rfidCode: true },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Ticket nicht gefunden" }, { status: 404 });
  }

  await db.ticket.update({
    where: { id: ticketId },
    data: { rfidCode },
  });

  return NextResponse.json({ ok: true, ticketId, rfidCode });
}
