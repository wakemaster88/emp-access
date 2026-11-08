import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";
import { billingCsv, monthBounds } from "@/lib/verein-portal-rules";

/**
 * Vereinsbuchungen fuer die Abrechnung.
 *   GET ?month=YYYY-MM&vereinId=&format=csv  -> Liste bzw. CSV-Export
 *   PATCH { ids, billed, invoiceRef? }       -> als abgerechnet markieren / zuruecknehmen
 */
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) return NextResponse.json({ error: "Kein Mandant" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const bounds = monthBounds(sp.get("month") ?? "");
  if (!bounds) return NextResponse.json({ error: "month=YYYY-MM erforderlich" }, { status: 400 });
  const vereinId = Number(sp.get("vereinId"));

  const rows = await session.db.vereinSlotBooking.findMany({
    where: {
      accountId: session.accountId,
      date: { gte: bounds.from, lte: bounds.to },
      status: { in: ["BOOKED", "CANCELED"] },
      ...(Number.isInteger(vereinId) && vereinId > 0 ? { vereinId } : {}),
    },
    include: { verein: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { slotStart: "asc" }],
  });
  const mapped = rows.map((r) => ({
    id: r.id,
    vereinId: r.vereinId,
    vereinName: r.verein.name,
    serviceName: r.serviceName,
    date: r.date,
    slotStart: r.slotStart,
    slotEnd: r.slotEnd,
    priceCents: r.priceCents,
    status: r.status as "BOOKED" | "CANCELED",
    bookedBy: r.bookedBy,
    note: r.note,
    canceledBy: r.canceledBy,
    billedAt: r.billedAt,
    invoiceRef: r.invoiceRef,
  }));

  if (sp.get("format") === "csv") {
    const name = `vereinsbuchungen-${sp.get("month")}${mapped[0] && vereinId > 0 ? `-${mapped[0].vereinName}` : ""}`
      .replace(/[^\w.-]+/g, "_");
    return new NextResponse(billingCsv(mapped), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
      },
    });
  }
  return NextResponse.json(mapped);
}

const patchSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(1000),
  billed: z.boolean(),
  invoiceRef: z.string().trim().max(120).nullable().optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  if (session.accountId == null) return NextResponse.json({ error: "Kein Mandant" }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Angaben" }, { status: 400 });
  const { ids, billed, invoiceRef } = parsed.data;

  const result = await session.db.vereinSlotBooking.updateMany({
    where: { accountId: session.accountId, id: { in: ids }, status: "BOOKED" },
    data: billed
      ? { billedAt: new Date(), invoiceRef: invoiceRef || null }
      : { billedAt: null, invoiceRef: null },
  });
  return NextResponse.json({ ok: true, count: result.count });
}
