import { NextRequest } from "next/server";
import { notFound, wawiSession } from "@/lib/warenwirtschaft-server";
import { buildStocktakePdf, stocktakePdfFileName } from "@/lib/stocktake-pdf";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/warenwirtschaft/stocktakes/[id]/pdf – Inventurliste als PDF (Ablage, Steuerberater). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return notFound("Inventur");
  const [st, account] = await Promise.all([
    s.db.stocktake.findFirst({
      where: { id, accountId: s.accountId },
      include: { lines: { orderBy: [{ category: "asc" }, { name: "asc" }] } },
    }),
    s.db.account.findUnique({ where: { id: s.accountId }, select: { name: true } }),
  ]);
  if (!st) return notFound("Inventur");

  const pdf = buildStocktakePdf({
    accountName: account?.name ?? "",
    kind: st.kind,
    title: st.title,
    date: st.date,
    status: st.status,
    closedAt: st.closedAt,
    closedBy: st.closedBy,
    lines: st.lines,
  });

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(stocktakePdfFileName(st.title))}`,
      "Cache-Control": "no-store",
    },
  });
}
