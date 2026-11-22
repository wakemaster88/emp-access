"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { ScheduleRow } from "@/components/betriebszeiten/types";
import { describeSeasonRange, openingForDay, seasonForDay, type DayOpening, type ScheduleSpec } from "@/lib/operating-hours";
import {
  addMonthsToYmd,
  compactHours,
  daySegments,
  firstOfMonth,
  groupByHours,
  hourRange,
  membersLabel,
  mondayOf,
  monthGrid,
  monthTitle,
  shortDayLabel,
  weekDays,
  weekTitle,
  type DaySegment,
} from "@/lib/operating-calendar";
import { addDaysToYmd, tzYmd } from "@/lib/tz-time";
import { cn } from "@/lib/utils";
import { scheduleTree } from "@/components/betriebszeiten/series";

type View = "monat" | "woche";

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

interface Area {
  id: number;
  name: string;
  color: string;
  /** Unterprofil eines Bereichs (anfangs ausgeblendet). */
  sub?: boolean;
  spec: ScheduleSpec;
}

function fullDay(day: DayOpening): string {
  if (day.closed || day.windows.length === 0) return "geschlossen";
  return day.windows
    .map((w) => (w.opensAt === w.closesAt ? "durchgehend" : `${w.opensAt}–${w.closesAt}`))
    .join(" · ");
}

function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", color, className)} />;
}

/** Monatsraster: je Tag ein Balken je Bereich (Handy) bzw. gleiche Zeiten mit Bereichsnamen (ab sm). */
function MonthView({
  anchor,
  areas,
  todayYmd,
  selected,
  onSelect,
}: {
  anchor: string;
  areas: Area[];
  todayYmd: string;
  selected: string;
  onSelect: (ymd: string) => void;
}) {
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const month = anchor.slice(0, 7);
  const areaNames = useMemo(() => areas.map((a) => a.name), [areas]);

  return (
    <div aria-label={monthTitle(anchor)} className="grid grid-cols-7 gap-1 sm:gap-1.5">
      {WEEKDAY_SHORT.map((d) => (
        <div key={d} aria-hidden className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
          {d}
        </div>
      ))}
      {grid.flat().map((ymd) => {
        const inMonth = ymd.slice(0, 7) === month;
        const isToday = ymd === todayYmd;
        const isSelected = ymd === selected;
        const days = areas.map((a) => ({ area: a, day: openingForDay(a.spec, ymd) }));
        const hasException = days.some((d) => d.day.source === "exception");
        const openCount = days.filter((d) => !d.day.closed).length;
        return (
          <button
            key={ymd}
            type="button"
            aria-pressed={isSelected}
            aria-label={`${shortDayLabel(ymd)}: ${openCount} von ${areas.length} geöffnet${hasException ? ", Ausnahmetag" : ""}`}
            onClick={() => onSelect(ymd)}
            className={cn(
              "flex min-h-14 min-w-0 flex-col gap-1 rounded-lg border p-1 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-16 sm:p-1.5",
              inMonth ? "bg-glass-tile border-glass-tile-border" : "border-transparent opacity-50",
              isSelected && "border-primary ring-1 ring-primary/40",
              "hover:bg-glass-strong",
            )}
          >
            <span className="flex items-center justify-between gap-0.5">
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
                  isToday && "bg-primary-fill text-primary-foreground",
                )}
              >
                {Number(ymd.slice(8, 10))}
              </span>
              {hasException && <Dot color="bg-warning" className="size-1.5" />}
            </span>
            {/* Handy: nur Balken, die Zeiten stehen in der Tagesansicht darunter. */}
            <span className="flex flex-col gap-0.5 sm:hidden">
              {days.map(({ area, day }) => (
                <span
                  key={area.id}
                  className={cn("h-1 rounded-full", day.closed ? "bg-transparent" : area.color)}
                />
              ))}
            </span>
            {/* Ab sm: gleiche Zeiten in einer Zeile mit den Bereichsnamen („12–16 Wasserski, Shop“).
                Geschlossene Bereiche stehen nicht da; ein geschlossener Ausnahmetag sagt „zu“. */}
            <span className="hidden min-w-0 flex-col gap-1 sm:flex">
              {groupByHours(days.map(({ area, day }) => ({ item: area, day }))).map((g) => (
                <span
                  key={`${g.hours}-${g.exception}`}
                  className="line-clamp-2 min-w-0 text-[11px] leading-snug"
                  title={`${g.hours}: ${g.members.map((a) => a.name).join(", ")}`}
                >
                  <span className={cn("font-semibold tabular-nums", g.exception && "text-warning")}>{g.hours}</span>{" "}
                  <span className="text-muted-foreground">
                    {membersLabel(
                      g.members.map((a) => a.name),
                      areaNames,
                    )}
                  </span>
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Ein Bereich an einem Tag: Name, Zeitleiste, Uhrzeit. */
function TimelineRow({
  area,
  ymd,
  range,
}: {
  area: Area;
  ymd: string;
  range: { from: number; to: number };
}) {
  const day = openingForDay(area.spec, ymd);
  const segments = daySegments(area.spec, ymd);
  const spanMin = (range.to - range.from) * 60;
  const pos = (m: number) => Math.min(100, Math.max(0, ((m - range.from * 60) / spanMin) * 100));
  return (
    <div className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_3.75rem] items-center gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_7.5rem]">
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <Dot color={area.color} />
        <span className="truncate">{area.name}</span>
      </span>
      <span className="relative h-3 rounded-full bg-foreground/[0.06] dark:bg-white/[0.08]">
        {segments.map((s: DaySegment, i) => (
          <span
            key={i}
            className={cn("absolute inset-y-0 rounded-full", area.color, day.source === "exception" && "ring-2 ring-warning")}
            style={{ left: `${pos(s.start)}%`, width: `${Math.max(1, pos(s.end) - pos(s.start))}%` }}
          />
        ))}
      </span>
      <span
        className={cn(
          "truncate text-right text-[11px] tabular-nums",
          day.closed ? "text-muted-foreground" : "text-foreground",
          day.source === "exception" && "text-warning",
        )}
        title={fullDay(day)}
      >
        <span className="sm:hidden">{compactHours(day)}</span>
        <span className="hidden sm:inline">{fullDay(day)}</span>
      </span>
    </div>
  );
}

function HourScale({ range }: { range: { from: number; to: number } }) {
  const span = range.to - range.from;
  const step = span <= 8 ? 2 : span <= 14 ? 3 : 6;
  const ticks: number[] = [];
  for (let h = Math.ceil(range.from / step) * step; h <= range.to; h += step) ticks.push(h);
  return (
    <div
      aria-hidden
      className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_3.75rem] gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_7.5rem]"
    >
      <span />
      <span className="relative h-4 text-[10px] text-muted-foreground tabular-nums">
        {ticks.map((h) => (
          <span
            key={h}
            className="absolute -translate-x-1/2"
            style={{ left: `${((h - range.from) / span) * 100}%` }}
          >
            {h}
          </span>
        ))}
      </span>
      <span />
    </div>
  );
}

/** Woche als Zeitleiste: je Tag ein Block, je Bereich eine Zeile mit Balken. */
function WeekView({ anchor, areas, todayYmd }: { anchor: string; areas: Area[]; todayYmd: string }) {
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const range = useMemo(
    () => hourRange(days.flatMap((d) => areas.flatMap((a) => daySegments(a.spec, d)))),
    [days, areas],
  );
  return (
    <div className="space-y-3">
      <HourScale range={range} />
      {days.map((ymd) => {
        const notes = areas
          .map((a) => ({ area: a, day: openingForDay(a.spec, ymd) }))
          .filter((d) => d.day.source === "exception");
        return (
          <section key={ymd} aria-label={shortDayLabel(ymd)} className="space-y-1.5 border-t pt-2 first:border-t-0 first:pt-0">
            <h4 className={cn("text-xs font-semibold", ymd === todayYmd && "text-primary")}>
              {shortDayLabel(ymd)}
              {ymd === todayYmd && <span className="ml-1.5 font-normal">heute</span>}
            </h4>
            {areas
              .filter((a) => {
                const day = openingForDay(a.spec, ymd);
                return !day.closed || day.source === "exception" || daySegments(a.spec, ymd).length > 0;
              })
              .map((a) => (
                <TimelineRow key={a.id} area={a} ymd={ymd} range={range} />
              ))}
            <ClosedLine
              areas={areas.filter((a) => {
                const day = openingForDay(a.spec, ymd);
                return day.closed && day.source !== "exception" && daySegments(a.spec, ymd).length === 0;
              })}
              all={areas.length}
            />
            {notes.map(({ area, day }) => (
              <p key={area.id} className="text-[11px] text-warning">
                Ausnahme {area.name}
                {day.label ? `: ${day.label}` : ""}
              </p>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Geschlossene Bereiche in einer Zeile statt je eine Zeile „geschlossen“. */
function ClosedLine({ areas, all }: { areas: Area[]; all: number }) {
  if (areas.length === 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {areas.length === all ? "Alle Bereiche geschlossen" : `Geschlossen: ${areas.map((a) => a.name).join(", ")}`}
    </p>
  );
}

/** Alle Bereiche an einem gewählten Tag: offene mit Zeit und Saison, geschlossene in einer Zeile. */
function DayDetail({ ymd, areas }: { ymd: string; areas: Area[] }) {
  const rows = areas.map((a) => ({ area: a, day: openingForDay(a.spec, ymd), season: seasonForDay(a.spec, ymd) }));
  const shown = rows.filter((r) => !r.day.closed || r.day.source === "exception");
  const closed = rows.filter((r) => r.day.closed && r.day.source !== "exception").map((r) => r.area);
  return (
    <div className="space-y-2 rounded-xl border bg-glass-tile p-3">
      <h4 className="text-sm font-semibold">{shortDayLabel(ymd)}</h4>
      {shown.length > 0 && (
        <ul className="space-y-1.5">
          {shown.map(({ area: a, day, season }) => (
            <li key={a.id} className="flex min-w-0 items-start gap-2 text-xs">
              <Dot color={a.color} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium">{a.name}</span>
                  <span className={cn("tabular-nums", day.closed && "text-muted-foreground")}>{fullDay(day)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {day.source === "exception" ? (
                    <span className="text-warning">Ausnahmetag{day.label ? `: ${day.label}` : ""}</span>
                  ) : season ? (
                    `${season.name} (${describeSeasonRange(season.startMmDd, season.endMmDd)})`
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ClosedLine areas={closed} all={areas.length} />
    </div>
  );
}

export function OperatingCalendar({
  schedules,
  timezone,
  nowMs,
}: {
  schedules: ScheduleRow[];
  timezone: string;
  nowMs: number;
}) {
  const todayYmd = tzYmd(new Date(nowMs), timezone);
  const [view, setView] = useState<View>("monat");
  const [anchor, setAnchor] = useState(todayYmd);
  const [selected, setSelected] = useState(todayYmd);
  // Unterprofile (Bahnmieten, Kurse) erst auf Wunsch, sonst wird der Kalender unübersichtlich.
  const [hidden, setHidden] = useState<Set<number>>(
    () => new Set(scheduleTree(schedules).filter((e) => e.sub).map((e) => e.item.id)),
  );

  const allAreas = useMemo<Area[]>(
    () =>
      scheduleTree(schedules).map(({ item: s, color, sub }) => ({
        id: s.id,
        name: s.name,
        color,
        sub,
        spec: { name: s.name, seasons: s.seasons, exceptions: s.exceptions },
      })),
    [schedules],
  );
  const areas = useMemo(() => allAreas.filter((a) => !hidden.has(a.id)), [allAreas, hidden]);

  function move(dir: 1 | -1) {
    if (view === "monat") {
      const next = addMonthsToYmd(anchor, dir);
      setAnchor(next);
      // Auswahl folgt in den neuen Monat; im aktuellen Monat auf heute.
      setSelected(firstOfMonth(todayYmd) === next ? todayYmd : next);
    } else {
      setAnchor(addDaysToYmd(anchor, dir * 7));
    }
  }

  function toggle(id: number) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const title = view === "monat" ? monthTitle(anchor) : weekTitle(anchor);
  const showsToday =
    view === "monat" ? firstOfMonth(anchor) === firstOfMonth(todayYmd) : mondayOf(anchor) === mondayOf(todayYmd);

  function goToday() {
    setAnchor(todayYmd);
    setSelected(todayYmd);
  }

  function changeView(next: View) {
    setView(next);
    // Die Woche zeigt den gewählten Tag, der Monat den Monat der gezeigten Woche.
    if (next === "woche") setAnchor(selected);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>Kalender</h3>
        </CardTitle>
        <CardDescription className="text-xs">
          Öffnungszeiten aller Bereiche aus Saisons und Ausnahmetagen. Ausnahmen sind gelb markiert.
        </CardDescription>
        <CardAction>
          <Segmented
            aria-label="Ansicht"
            size="sm"
            value={view}
            onValueChange={changeView}
            options={[
              { value: "monat", label: "Monat" },
              { value: "woche", label: "Woche" },
            ]}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="max-sm:size-11" onClick={() => move(-1)} title="Zurück">
            <ChevronLeft />
            <span className="sr-only">Zurück</span>
          </Button>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center">
            <p className="text-sm font-semibold tabular-nums" aria-live="polite">
              {title}
            </p>
            {!showsToday && (
              <Button variant="link" size="xs" className="h-auto p-0 text-xs max-sm:min-h-6" onClick={goToday}>
                zurück zu heute
              </Button>
            )}
          </div>
          <Button variant="ghost" size="icon" className="max-sm:size-11" onClick={() => move(1)} title="Weiter">
            <ChevronRight />
            <span className="sr-only">Weiter</span>
          </Button>
        </div>

        {allAreas.length > 1 && (
          <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Bereiche zeigen">
            {allAreas.map((a) => (
              <ToggleChip key={a.id} size="sm" pressed={!hidden.has(a.id)} onPressedChange={() => toggle(a.id)}>
                <Dot color={a.color} />
                {a.name}
              </ToggleChip>
            ))}
          </div>
        )}

        {areas.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Kein Bereich ausgewählt.</p>
        ) : view === "monat" ? (
          <div className="space-y-3">
            <MonthView anchor={anchor} areas={areas} todayYmd={todayYmd} selected={selected} onSelect={setSelected} />
            <DayDetail ymd={selected} areas={areas} />
          </div>
        ) : (
          <WeekView anchor={anchor} areas={areas} todayYmd={todayYmd} />
        )}
      </CardContent>
    </Card>
  );
}
