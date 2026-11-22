"use client";

/**
 * Kleine Bausteine des Check-in-Kiosks: Abschnitte, Uhr, Tageswahl, Eingaben.
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight, Loader2, CalendarDays, Printer, ClipboardList, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PackageSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { Segmented } from "@/components/ui/segmented";
import { exportCourseDayPdf } from "./checkin-print";
import type { CheckinTicket, GuestInfoSummary } from "./checkin-types";
import { aggregateRentalAddOns, formatSetup, isRentalAddOn, sortSummaryValues, toDateStr } from "./checkin-utils";

/*
 * Vollbild-Ebenen des Kiosks (Ticket, Scan, Serie, Schließfächer, Fundsachen,
 * Kalender) liegen im Baum unter dem `dark`-Rahmen statt in einem Radix-Portal
 * und sehen aus wie `DialogContent` (docs/design-regeln.md, Abschnitt 18):
 * Abdunklung dahinter, deckende Fläche mit Lichtkante, Radius 24 px, auf dem
 * Handy als Blatt von unten mit Griff.
 */
export const overlayScrimClass = "bg-background/70 backdrop-blur-sm";

/** Tage im Tagesstreifen: 44 px auf dem Handy, 56 px am Kiosk (Abschnitt 20). */
const daySegmentClass = "[&>button]:h-11 sm:[&>button]:h-14";
export const overlaySheetClass =
  "animate-slide-up border border-glass-border bg-popover text-popover-foreground shadow-[var(--float-shadow)] rounded-t-card sm:rounded-card";

/** Griff oben am Blatt – nur auf dem Handy, wie im Dialog-Baustein. */
export function OverlayGrip({ className }: { className?: string }) {
  return <div aria-hidden className={cn("mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-foreground/15 sm:hidden", className)} />;
}

export function Section({ title, icon: Icon, count, children }: { title: string; icon: React.ComponentType<{ className?: string }>; count: number; color: string; children: React.ReactNode }) {
  // Abschnittsüberschrift zwischen Karten (docs/design-regeln.md, Abschnitt 13):
  // gesperrte Kleinschrift ohne Dekorfarbe, Anzahl als Pille. `color` bleibt Teil
  // der Schnittstelle, trägt aber keine Bedeutung mehr.
  return (
    <div className="space-y-2">
      <SectionHeading
        title={title}
        icon={Icon as LucideIcon}
        aside={<Badge variant="secondary" className="tabular-nums">{count}</Badge>}
      />
      {children}
    </div>
  );
}


/** Verleihmaterial-Bedarf des Tages. Steht ganz oben im Shop-Monitor, damit
 *  das Personal Neoprenanzuege, Boards und Helme vorbereiten kann, ohne jede
 *  Ticketkarte einzeln durchzugehen. */
export function RentalOverviewPanel({ tickets }: { tickets: CheckinTicket[] }) {
  const totals = useMemo(() => aggregateRentalAddOns(tickets), [tickets]);
  if (totals.length === 0) return null;
  const bookings = new Set(
    tickets.filter((t) => Array.isArray(t.addOns) && t.addOns.some((a) => isRentalAddOn(a.name)))
      .map((t) => t.annyOrderId ?? `ticket:${t.id}`),
  ).size;
  // Verleihmaterial ist bewusst auffällig (Akzentfarbe), weil das Personal es
  // herausgeben muss – gleiche Tönung wie die Verleih-Chips auf den Ticketkarten.
  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <IconChip icon={PackageSearch} tone="primary" size="sm" />
          <div className="min-w-0">
            <CardTitle>Verleihmaterial heute</CardTitle>
            <CardDescription className="tabular-nums">
              {bookings} {bookings === 1 ? "Buchung" : "Buchungen"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {totals.map((t) => (
          <span
            key={t.name}
            className="rounded-full border border-primary/35 bg-primary/12 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-foreground"
          >
            {t.name} <span className="font-bold tabular-nums">×{t.quantity}</span>
          </span>
        ))}
      </CardContent>
    </Card>
  );
}

/** Aggregierte Equipment-Übersicht einer Kurs-Gruppe: kombinierte Board-
 *  Setups ("Wakeboard · Anfänger · Gr. 38 ×2"), Neopren-Größen der Leiher
 *  und restliche Infos – damit das Personal das Material fuer den Tag
 *  vorbereiten kann, ohne jede Karte einzeln durchzugehen. Inklusive
 *  PDF-Export als A4-Kursblatt. */
export function GuestInfoSummaryPanel({
  summary,
  groupName,
  dateStr,
  accountName,
}: {
  summary: GuestInfoSummary;
  groupName: string;
  dateStr: string;
  accountName: string;
}) {
  const [exporting, setExporting] = useState(false);
  const hasContent = summary.setups.length > 0 || summary.neopren.size > 0 || summary.labels.size > 0;
  if (!hasContent) return null;
  // Kachel in der Gruppenkarte (glass-tile); Gäste-Infos sind Information,
  // daher die Info-Tönung für Symbol und Werte.
  return (
    <div className="mb-2 glass-tile px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardList className="h-3.5 w-3.5 text-info shrink-0" />
        <span className="text-label">Tagesübersicht</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {summary.answered}/{summary.total} beantwortet
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exporting}
          onClick={async (e) => {
            e.stopPropagation();
            setExporting(true);
            try {
              void exportCourseDayPdf(groupName, dateStr, accountName, summary);
            } finally {
              setExporting(false);
            }
          }}
          className="ml-auto font-semibold"
        >
          {exporting ? <Loader2 className="animate-spin" /> : <Printer />}
          PDF
        </Button>
      </div>
      <div className="space-y-1.5">
        {summary.setups.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Material:</span>
            {summary.setups.map((s) => (
              <Badge
                key={`${s.sport}|${s.level}|${s.shoe}`}
                variant="info"
                className="font-medium"
              >
                {formatSetup(s)} <span className="font-bold tabular-nums">×{s.count}</span>
              </Badge>
            ))}
          </div>
        )}
        {summary.neopren.size > 0 && (
          <div className="flex flex-wrap items-baseline gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">Neopren:</span>
            {sortSummaryValues(summary.neopren).map(([size, count]) => (
              <Badge key={size} variant="info" className="font-medium">
                {size} <span className="font-bold tabular-nums">×{count}</span>
              </Badge>
            ))}
          </div>
        )}
        {[...summary.labels.entries()].map(([label, values]) => (
          <div key={label} className="flex flex-wrap items-baseline gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">{label}:</span>
            {sortSummaryValues(values).map(([value, count]) => (
              <Badge key={value} variant="info" className="font-medium">
                {value} <span className="font-bold tabular-nums">×{count}</span>
              </Badge>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}


export function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground w-16">{label}</span>
      <span className="text-sm text-foreground font-mono truncate">{value}</span>
    </div>
  );
}

/* ──── Add Ticket Overlay ──── */

export function RfidInput({ value, onChange, onSubmit, disabled }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (code: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);

    bufferRef.current = val;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const code = bufferRef.current.trim();
      if (code.length >= 4) {
        onSubmit(code);
      }
      bufferRef.current = "";
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (timerRef.current) clearTimeout(timerRef.current);
      bufferRef.current = "";
      const code = value.trim();
      if (code) onSubmit(code);
    }
  };

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <Input
      ref={inputRef}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      placeholder="RFID scannen oder eingeben"
      className="h-12 flex-1 px-4 sm:h-14"
      autoFocus
    />
  );
}

export function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-flex h-11 items-center rounded-control bg-glass-tile px-3 text-sm font-semibold tabular-nums text-foreground ring-1 ring-inset ring-glass-border">
      {time}
    </span>
  );
}

/**
 * Sichtbare Tage einer Tagesleiste. `centered`: der gewählte Tag steht immer in
 * der Mitte (Handy, drei Tage – die Nachbartage ersetzen dort die Pfeile).
 * Sonst bleibt das Fenster stehen, solange der gewählte Tag darin liegt, damit
 * die Pille zum neuen Tag gleiten kann; erst beim Verlassen rückt es nach.
 */
function useDayWindow(date: string, count: number, centered: boolean): string[] {
  const half = Math.floor(count / 2);
  const [start, setStart] = useState(() => shiftDay(date, -half));
  let first = start;
  if (centered) {
    first = shiftDay(date, -half);
  } else if (date < start || date > shiftDay(start, count - 1)) {
    // Gewählter Tag liegt außerhalb: einen Tag weiter rücken, wenn er direkt
    // daneben liegt (Pfeiltaste), sonst neu um ihn zentrieren (Kalender).
    first =
      date === shiftDay(start, -1)
        ? date
        : date === shiftDay(start, count)
          ? shiftDay(date, -(count - 1))
          : shiftDay(date, -half);
    setStart(first);
  }
  return useMemo(() => Array.from({ length: count }, (_, i) => shiftDay(first, i)), [first, count]);
}

function shiftDay(ymd: string, delta: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return toDateStr(d);
}

/** Zweizeilige Beschriftung: Wochentag (heute: „Heute“) über dem Datum. */
function DayLabel({ ymd, isToday }: { ymd: string; isToday: boolean }) {
  const d = new Date(ymd + "T12:00:00");
  const weekday = d.toLocaleDateString("de-DE", { weekday: "short" });
  const dayMonth = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return (
    <span className="flex flex-col items-center leading-tight">
      <span className={cn("text-[11px]", isToday ? "font-semibold text-foreground" : "font-medium")}>
        {isToday ? "Heute" : weekday}
      </span>
      <span className="tabular-nums">{dayMonth}</span>
    </span>
  );
}

function DayStrip({
  date,
  onChange,
  today,
  count,
  centered = false,
  className,
}: {
  date: string;
  onChange: (d: string) => void;
  today: string;
  count: number;
  centered?: boolean;
  className?: string;
}) {
  const days = useDayWindow(date, count, centered);
  return (
    <Segmented
      aria-label="Tag"
      value={date}
      onValueChange={onChange}
      glide
      stretch={centered}
      options={days.map((ymd) => ({
        value: ymd,
        label: <DayLabel ymd={ymd} isToday={ymd === today} />,
        // Heute ist auch ungewählt sichtbar: flache Akzent-Tönung mit Rand, wie im Kalender.
        className:
          ymd === today && ymd !== date
            ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/50"
            : undefined,
      }))}
      className={cn(daySegmentClass, className)}
    />
  );
}

export function DaySelector({
  date,
  onChange,
  start,
  end,
}: {
  date: string;
  onChange: (d: string) => void;
  /** Links neben den Tagen (ab lg), darunter auf schmalen Bildschirmen: ANNY-Sync. */
  start?: React.ReactNode;
  /** Rechts neben den Tagen, vor dem Kalender: Öffnungszeit des Tages. */
  end?: React.ReactNode;
}) {
  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(date);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const todayStrGlobal = toDateStr(new Date());

  const calDays = useMemo(() => {
    const { year, month } = calMonth;
    const first = new Date(year, month, 1);
    const startDay = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rows: (Date | null)[][] = [];
    let row: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) row.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      row.push(new Date(year, month, d));
      if (row.length === 7) { rows.push(row); row = []; }
    }
    if (row.length > 0) {
      while (row.length < 7) row.push(null);
      rows.push(row);
    }
    return rows;
  }, [calMonth]);

  const selectedDate = new Date(date);
  const monthLabel = new Date(calMonth.year, calMonth.month).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  return (
    <>
      {/* Eine Zeile ab lg: Sync links, Tage mit Pfeilen in der Mitte, Öffnungszeit
          und Kalender rechts. Schmaler stehen Sync, Öffnungszeit und Kalender in
          einer zweiten Zeile unter den Tagen. Bis md drei Tage (der gewählte in der
          Mitte), bis xl fünf (sonst fehlt bei 1024 px der Platz für Sync und
          Öffnungszeit), ab xl sieben. Tasten und Tage sind 44 px, am Kiosk
          ab sm 56 px hoch (docs/design-regeln.md, Abschnitt 20). */}
      <div className="px-4 sm:px-6 pt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="col-span-2 flex min-w-0 items-center justify-center gap-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => onChange(shiftDay(date, -1))}
            className="hidden text-muted-foreground sm:inline-flex sm:size-14"
            aria-label="Vorheriger Tag"
          >
            <ChevronLeft />
          </Button>
          <div className="flex min-w-0 flex-1 justify-center lg:flex-none">
            <DayStrip date={date} onChange={onChange} today={todayStrGlobal} count={3} centered className="md:hidden" />
            <DayStrip date={date} onChange={onChange} today={todayStrGlobal} count={5} className="hidden md:inline-flex xl:hidden" />
            <DayStrip date={date} onChange={onChange} today={todayStrGlobal} count={7} className="hidden xl:inline-flex" />
          </div>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => onChange(shiftDay(date, 1))}
            className="hidden text-muted-foreground sm:inline-flex sm:size-14"
            aria-label="Nächster Tag"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex min-w-0 items-center lg:col-start-1 lg:row-start-1">{start}</div>
        <div className="flex min-w-0 items-center justify-end gap-2 lg:col-start-3 lg:row-start-1">
          {end}
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={() => { setCalMonth({ year: selectedDate.getFullYear(), month: selectedDate.getMonth() }); setCalOpen(true); }}
            className="size-11 shrink-0 text-muted-foreground sm:size-14"
            aria-label="Kalender öffnen"
          >
            <CalendarDays />
          </Button>
        </div>
      </div>

      {calOpen && (
        <div className={cn("fixed inset-0 z-50 flex items-end sm:items-center justify-center", overlayScrimClass)} onClick={() => setCalOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className={cn(overlaySheetClass, "p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] w-full sm:w-[456px]")}>
            <OverlayGrip className="-mt-2 mb-3" />
            <div className="flex items-center justify-between mb-4">
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={() => setCalMonth((p) => { const m = p.month - 1; return m < 0 ? { year: p.year - 1, month: 11 } : { ...p, month: m }; })}
                className="size-11 text-muted-foreground sm:size-14"
                aria-label="Vorheriger Monat"
              >
                <ChevronLeft className="size-5" />
              </Button>
              <span className="text-sm font-semibold text-foreground capitalize">{monthLabel}</span>
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={() => setCalMonth((p) => { const m = p.month + 1; return m > 11 ? { year: p.year + 1, month: 0 } : { ...p, month: m }; })}
                className="size-11 text-muted-foreground sm:size-14"
                aria-label="Nächster Monat"
              >
                <ChevronRight className="size-5" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((wd) => (
                <div key={wd} className="text-center text-[11px] font-semibold text-muted-foreground py-1">{wd}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calDays.flat().map((d, i) => {
                if (!d) return <div key={`e${i}`} />;
                const ds = toDateStr(d);
                const isSelected = ds === date;
                const isToday = ds === todayStrGlobal;
                return (
                  <button
                    key={ds}
                    onClick={() => { onChange(ds); setCalOpen(false); }}
                    className={cn(
                      "press h-11 w-full rounded-xl text-sm font-semibold tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-14",
                      isSelected
                        ? "bg-primary-fill text-primary-foreground"
                        : isToday
                        ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/50"
                        : "text-foreground hover:bg-glass-tile"
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            {/* Tasten in Touch-Größe (44 px, am Kiosk ab sm 56 px) statt der kleinen Stufe. */}
            <div className="mt-3 flex justify-between">
              <Button
                variant="secondary"
                onClick={() => { onChange(todayStrGlobal); setCalOpen(false); }}
                className="h-11 px-4 sm:h-14"
              >
                Heute
              </Button>
              <Button
                variant="ghost"
                onClick={() => setCalOpen(false)}
                className="h-11 px-4 text-muted-foreground sm:h-14"
              >
                Schließen
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function StatPill({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color?: string }) {
  // Farbe nur als Token: Erfolg, Hinweis, Violett der Kennzahlen, Akzent.
  const colors: Record<string, string> = {
    emerald: "text-success",
    amber: "text-warning",
    violet: "text-chart-5",
    indigo: "text-primary",
  };
  return (
    <div className="flex items-center gap-2 glass-tile px-3 py-1.5">
      <Icon className={cn("h-4 w-4", colors[color ?? "indigo"] ?? "text-muted-foreground")} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-bold tabular-nums", colors[color ?? "indigo"] ?? "text-foreground")}>{value}</span>
    </div>
  );
}

