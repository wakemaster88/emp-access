"use client";

import { useMemo, useState, type ReactNode } from "react";
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
  describeDay,
  describeSeasonRange,
  isOperatingAt,
  openingForDay,
  operatingSpanState,
  seasonForDay,
  type ScheduleSpec,
  type SeasonSpec,
} from "@/lib/operating-hours";
import { compactHours, describeWeekPlan, shortDayLabel } from "@/lib/operating-calendar";
import { addDaysToYmd, formatHhmm, tzMinutesOfDay, tzYmd } from "@/lib/tz-time";
import { SyncStatus } from "@/components/betriebszeiten/sync-status";

function toSpec(row: ScheduleRow): ScheduleSpec {
  return { name: row.name, seasons: row.seasons, exceptions: row.exceptions };
}

/** So weit voraus sucht die Karte die nächste Öffnung (Winterpause). */
const LOOKAHEAD_DAYS = 200;

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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function ScheduleCard({
  schedule,
  timezone,
  nowMs,
  readonly,
  onEdit,
  onDelete,
}: {
  schedule: ScheduleRow;
  timezone: string;
  nowMs: number;
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
  const until = state.until ? untilLabel(state.until, nowMs) : null;
  const season = currentOrNextSeason(spec, todayYmd);
  const nextException = schedule.exceptions
    .filter((e) => e.date > todayYmd)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <CardTitle className="min-w-0">
            <h3 className="truncate">{schedule.name}</h3>
          </CardTitle>
          {schedule.isDefault && (
            <Badge variant="secondary">
              Vorbelegung
            </Badge>
          )}
          {/* Zustand als Farbe: geöffnet grün, geschlossen grau (docs/design-regeln.md, Abschnitt 3). */}
          <Badge variant={open ? "success" : "neutral"}>
            {open ? (
              <DoorOpen />
            ) : (
              <DoorClosed />
            )}
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
      <CardContent className="flex-1">
        <dl className="space-y-1 text-xs">
          <Row label="Jetzt">
            {state.inside ? (
              <>
                <span className="font-medium">geöffnet bis {state.until ? whenLabel(state.until, todayYmd, timezone).replace(/^heute /, "") : "?"}</span>
                {until && <span className="text-muted-foreground"> · {until}</span>}
              </>
            ) : state.until ? (
              <>
                <span className="font-medium">öffnet {whenLabel(state.until, todayYmd, timezone)}</span>
                {until && <span className="text-muted-foreground"> · {until}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">keine Öffnung in den nächsten {LOOKAHEAD_DAYS} Tagen</span>
            )}
          </Row>
          {(!today.closed || today.source === "exception") && (
            <Row label="Heute">
              {describeDay(today)}
              {today.source === "exception" && (
                <span className="ml-1.5 text-warning">Ausnahme{today.label ? `: ${today.label}` : ""}</span>
              )}
            </Row>
          )}
          <Row label="Saison">
            {season ? (
              <>
                {season.startsOn && <span className="text-muted-foreground">ab {shortDayLabel(season.startsOn)} </span>}
                {season.season.name}{" "}
                <span className="text-muted-foreground">
                  ({describeSeasonRange(season.season.startMmDd, season.season.endMmDd)})
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">keine Saison hinterlegt</span>
            )}
          </Row>
          {season && (
            <Row label="Woche">
              <span className="tabular-nums">{describeWeekPlan(season.season.periods)}</span>
            </Row>
          )}
          {nextException && (
            <Row label="Ausnahme">
              <span className="tabular-nums">{shortDayLabel(nextException.date)}</span>{" "}
              {nextException.note && <span>{nextException.note} </span>}
              <span className="text-muted-foreground tabular-nums">
                {compactHours(openingForDay(spec, nextException.date))}
              </span>
            </Row>
          )}
        </dl>
      </CardContent>

      <CardFooter className="min-w-0 gap-1.5 border-t text-[11px] text-muted-foreground tabular-nums">
        <span className="shrink-0">
          {schedule.seasons.length} {schedule.seasons.length === 1 ? "Saison" : "Saisons"} ·{" "}
          {schedule.exceptions.length} {schedule.exceptions.length === 1 ? "Ausnahmetag" : "Ausnahmetage"} ·
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
  const [creating, setCreating] = useState(false);
  // Rückfrage vor dem Löschen; das Profil bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<ScheduleRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  const openCount = useMemo(
    () =>
      data.schedules.filter((s) => isOperatingAt(toSpec(s), new Date(nowMs), data.timezone)).length,
    [data.schedules, data.timezone, nowMs],
  );

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
          {data.schedules.length > 0 &&
            `${openCount} von ${data.schedules.length} ${data.schedules.length === 1 ? "Profil" : "Profilen"} gerade geöffnet.`}
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
          <Button className="shrink-0 max-sm:h-11" onClick={() => setCreating(true)}>
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
              Profile ({data.schedules.length})
            </TabsTrigger>
            <TabsTrigger value="kalender" className="gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              Kalender
            </TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
            {/* `grid-cols-1` (minmax(0, 1fr)): ohne feste Spalte macht ein langer Profilname
                (`truncate`) die Spalte breiter als das Handy, dann scrollt die Seite seitlich. */}
            <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {data.schedules.map((schedule) => (
                <ScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  timezone={data.timezone}
                  nowMs={nowMs}
                  readonly={data.readonly}
                  onEdit={() => setEditing(schedule)}
                  onDelete={() => askRemove(schedule)}
                />
              ))}
            </div>
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
        <ScheduleDialog schedule={null} open onClose={() => setCreating(false)} />
      )}
      {editing && (
        <ScheduleDialog
          key={editing.id}
          schedule={editing}
          open
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
