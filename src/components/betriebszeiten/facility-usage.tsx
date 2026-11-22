"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { DayStrip, MonthAxis, OPEN_FILL_SOFT } from "@/components/betriebszeiten/charts";
import type { TreeEntry } from "@/components/betriebszeiten/series";
import type { ScheduleRow } from "@/components/betriebszeiten/types";
import {
  cleanFacilities,
  clashDatesLabel,
  clashTimeLabel,
  facilityClashes,
  facilityKey,
  groupClashes,
} from "@/lib/facility-overlap";
import { yearMarks } from "@/lib/operating-calendar";
import { addDaysToYmd } from "@/lib/tz-time";
import { cn } from "@/lib/utils";

const DAYS = 365;

/**
 * Belegung der Anlagen (Seilbahn A, B, Übungslift): wer nutzt welche Anlage,
 * an welchen Tagen ist sie belegt, und überschneiden sich zwei Profile? Das
 * Speichern lehnt Überschneidungen ab; die Karte zeigt den Stand und findet
 * Altlasten, die vor der Prüfung entstanden sind. Geteilte Zeit (beide
 * Profile erlauben sie, anny verhindert Doppelbuchungen) steht als Hinweis da.
 */
export function FacilityUsage({ tree, todayYmd }: { tree: TreeEntry<ScheduleRow>[]; todayYmd: string }) {
  const profiles = tree
    .filter((e) => e.item.facilities.length > 0)
    .map((e) => ({
      entry: e,
      profile: {
        id: e.item.id,
        name: e.item.name,
        facilities: e.item.facilities,
        shared: e.item.sharedTime,
        spec: { name: e.item.name, seasons: e.item.seasons, exceptions: e.item.exceptions },
      },
    }));
  if (profiles.length === 0) return null;

  const clashes = facilityClashes(
    profiles.map((p) => p.profile),
    todayYmd,
    DAYS,
  );
  const groups = groupClashes(clashes);
  const conflicts = clashes.filter((c) => !c.shared);
  const clashDays = new Set(conflicts.map((c) => `${facilityKey(c.facility)}|${c.date}`));
  const sharedDays = new Set(clashes.filter((c) => c.shared).map((c) => `${facilityKey(c.facility)}|${c.date}`));
  const marksById = new Map(profiles.map((p) => [p.profile.id, yearMarks(p.profile.spec, todayYmd, DAYS)]));

  const facilities = cleanFacilities(profiles.flatMap((p) => p.profile.facilities));
  const rows = facilities.map((name) => {
    const key = facilityKey(name);
    const members = profiles.filter((p) => p.profile.facilities.some((f) => facilityKey(f) === key));
    const memberMarks = members.map((m) => marksById.get(m.profile.id) ?? "");
    let marks = "";
    let used = 0;
    for (let i = 0; i < DAYS; i += 1) {
      const date = addDaysToYmd(todayYmd, i);
      if (clashDays.has(`${key}|${date}`)) marks += "x";
      else if (sharedDays.has(`${key}|${date}`)) marks += "s";
      else if (memberMarks.some((m) => m[i] && m[i] !== "c")) marks += "o";
      else marks += "c";
      if (marks[i] !== "c") used += 1;
    }
    return { name, key, members, marks, used, groups: groups.filter((g) => facilityKey(g.facility) === key) };
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <CardTitle>
            <h3>Anlagen-Belegung</h3>
          </CardTitle>
          {conflicts.length === 0 ? (
            <Badge variant="success">keine Überschneidung</Badge>
          ) : (
            <Badge variant="warning">
              {conflicts.length} {conflicts.length === 1 ? "Überschneidung" : "Überschneidungen"}
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          Profile mit gleicher Anlage dürfen nicht gleichzeitig geöffnet sein, außer beide teilen sich die Zeit
          (Bahnmiete und Kurs, wer zuerst bucht). Geprüft heute und die nächsten 12 Monate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key} className="min-w-0 space-y-1.5">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">{row.name}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {row.used} {row.used === 1 ? "Tag" : "Tage"} belegt
                </span>
              </div>
              <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {row.members.map((m) => (
                  <span key={m.profile.id} className="inline-flex min-w-0 items-center gap-1">
                    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", m.entry.color)} />
                    {m.profile.name}
                  </span>
                ))}
              </p>
              <DayStrip
                marks={row.marks}
                from={todayYmd}
                styles={{ o: OPEN_FILL_SOFT, s: "bg-info/70", x: "bg-warning" }}
                labels={{ o: "belegt", s: "belegt, geteilte Zeit", x: "Überschneidung", c: "frei" }}
                ariaLabel={`${row.name}: ${row.used} Tage belegt, ${row.groups.some((g) => !g.shared) ? "mit Überschneidungen" : "keine Überschneidung"}`}
              />
              <MonthAxis from={todayYmd} days={DAYS} />
              {row.groups.length > 0 && (
                <ul className="space-y-0.5 pt-1 text-[11px] tabular-nums">
                  {row.groups.map((g) => (
                    <li key={`${g.first.id}|${g.second.id}|${g.start}|${g.end}`} className="flex min-w-0 items-start gap-1.5">
                      <StatusDot tone={g.shared ? "info" : "warning"} size="xs" className="mt-1" />
                      <span className="min-w-0">
                        <span className={g.shared ? undefined : "font-medium"}>
                          {g.first.name} und {g.second.name}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {g.shared ? "teilen sich " : ""}
                          {clashTimeLabel(g.start, g.end)} am {clashDatesLabel(g.dates)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

