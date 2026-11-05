"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, DoorClosed, DoorOpen, Pencil, Plus, Trash2 } from "lucide-react";
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
import { apiRequest } from "@/components/raeume/shared";
import { useNow } from "@/components/raeume/status";
import { ScheduleDialog } from "@/components/betriebszeiten/schedule-dialog";
import type { BetriebszeitenData, ScheduleRow } from "@/components/betriebszeiten/types";
import {
  boundariesForDay,
  describeDay,
  describeSeasonRange,
  isOperatingAt,
  openingForDay,
  seasonForDay,
  type ScheduleSpec,
} from "@/lib/operating-hours";
import { addDaysToYmd, tzYmd } from "@/lib/tz-time";

function toSpec(row: ScheduleRow): ScheduleSpec {
  return { name: row.name, seasons: row.seasons, exceptions: row.exceptions };
}

/** "in 25 Min." bzw. "vor 3 Std." – für den nächsten Betriebswechsel. */
function untilLabel(target: Date, nowMs: number): string {
  const minutes = Math.round((target.getTime() - nowMs) / 60_000);
  if (minutes <= 0) return "jetzt";
  if (minutes < 60) return `in ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours} Std.` : `in ${hours} Std. ${rest} Min.`;
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
  const tomorrow = openingForDay(spec, addDaysToYmd(todayYmd, 1));
  const open = isOperatingAt(spec, now, timezone);
  const season = seasonForDay(spec, todayYmd);

  // Nächster Wechsel: erste Grenze von heute oder morgen, die noch aussteht.
  const nextBoundary = [
    ...boundariesForDay(spec, todayYmd, timezone),
    ...boundariesForDay(spec, addDaysToYmd(todayYmd, 1), timezone),
  ].find((b) => b.at.getTime() > nowMs);

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
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Heute</dt>
            <dd className="font-medium">
              {describeDay(today)}
              {today.source === "exception" && (
                <span className="ml-1.5 font-normal text-warning">
                  Ausnahme{today.label ? `: ${today.label}` : ""}
                </span>
              )}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Morgen</dt>
            <dd>{describeDay(tomorrow)}</dd>
          </div>
          {nextBoundary && (
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted-foreground">Nächster</dt>
              <dd>
                {nextBoundary.kind === "open" ? "Betriebsbeginn" : "Betriebsende"}{" "}
                <span className="text-muted-foreground">{untilLabel(nextBoundary.at, nowMs)}</span>
              </dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Saison</dt>
            <dd>
              {season ? (
                <>
                  {season.name}{" "}
                  <span className="text-muted-foreground">
                    ({describeSeasonRange(season.startMmDd, season.endMmDd)})
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  heute keine Saison hinterlegt – gilt als geschlossen
                </span>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>

      <CardFooter className="flex-wrap gap-1.5 border-t text-[11px] text-muted-foreground tabular-nums">
        <span>
          {schedule.seasons.length} {schedule.seasons.length === 1 ? "Saison" : "Saisons"}
        </span>
        <span>·</span>
        <span>
          {schedule.exceptions.length}{" "}
          {schedule.exceptions.length === 1 ? "Ausnahmetag" : "Ausnahmetage"}
        </span>
        <span>·</span>
        <span>
          {schedule.roomCount} {schedule.roomCount === 1 ? "Raum" : "Räume"}
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Ohne Profil sagt das der leere Zustand darunter; hier steht es nicht ein zweites Mal (docs/design-regeln.md, Abschnitt 1). */}
        <p className="text-xs text-muted-foreground">
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
          <Button className="max-sm:h-11" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Betriebszeit
          </Button>
        )}
      </div>

      {error && <Notice tone="danger" compact title={error} />}

      {data.schedules.length === 0 ? (
        <Card className="py-0 sm:py-0">
          <EmptyState
            icon={CalendarOff}
            title="Keine Betriebszeit hinterlegt"
            description="Ein Profil je Betriebsteil – etwa Strandbad, Gastronomie oder Seilbahn. Räume greifen darauf zu, und Automationen können dann „bei Betriebsbeginn“ oder „außerhalb der Betriebszeit“ auslösen."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
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
