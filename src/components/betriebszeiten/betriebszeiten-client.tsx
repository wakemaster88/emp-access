"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, DoorClosed, DoorOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorLine, apiRequest } from "@/components/raeume/shared";
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
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{schedule.name}</h3>
            {schedule.isDefault && (
              <Badge variant="secondary" className="h-5 text-[10px]">
                Vorbelegung
              </Badge>
            )}
            <Badge
              className={
                open
                  ? "h-5 border-0 bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "h-5 border-0 bg-neutral-100 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
              }
            >
              {open ? (
                <DoorOpen className="mr-1 h-3 w-3" />
              ) : (
                <DoorClosed className="mr-1 h-3 w-3" />
              )}
              {open ? "geöffnet" : "geschlossen"}
            </Badge>
          </div>
          {schedule.description && (
            <p className="mt-0.5 truncate text-xs text-neutral-500">{schedule.description}</p>
          )}
        </div>

        {!readonly && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              onClick={onEdit}
              title="Bearbeiten"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-neutral-400 hover:text-red-600"
              onClick={onDelete}
              title="Löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-neutral-500">Heute</dt>
          <dd className="font-medium">
            {describeDay(today)}
            {today.source === "exception" && (
              <span className="ml-1.5 font-normal text-amber-600">
                Ausnahme{today.label ? `: ${today.label}` : ""}
              </span>
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-neutral-500">Morgen</dt>
          <dd>{describeDay(tomorrow)}</dd>
        </div>
        {nextBoundary && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-neutral-500">Nächster</dt>
            <dd>
              {nextBoundary.kind === "open" ? "Betriebsbeginn" : "Betriebsende"}{" "}
              <span className="text-neutral-500">{untilLabel(nextBoundary.at, nowMs)}</span>
            </dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-neutral-500">Saison</dt>
          <dd>
            {season ? (
              <>
                {season.name}{" "}
                <span className="text-neutral-500">
                  ({describeSeasonRange(season.startMmDd, season.endMmDd)})
                </span>
              </>
            ) : (
              <span className="text-neutral-500">
                heute keine Saison hinterlegt – gilt als geschlossen
              </span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-neutral-100 pt-2 text-[11px] text-neutral-500 dark:border-neutral-800">
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
      </div>
    </Card>
  );
}

export function BetriebszeitenClient({ data }: { data: BetriebszeitenData }) {
  const router = useRouter();
  const nowMs = useNow(new Date(data.renderedAt).getTime());
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const openCount = useMemo(
    () =>
      data.schedules.filter((s) => isOperatingAt(toSpec(s), new Date(nowMs), data.timezone)).length,
    [data.schedules, data.timezone, nowMs],
  );

  async function remove(schedule: ScheduleRow) {
    const hint =
      schedule.roomCount > 0
        ? `\n\n${schedule.roomCount} ${schedule.roomCount === 1 ? "Raum verliert" : "Räume verlieren"} damit die Betriebszeit und ${schedule.roomCount === 1 ? "gilt" : "gelten"} als dauerhaft verfügbar.`
        : "";
    if (!confirm(`Betriebszeit „${schedule.name}“ löschen?${hint}`)) return;

    setError("");
    const res = await apiRequest(`/api/betriebszeiten/${schedule.id}`, "DELETE");
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          {data.schedules.length === 0
            ? "Noch keine Betriebszeit angelegt."
            : `${openCount} von ${data.schedules.length} ${data.schedules.length === 1 ? "Profil" : "Profilen"} gerade geöffnet.`}
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
          <Button
            size="sm"
            className="h-8 bg-indigo-600 text-xs hover:bg-indigo-700"
            onClick={() => setCreating(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Betriebszeit
          </Button>
        )}
      </div>

      <ErrorLine message={error} />

      {data.schedules.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <CalendarOff className="h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium">Keine Betriebszeit hinterlegt</p>
          <p className="max-w-md text-xs text-neutral-500">
            Ein Profil je Betriebsteil – etwa Strandbad, Gastronomie oder Seilbahn. Räume greifen
            darauf zu, und Automationen können dann „bei Betriebsbeginn“ oder „außerhalb der
            Betriebszeit“ auslösen.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {data.schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              timezone={data.timezone}
              nowMs={nowMs}
              readonly={data.readonly}
              onEdit={() => setEditing(schedule)}
              onDelete={() => remove(schedule)}
            />
          ))}
        </div>
      )}

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
