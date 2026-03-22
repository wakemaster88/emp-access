import type { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";
import { computeResourceUtilization } from "@/lib/resource-utilization";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || !!request.headers.get("authorization")?.startsWith("Bearer ");
}

function jsonResponse(
  dateStr: string,
  resources: Awaited<ReturnType<typeof computeResourceUtilization>>,
) {
  return NextResponse.json({
    date: dateStr,
    note: "Kalendertag (00:00–23:59 lokal); Ticket-Gültigkeit wie im Dashboard.",
    resources,
    meta: {
      capacityField: "personLimit am Zugangsbereich",
      ticketRule:
        "Eindeutige Tickets mit Status VALID/REDEEMED, deren Gültigkeit den Tag überlappt; inkl. Abo-/Service-Zuordnung und TicketArea.",
    },
  });
}

/**
 * Auslastung pro Ressource (Zugangsbereich): gültige Tickets am Tag / Kapazität (personLimit).
 *
 * Auth wie eigene API: Bearer-Token oder ?token= (Account apiToken), alternativ eingeloggte Session.
 *
 * GET /api/webhook/utilization?date=2026-03-22
 * Query: date (YYYY-MM-DD, optional, default heute), all=1 (auch Bereiche ohne Dashboard-Flag)
 */
export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  const selectedDate = dateParam ? new Date(dateParam + "T12:00:00") : new Date();
  if (isNaN(selectedDate.getTime())) {
    return NextResponse.json({ error: "Ungültiges Datum (erwartet YYYY-MM-DD)" }, { status: 400 });
  }

  const dayStart = new Date(selectedDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(selectedDate);
  dayEnd.setHours(23, 59, 59, 999);

  const y = dayStart.getFullYear();
  const m = String(dayStart.getMonth() + 1).padStart(2, "0");
  const d = String(dayStart.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  const allResources = request.nextUrl.searchParams.get("all") === "1";
  const opts = { onlyShowOnDashboard: !allResources };

  if (hasApiToken(request)) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    const resources = await computeResourceUtilization(
      auth.db as unknown as PrismaClient,
      auth.account.id,
      dayStart,
      dayEnd,
      opts,
    );
    return jsonResponse(dateStr, resources);
  }

  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.isSuperAdmin) {
    return NextResponse.json(
      { error: "Super-Admin: bitte API-Token nutzen oder Account wählen" },
      { status: 400 },
    );
  }

  const resources = await computeResourceUtilization(
    session.db as unknown as PrismaClient,
    session.accountId!,
    dayStart,
    dayEnd,
    opts,
  );
  return jsonResponse(dateStr, resources);
}
