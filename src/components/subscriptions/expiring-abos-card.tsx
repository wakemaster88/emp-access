import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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

/** Ende des Fensters von „Auslaufend (30T)“: heute 0 Uhr plus 30 Tage (wie in lib/subscription-stats). */
function next30Limit(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 30);
  return d;
}

/** Enddatum fällt in die nächsten 30 Tage (Tagesvergleich ab 0 Uhr). */
function endsWithin(end: Date, limit: Date): boolean {
  const d = new Date(end);
  d.setHours(0, 0, 0, 0);
  return d.getTime() <= limit.getTime();
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
  const soonLimit = next30Limit();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-warning shrink-0" />
          Nächste Abläufe
        </CardTitle>
        <CardDescription>
          Die 10 Abo-Tickets mit dem frühesten Enddatum (noch gültig).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            compact
            icon={CalendarClock}
            title="Keine Abo-Tickets mit gesetztem Enddatum in der Zukunft."
          />
        ) : (
          <ul className="glass-tile divide-y divide-border overflow-hidden">
            {rows.map((t) => {
              const endStr = t.endDate.toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              });
              const inner = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {personName(t)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.subscription.name}
                      {t.ticketTypeName ? ` · ${t.ticketTypeName}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right flex items-center gap-2">
                    <div>
                      <p className="text-label">Ende</p>
                      {/* Hinweisfarbe nur für Abläufe in den nächsten 30 Tagen, sonst trägt sie keine Information. */}
                      <p
                        className={cn(
                          "text-sm font-mono font-semibold tabular-nums",
                          endsWithin(t.endDate, soonLimit) ? "text-warning" : "text-foreground",
                        )}
                      >
                        {endStr}
                      </p>
                    </div>
                    {!readonly && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground/70 shrink-0" />
                    )}
                  </div>
                </>
              );

              const className = cn(
                "flex items-center justify-between gap-3 px-3 py-2.5 transition-colors",
                !readonly && "hover:bg-glass-tile",
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
                  <Link href={ticketsHref(t)} className={className}>
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
