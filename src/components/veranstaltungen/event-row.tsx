import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_KIND_SHORT,
  formatEuro,
  formatEventDay,
  formatEventTime,
  STATUS_LABEL,
  type VenueDocumentKind,
  type VenueEventStatus,
} from "@/lib/venue-event-rules";

export interface EventRowData {
  id: number;
  title: string;
  hostName: string | null;
  areaName: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount: number;
  actualGuests: number | null;
  status: VenueEventStatus;
  billed: boolean;
  past: boolean;
  extrasTotalCents: number;
  documents: { kind: VenueDocumentKind }[];
  partnerName?: string | null;
}

const STATUS_VARIANT: Record<VenueEventStatus, "warning" | "success" | "neutral"> = {
  RESERVED: "warning",
  CONFIRMED: "success",
  CANCELED: "neutral",
};

/** Monatsueberschrift "November 2026" aus YYYY-MM-DD. */
export function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Gruppiert sortierte Termine nach Monat. */
export function groupByMonth<T extends { date: string }>(rows: T[]): Array<{ month: string; rows: T[] }> {
  const out: Array<{ month: string; rows: T[] }> = [];
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.month === month) last.rows.push(r);
    else out.push({ month, rows: [r] });
  }
  return out;
}

/**
 * Eine Zeile der Terminliste: Tag als Kachel, Titel, Raum und Zeit, darunter
 * Personen, Zusatzleistungen und welche Dokumente schon da sind.
 */
export function EventRow({ event, showArea, onOpen }: { event: EventRowData; showArea: boolean; onOpen: () => void }) {
  const [, m, d] = event.date.split("-");
  const docKinds = [...new Set(event.documents.map((x) => x.kind))];
  const guests = event.actualGuests != null ? `${event.actualGuests} Pers. (geplant ${event.guestCount})` : `${event.guestCount} Pers.`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "press glass-tile flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left outline-none hover:ring-1 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring/50",
        event.status === "CANCELED" && "opacity-70",
      )}
    >
      <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-control bg-foreground/[0.05] dark:bg-white/[0.06]">
        <span className="text-[11px] text-muted-foreground">{formatEventDay(event.date).slice(0, 2)}</span>
        <span className="text-base leading-5 font-semibold tabular-nums">{d}.{m}.</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium", event.status === "CANCELED" && "line-through")}>{event.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {formatEventTime(event.startTime, event.endTime)}
          {showArea ? ` · ${event.areaName}` : ""}
          {event.partnerName ? ` · ${event.partnerName}` : event.partnerName === null ? " · eigener Termin" : ""}
          {event.hostName ? ` · ${event.hostName}` : ""}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground tabular-nums">
            {guests}
            {event.extrasTotalCents > 0 ? ` · Extras ${formatEuro(event.extrasTotalCents)}` : ""}
          </span>
          <Badge variant={STATUS_VARIANT[event.status]} className="sm:hidden">{STATUS_LABEL[event.status]}</Badge>
          {event.billed && <Badge variant="info" className="sm:hidden">Abgerechnet</Badge>}
          {docKinds.map((k) => <Badge key={k} variant="secondary">{DOCUMENT_KIND_SHORT[k]}</Badge>)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 max-sm:hidden">
        <Badge variant={STATUS_VARIANT[event.status]}>{STATUS_LABEL[event.status]}</Badge>
        {event.billed && <Badge variant="info">Abgerechnet</Badge>}
      </span>
    </button>
  );
}
