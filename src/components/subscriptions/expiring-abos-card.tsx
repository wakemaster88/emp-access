import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TicketStatus } from "@prisma/client";

/** Wie von Prisma `findMany` geliefert (nullable trotz where-Filter). */
export type ExpiringAboTicket = {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  endDate: Date | null;
  status: TicketStatus;
  ticketTypeName: string | null;
  subscription: { id: number; name: string } | null;
  barcode: string | null;
  qrCode: string | null;
  rfidCode: string | null;
};

function personName(t: ExpiringAboTicket) {
  return [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
}

function ticketsHref(t: ExpiringAboTicket) {
  const code = t.barcode || t.qrCode || t.rfidCode;
  if (code) return `/tickets?code=${encodeURIComponent(code)}`;
  if (t.subscription) return `/tickets?sub=${t.subscription.id}`;
  return "/tickets";
}

export function ExpiringAbosCard({
  tickets,
  readonly,
}: {
  tickets: ExpiringAboTicket[];
  readonly?: boolean;
}) {
  const rows = tickets.filter(
    (t): t is ExpiringAboTicket & { endDate: Date; subscription: { id: number; name: string } } =>
      t.endDate != null && t.subscription != null
  );

  return (
    <Card className="border-slate-200 dark:border-slate-800 mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div>
            <CardTitle className="text-base sm:text-lg">Nächste Abläufe</CardTitle>
            <CardDescription className="mt-1">
              Die 10 Abo-Tickets mit dem frühesten Enddatum (noch gültig).
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-2">
            Keine Abo-Tickets mit gesetztem Enddatum in der Zukunft.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
            {rows.map((t) => {
              const endStr = t.endDate.toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              });
              const inner = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {personName(t)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {t.subscription.name}
                      {t.ticketTypeName ? ` · ${t.ticketTypeName}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right flex items-center gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Ende</p>
                      <p className="text-sm font-mono font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                        {endStr}
                      </p>
                    </div>
                    {!readonly && (
                      <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                    )}
                  </div>
                </>
              );

              const className = cn(
                "flex items-center justify-between gap-3 px-3 py-2.5 transition-colors",
                !readonly && "hover:bg-slate-50 dark:hover:bg-slate-800/60",
              );

              if (readonly) {
                return (
                  <li key={t.id} className={className}>
                    {inner}
                  </li>
                );
              }

              return (
                <li key={t.id}>
                  <Link href={ticketsHref(t)} className={cn(className, "block")}>
                    {inner}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
