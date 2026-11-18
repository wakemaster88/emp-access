import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { StocktakeCount } from "./stocktake-count";
import type { TenantDb } from "@/lib/prisma";
import { ChevronLeft } from "lucide-react";

/** Zählseite einer Inventur, geteilt von laufender und Stichtagsinventur. */
export async function StocktakeDetailPage({
  id,
  kind,
  db,
  accountId,
  accountName,
}: {
  id: number;
  kind: "ROLLING" | "CUTOFF";
  db: TenantDb;
  accountId: number;
  accountName: string | null;
}) {
  const listPath = kind === "CUTOFF" ? "/warenwirtschaft/stichtag" : "/warenwirtschaft/inventur";
  if (!Number.isInteger(id)) notFound();
  const st = await db.stocktake.findFirst({
    where: { id, accountId, kind },
    include: {
      lines: {
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: { article: { select: { image: true } } },
      },
    },
  });
  if (!st) notFound();

  return (
    <>
      <Header title={kind === "CUTOFF" ? "Stichtagsinventur" : "Inventur"} accountName={accountName} />
      <div className="page-content space-y-3">
        <Link href={listPath} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
          <ChevronLeft className="h-4 w-4" />
          Alle {kind === "CUTOFF" ? "Stichtage" : "Zählungen"}
        </Link>
        <StocktakeCount
          listPath={listPath}
          info={{
            id: st.id,
            kind: st.kind,
            title: st.title,
            date: st.date.toISOString(),
            status: st.status,
            closedAt: st.closedAt?.toISOString() ?? null,
            closedBy: st.closedBy,
          }}
          initialLines={st.lines.map((l) => ({
            id: l.id,
            name: l.name,
            sku: l.sku,
            category: l.category,
            unit: l.unit,
            purchasePriceCents: l.purchasePriceCents,
            expected: l.expected,
            counted: l.counted,
            broken: l.broken,
            image: l.article?.image ?? null,
          }))}
        />
      </div>
    </>
  );
}
