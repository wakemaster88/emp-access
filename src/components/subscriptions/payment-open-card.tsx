import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDay, formatMoney, paymentOpenTotal, type PaymentOpenRow } from "@/lib/payment-open";

/**
 * Abos, die der anny-Abgleich wegen einer überfälligen Abo-Rechnung pausiert
 * hat. Älteste Schuld zuerst; bezahlt wird in anny, danach endet die Pause.
 */
export function PaymentOpenCard({ rows }: { rows: PaymentOpenRow[] }) {
  const total = paymentOpenTotal(rows);
  return (
    <Card flush>
      <CardHeader>
        <CardTitle>Zahlung offen ({rows.length}){total ? ` · ${total}` : ""}</CardTitle>
        <CardDescription>
          Diese Abos sind pausiert, weil eine Rechnung in anny überfällig ist. Nach der Zahlung hebt der Abgleich die Pause selbst auf.
        </CardDescription>
      </CardHeader>
      <Table edge>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead className="max-sm:hidden">Abo</TableHead>
            <TableHead className="text-right max-sm:hidden">Fällig seit</TableHead>
            <TableHead className="text-right">Offen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-sm:whitespace-normal">
                <div className="font-medium">{r.person}</div>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground tabular-nums">
                  <span className="sm:hidden">{r.aboName ?? "Abo"} · seit {formatDay(r.dueDate) ?? "?"}</span>
                  {r.invoiceNumber && <span>{r.invoiceNumber}</span>}
                  {r.openCount != null && r.openCount > 1 && <Badge variant="neutral">{r.openCount} Rechnungen</Badge>}
                </div>
              </TableCell>
              <TableCell className="max-sm:hidden">{r.aboName ?? "–"}</TableCell>
              <TableCell className="text-right tabular-nums max-sm:hidden">
                {formatDay(r.dueDate) ?? "–"}
                {r.daysOverdue != null && (
                  <div className="text-xs text-muted-foreground">{r.daysOverdue} {r.daysOverdue === 1 ? "Tag" : "Tage"}</div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold text-destructive">
                {formatMoney(r.amount, r.currency) ?? "–"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
