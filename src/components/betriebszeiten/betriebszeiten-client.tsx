"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarOff, DoorClosed, DoorOpen, LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/components/raeume/shared";
import { useNow } from "@/components/raeume/status";
import { ScheduleDialog } from "@/components/betriebszeiten/schedule-dialog";
import { OperatingCalendar } from "@/components/betriebszeiten/operating-calendar";
import type { BetriebszeitenData, ScheduleRow } from "@/components/betriebszeiten/types";
import {
  describeSeasonRange,
  isOperatingAt,
  openingForDay,
  operatingSpanState,
  seasonForDay,
  type ScheduleSpec,
  type SeasonSpec,
} from "@/lib/operating-hours";
import { compactHours, daySegments, hourRange, planSegments, shortDayLabel, weekWindows, yearMarks } from "@/lib/operating-calendar";
import { addDaysToYmd, formatHhmm, tzMinutesOfDay, tzYmd, weekdayBitOfYmd } from "@/lib/tz-time";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import { DayStrip, MonthAxis, OPEN_FILL_SOFT, WeekColumns, type WeekColumn } from "@/components/betriebszeiten/charts";
import { scheduleTree } from "@/components/betriebszeiten/series";
import { SyncStatus } from "@/components/betriebszeiten/sync-status";
import { FacilityUsage } from "@/components/betriebszeiten/facility-usage";

function toSpec(row: ScheduleRow): ScheduleSpec {
  return { name: row.name, seasons: row.seasons, exceptions: row.exceptions };
}

/** So weit voraus sucht die Karte die nächste Öffnung (Winterpause, Ferienkurs erst im Sommer). */
const LOOKAHEAD_DAYS = 370;

/** "in 25 Min." bzw. "in 3 Std." – nur für Wechsel in den nächsten 24 Stunden. */
function untilLabel(target: Date, nowMs: number): string | null {
  const minutes = Math.round((target.getTime() - nowMs) / 60_000);
  if (minutes <= 0) return "jetzt";
  if (minutes < 60) return `in ${minutes} Min.`;
  if (minutes >= 24 * 60) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours} Std.` : `in ${hours} Std. ${rest} Min.`;
}

/** "heute 16:00", "morgen 12:00" oder "Sa, 13.03. 12:00". */
function whenLabel(at: Date, todayYmd: string, timezone: string): string {
  const ymd = tzYmd(at, timezone);
  const time = formatHhmm(tzMinutesOfDay(at, timezone));
  if (ymd === todayYmd) return `heute ${time}`;
  if (ymd === addDaysToYmd(todayYmd, 1)) return `morgen ${time}`;
  return `${shortDayLabel(ymd)} ${time}`;
}

/** Saison von heute, sonst die nächste mit ihrem ersten Tag. */
function currentOrNextSeason(spec: ScheduleSpec, todayYmd: string): { season: SeasonSpec; startsOn: string | null } | null {
  const today = seasonForDay(spec, todayYmd);
  if (today) return { season: today, startsOn: null };
  for (let i = 1; i <= 366; i += 1) {
    const ymd = addDaysToYmd(todayYmd, i);
    const season = seasonForDay(spec, ymd);
    if (season) return { season, startsOn: ymd };
  }
  return null;
}

/** "in 2 Std. 50 Min." bzw. "in 160 Tagen" bis zu einem Zeitpunkt. */
function distanceLabel(target: Date, nowMs: number, todayYmd: string, timezone: string): string | null {
  const soon = untilLabel(target, nowMs);
  if (soon) return soon;
  const days = daysBetweenYmd(todayYmd, tzYmd(target, timezone));
  return days <= 1 ? null : `in ${days} Tagen`;
}

function daysBetweenYmd(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const YEAR_DAYS = 365;

function ScheduleCard({
  schedule,
  color,
  childCount,
  timezone,
  nowMs,
  range,
  readonly,
  onEdit,
  onDelete,
}: {
  schedule: ScheduleRow;
  /** Farbe wie im Kalender (Unterprofile aufgehellt). */
  color: string;
  /** Anzahl Unterprofile (nur bei Bereichen). */
  childCount: number;
  timezone: string;
  nowMs: number;
  range: { from: number; to: number };
  readonly: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const spec = toSpec(schedule);
  const now = new Date(nowMs);
  const todayYmd = tzYmd(now, timezone);
  const today = openingForDay(spec, todayYmd);
  const open = isOperatingAt(spec, now, timezone);
  const state = operatingSpanState(spec, now, timezone, undefined, LOOKAHEAD_DAYS);
  const season = currentOrNextSeason(spec, todayYmd);
  const futureExceptions = schedule.exceptions
    .filter((e) => e.date > todayYmd)
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextException = futureExceptions[0];
  const marks = yearMarks(spec, todayYmd, YEAR_DAYS);
  const openDaysCount = marks.replaceAll("c", "").length;

  // Woche: Plan der laufenden (oder nächsten) Saison; heute mit den echten Zeiten des Tags.
  const isCurrentSeason = season != null && season.startsOn == null;
  const todayIndex = weekdayBitOfYmd(todayYmd);
  const columns: WeekColumn[] = season
    ? weekWindows(season.season.periods).map((windows, d) =>
        isCurrentSeason && d === todayIndex
          ? { windows: daySegments(spec, todayYmd), today: true, exception: today.source === "exception" && !today.closed }
          : { windows },
      )
    : [];

  let headline: string;
  let sub: string | null = null;
  if (state.inside && state.until) {
    const when = whenLabel(state.until, todayYmd, timezone);
    headline = when.startsWith("heute ") ? `Schließt um ${when.slice(6)}` : `Schließt ${when}`;
    const left = untilLabel(state.until, nowMs);
    sub = left ? left.replace(/^in /, "noch ") : null;
  } else if (state.inside) {
    headline = "Durchgehend geöffnet";
  } else if (state.until) {
    headline = `Öffnet ${whenLabel(state.until, todayYmd, timezone)}`;
    sub = distanceLabel(state.until, nowMs, todayYmd, timezone);
  } else {
    headline = `Keine Öffnung in den nächsten ${LOOKAHEAD_DAYS} Tagen`;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* Farbe wie im Kalender: der Bereich als Datenreihe. */}
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", color)} />
          <CardTitle className="min-w-0">
            <h3 className="truncate">{schedule.name}</h3>
          </CardTitle>
          {schedule.isDefault && <Badge variant="secondary">Vorbelegung</Badge>}
          {/* Zustand als Farbe: geöffnet grün, geschlossen grau (docs/design-regeln.md, Abschnitt 3). */}
          <Badge variant={open ? "success" : "neutral"}>
            {open ? <DoorOpen /> : <DoorClosed />}
            {open ? "geöffnet" : "geschlossen"}
          </Badge>
        </div>
        {/* Zwei Zeilen statt hart abschneiden: neben den Tasten ist auf dem Handy nur eine schmale Spalte frei. */}
        {schedule.description && (
          <CardDescription className="line-clamp-2 text-xs">{schedule.description}</CardDescription>
        )}

        {!readonly && (
          <CardAction className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground max-sm:size-11"
              onClick={onEdit}
              title="Bearbeiten"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive max-sm:size-11"
              onClick={onDelete}
              title="Löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </CardAction>
        )}
      </CardHeader>

      {/* Inhalt füllt die Karte, damit der Fuß in einer Rasterzeile bei allen Karten unten steht. */}
      <CardContent className="flex-1 space-y-4">
        <div className="min-w-0">
          <p className="text-sm font-medium tabular-nums">{headline}</p>
          {sub && <p className="text-xs text-muted-foreground tabular-nums">{sub}</p>}
          {today.source === "exception" && (
            <p className="text-xs text-warning">
              Heute Ausnahme{today.label ? `: ${today.label}` : ""}
              {today.closed ? " (geschlossen)" : ""}
            </p>
          )}
          {(schedule.facilities.length > 0 || schedule.annyResourceId) && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {schedule.facilities.length > 0 &&
                `${schedule.facilities.length === 1 ? "Anlage" : "Anlagen"}: ${schedule.facilities.join(", ")}`}
              {schedule.facilities.length > 0 && schedule.annyResourceId && " · "}
              {schedule.annyResourceId && `anny ${schedule.annyResourceId}`}
            </p>
          )}
        </div>

        {season ? (
          <section className="min-w-0 space-y-2" aria-label="Wochenplan">
            <div className="flex min-w-0 items-baseline justify-between gap-2">
              <span className="shrink-0 text-label text-muted-foreground">
                {season.startsOn ? `Woche ab ${shortDayLabel(season.startsOn)}` : "Woche"}
              </span>
              <span className="min-w-0 truncate text-[11px] text-muted-foreground tabular-nums">
                {season.startsOn
                  ? season.season.name
                  : `${season.season.name} · ${describeSeasonRange(season.season.startMmDd, season.season.endMmDd)}`}
              </span>
            </div>
            <WeekColumns
              columns={columns}
              range={range}
              nowMinutes={isCurrentSeason ? tzMinutesOfDay(now, timezone) : null}
              openNow={open}
            />
          </section>
        ) : (
          <p className="text-xs text-muted-foreground">Keine Saison hinterlegt – gilt als geschlossen.</p>
        )}

        <section className="min-w-0 space-y-1" aria-label="Die nächsten 12 Monate">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="shrink-0 text-label text-muted-foreground">12 Monate</span>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground tabular-nums">
              {openDaysCount} {openDaysCount === 1 ? "Tag" : "Tage"} geöffnet
            </span>
          </div>
          <DayStrip
            marks={marks}
            from={todayYmd}
            styles={{ o: OPEN_FILL_SOFT, x: "bg-warning" }}
            labels={{ o: "geöffnet", x: "Ausnahme, geöffnet", c: "geschlossen" }}
            ariaLabel={`${schedule.name}: ${openDaysCount} von ${YEAR_DAYS} Tagen geöffnet`}
          />
          <MonthAxis from={todayYmd} days={YEAR_DAYS} />
        </section>

        {nextException && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs">
            <StatusDot tone="warning" size="xs" />
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">Ausnahme </span>
              <span className="tabular-nums">{shortDayLabel(nextException.date)}</span>
              {nextException.note && <span> {nextException.note}</span>}
              <span className="text-muted-foreground tabular-nums">
                {" "}· {compactHours(openingForDay(spec, nextException.date))}
                {futureExceptions.length > 1 && ` · +${futureExceptions.length - 1}`}
              </span>
            </span>
          </p>
        )}
      </CardContent>

      <CardFooter className="min-w-0 gap-1.5 border-t text-[11px] text-muted-foreground tabular-nums">
        <span className="shrink-0">
          {schedule.seasons.length} {schedule.seasons.length === 1 ? "Saison" : "Saisons"} ·{" "}
          {schedule.exceptions.length} {schedule.exceptions.length === 1 ? "Ausnahmetag" : "Ausnahmetage"} ·
          {childCount > 0 && ` ${childCount} ${childCount === 1 ? "Unterprofil" : "Unterprofile"} ·`}
        </span>
        <span className="min-w-0 truncate" title={schedule.roomNames.join(", ")}>
          {schedule.roomNames.length === 0
            ? "kein Raum"
            : `${schedule.roomNames.length === 1 ? "Raum" : "Räume"}: ${schedule.roomNames.join(", ")}`}
        </span>
      </CardFooter>
    </Card>
  );
}

export function BetriebszeitenClient({ data }: { data: BetriebszeitenData }) {
  const router = useRouter();
  const nowMs = useNow(new Date(data.renderedAt).getTime());
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  // Neues Profil; mit Zahl gleich als Unterprofil dieses Bereichs.
  const [creating, setCreating] = useState<{ parentId: number | null } | null>(null);
  // Rückfrage vor dem Löschen; das Profil bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<ScheduleRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  // Gemeinsamer Stundenbereich für alle Wochengrafiken, damit die Karten vergleichbar sind.
  const range = useMemo(() => hourRange(data.schedules.flatMap((s) => planSegments(toSpec(s)))), [data.schedules]);

  // Bereiche in ihrer Reihenfolge; Unterprofile (Bahnmieten, Kurse) gesammelt unter ihrem Bereich.
  const tree = useMemo(() => scheduleTree(data.schedules), [data.schedules]);
  const areas = tree.filter((e) => !e.sub);
  const subGroups = areas
    .map((area) => ({ area, subs: tree.filter((e) => e.parent?.id === area.item.id) }))
    .filter((g) => g.subs.length > 0);
  const todayYmd = tzYmd(new Date(nowMs), data.timezone);

  const openCount = areas.filter((e) => isOperatingAt(toSpec(e.item), new Date(nowMs), data.timezone)).length;

  function askRemove(schedule: ScheduleRow) {
    setToDelete(schedule);
    setConfirmOpen(true);
  }

  async function remove(schedule: ScheduleRow) {
    setError("");
    const res = await apiRequest(`/api/betriebszeiten/${schedule.id}`, "DELETE");
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="page-content space-y-4 sm:space-y-5">
      {/* Primärhandlung oben rechts (docs/design-regeln.md, Abschnitt 13): kein Umbruch, sonst
          rutschte die Taste bei langem Text (Räume ohne Betriebszeit) links unter den Text. */}
      <div className="flex items-center justify-between gap-3">
        {/* Ohne Profil sagt das der leere Zustand darunter; hier steht es nicht ein zweites Mal (docs/design-regeln.md, Abschnitt 1). */}
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {areas.length > 0 &&
            `${openCount} von ${areas.length} ${areas.length === 1 ? "Bereich" : "Bereichen"} gerade geöffnet.`}
          {data.roomsWithoutSchedule > 0 && (
            <>
              {" "}
              {data.roomsWithoutSchedule}{" "}
              {data.roomsWithoutSchedule === 1 ? "Raum hat" : "Räume haben"} keine Betriebszeit und{" "}
              {data.roomsWithoutSchedule === 1 ? "gilt" : "gelten"} als dauerhaft verfügbar.
            </>
          )}
        </p>
        {!data.readonly && (
          <Button className="shrink-0 max-sm:h-11" onClick={() => setCreating({ parentId: null })}>
            <Plus className="h-4 w-4" />
            Betriebszeit
          </Button>
        )}
      </div>

      {error && <Notice tone="danger" compact title={error} />}

      {data.schedules.length > 0 && <SyncStatus />}

      {data.schedules.length === 0 ? (
        <Card className="py-0 sm:py-0">
          <EmptyState
            icon={CalendarOff}
            title="Keine Betriebszeit hinterlegt"
            description="Ein Profil je Betriebsteil – etwa Strandbad, Gastronomie oder Seilbahn. Räume greifen darauf zu, und Automationen können dann „bei Betriebsbeginn“ oder „außerhalb der Betriebszeit“ auslösen."
          />
        </Card>
      ) : (
        // Zwei Ansichten: Profile zum Pflegen, Kalender für alle Bereiche auf einen Blick.
        <Tabs defaultValue="profile" className="gap-4 sm:gap-5">
          {/* Handy: volle Breite, damit die Leiste gleichmäßig umbricht (docs/design-regeln.md, Abschnitt 6). */}
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="profile" className="gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" />
              Profile ({areas.length})
            </TabsTrigger>
            <TabsTrigger value="kalender" className="gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              Kalender
            </TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="space-y-6 sm:space-y-8">
            {/* `grid-cols-1` (minmax(0, 1fr)): ohne feste Spalte macht ein langer Profilname
                (`truncate`) die Spalte breiter als das Handy, dann scrollt die Seite seitlich. */}
            <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {areas.map(({ item: schedule, color }) => (
                <ScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  color={color}
                  childCount={tree.filter((e) => e.parent?.id === schedule.id).length}
                  timezone={data.timezone}
                  nowMs={nowMs}
                  range={range}
                  readonly={data.readonly}
                  onEdit={() => setEditing(schedule)}
                  onDelete={() => askRemove(schedule)}
                />
              ))}
            </div>

            {subGroups.map(({ area, subs }) => (
              <section key={area.item.id} className="space-y-3" aria-labelledby={`sub-${area.item.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 id={`sub-${area.item.id}`} className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", area.color)} />
                      <span className="truncate">{area.item.name}: Angebote</span>
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Unterprofile mit eigenen Zeiten; nicht in der Kunden-App.
                    </p>
                  </div>
                  {!data.readonly && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 max-sm:h-11"
                      onClick={() => setCreating({ parentId: area.item.id })}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Angebot
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
                  {subs.map(({ item: schedule, color }) => (
                    <ScheduleCard
                      key={schedule.id}
                      schedule={schedule}
                      color={color}
                      childCount={0}
                      timezone={data.timezone}
                      nowMs={nowMs}
                      range={range}
                      readonly={data.readonly}
                      onEdit={() => setEditing(schedule)}
                      onDelete={() => askRemove(schedule)}
                    />
                  ))}
                </div>
              </section>
            ))}

            <FacilityUsage tree={tree} todayYmd={todayYmd} />
          </TabsContent>
          <TabsContent value="kalender">
            <OperatingCalendar schedules={data.schedules} timezone={data.timezone} nowMs={nowMs} />
          </TabsContent>
        </Tabs>
      )}

      {/* Löschen immer mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Betriebszeit „{toDelete?.name}“ löschen?</AlertDialogTitle>
            {/* Immer vorhanden (Radix verlangt eine Beschreibung); Text nur, wenn Räume betroffen sind. */}
            <AlertDialogDescription>
              {toDelete && toDelete.roomCount > 0 &&
                `${toDelete.roomCount} ${toDelete.roomCount === 1 ? "Raum verliert" : "Räume verlieren"} damit die Betriebszeit und ${toDelete.roomCount === 1 ? "gilt" : "gelten"} als dauerhaft verfügbar.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* 44 px auf dem Handy: die Ebenen-Regel in globals.css erfasst AlertDialog-Tasten nicht (data-slot wird überschrieben). */}
          <AlertDialogFooter>
            <AlertDialogCancel className="max-sm:h-11">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="max-sm:h-11"
              onClick={() => {
                if (toDelete) void remove(toDelete);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {creating && (
        <ScheduleDialog
          schedule={null}
          schedules={data.schedules}
          initialParentId={creating.parentId}
          open
          onClose={() => setCreating(null)}
        />
      )}
      {editing && (
        <ScheduleDialog
          key={editing.id}
          schedule={editing}
          schedules={data.schedules}
          open
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
