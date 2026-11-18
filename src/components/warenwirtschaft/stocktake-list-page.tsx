import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateStocktakeButton } from "./stocktake-create";
import { formatEuro, stocktakeTotals } from "@/lib/warenwirtschaft";
import type { TenantDb } from "@/lib/prisma";
import { ChevronRight, Lock } from "lucide-react";
import { StocktakeEmpty } from "./stocktake-empty";

/**
 * Liste der Inventuren einer Art. Wird von „Inventur“ (laufend) und
 * „Stichtagsinventur“ geteilt; die Detailseite liegt jeweils darunter.
 */
export async function StocktakeListPage({
  kind,
  db,
  accountId,
  accountName,
}: {
  kind: "ROLLING" | "CUTOFF";
  db: TenantDb;
  accountId: number;
  accountName: string | null;
}) {
  const cutoff = kind === "CUTOFF";
  const basePath = cutoff ? "/warenwirtschaft/stichtag" : "/warenwirtschaft/inventur";
  const [stocktakes, categoryRows] = await Promise.all([
    db.stocktake.findMany({
      where: { accountId, kind },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: { lines: { select: { category: true, purchasePriceCents: true, expected: true, counted: true, broken: true } } },
      take: 200,
    }),
    db.article.findMany({ where: { accountId, active: true }, select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } }),
  ]);
  const categories = categoryRows.map((c) => c.category);
  const title = cutoff ? "Stichtagsinventur" : "Inventur";

  return (
    <>
      <Header title={title} accountName={accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        <Card flush>
          <CardHeader>
            <CardTitle>{cutoff ? "Stichtage" : "Zählungen"}&nbsp;({stocktakes.length})</CardTitle>
            <CardDescription>
              {cutoff
                ? "Bestand aller Artikel zu einem Stichtag (z. B. 31.12.) zählen, bewerten und festschreiben. Die Liste lässt sich als CSV für die Buchhaltung laden."
                : "Laufende Inventur: zwischendurch zählen, Abweichungen zum Soll sehen und den Bestand übernehmen."}
            </CardDescription>
            <CardAction>
              <CreateStocktakeButton kind={kind} categories={categories} basePath={basePath} />
            </CardAction>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <div className="border-t border-border">
              <Table edge>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inventur</TableHead>
                    <TableHead className="hidden w-28 text-right sm:table-cell">Gezählt</TableHead>
                    <TableHead className="w-32 text-right">Lagerwert</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stocktakes.length === 0 && (
                    <StocktakeEmpty cutoff={cutoff} colSpan={4} />
                  )}
                  {stocktakes.map((st) => {
                    const t = stocktakeTotals(st.lines);
                    return (
                      <TableRow key={st.id} className="relative cursor-pointer">
                        <TableCell className="max-w-0 w-full whitespace-normal">
                          <Link href={`${basePath}/${st.id}`} className="font-medium text-foreground after:absolute after:inset-0">
                            {st.title}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-xs tabular-nums text-muted-foreground">{st.date.toLocaleDateString("de-DE", { timeZone: "UTC" })}</span>
                            {st.status === "CLOSED" ? (
                              <Badge variant="neutral"><Lock className="h-3 w-3" />Festgeschrieben</Badge>
                            ) : (
                              <Badge variant="warning">Offen</Badge>
                            )}
                            <span className="text-xs tabular-nums text-muted-foreground sm:hidden">{t.counted}/{t.lines} gezählt</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{t.counted}/{t.lines}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatEuro(t.valueCents)}</TableCell>
                        <TableCell className="text-right text-muted-foreground"><ChevronRight className="ml-auto h-4 w-4" /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
