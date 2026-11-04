"use client";

/**
 * Abläufe eines Raums (Regeln und Audio-Zeitpläne) in drei Gruppen statt einer
 * Liste: "Heute noch" mit Countdown, "Geplant" (die übrigen Termine) und
 * "Bei Ereignis" (Bewegung, Zutritt). Je Zeile: wann, was, zuletzt.
 * Mockup W11 im Räume-Konzept.
 */

import Link from "next/link";
import { Clock, LogIn, LogOut, Volume2, Workflow, Zap, type LucideIcon } from "lucide-react";
import type { RoomAutomation } from "@/lib/room-automations";
import { addDaysToYmd, formatHhmm, tzMinutesOfDay, tzYmd, weekdayBitOfYmd } from "@/lib/tz-time";
import { fmtAgo } from "@/components/raeume/shared";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const ANCHOR: Record<RoomAutomation["anchor"], { Icon: LucideIcon; tone: string; label: string }> = {
  open: { Icon: LogIn, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", label: "Öffnung" },
  close: { Icon: LogOut, tone: "bg-amber-500/12 text-amber-600 dark:text-amber-400", label: "Betriebsende" },
  time: { Icon: Clock, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-400", label: "Uhrzeit" },
  event: { Icon: Zap, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-400", label: "Ereignis" },
};

/** "heute" / "morgen" / "Sa 06.12." und die Uhrzeit, in der Zeitzone des Betriebs. */
export function nextParts(iso: string, nowMs: number, tz: string): { day: string; time: string } {
  const at = new Date(iso);
  const today = tzYmd(new Date(nowMs), tz);
  const ymd = tzYmd(at, tz);
  const time = formatHhmm(tzMinutesOfDay(at, tz));
  if (ymd === today) return { day: "heute", time };
  if (ymd === addDaysToYmd(today, 1)) return { day: "morgen", time };
  const [, m, d] = ymd.split("-");
  const inWeek = ymd <= addDaysToYmd(today, 6);
  return { day: inWeek ? WEEKDAYS[weekdayBitOfYmd(ymd)] : `${d}.${m}.`, time };
}

/** "in 12 Min", "in 3 Std 58 Min", "in 2 Tagen". */
export function fmtIn(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "jetzt";
  if (min < 60) return `in ${min} Min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `in ${h} Std${m ? ` ${m} Min` : ""}`;
  const d = Math.round(h / 24);
  return `in ${d} ${d === 1 ? "Tag" : "Tagen"}`;
}

interface Group {
  title: string;
  items: RoomAutomation[];
}

/** Drei Gruppen: heute noch, geplant, bei Ereignis. Leere Gruppen fallen weg. */
export function groupAutomations(items: RoomAutomation[], nowMs: number, tz: string): Group[] {
  const today = tzYmd(new Date(nowMs), tz);
  const byNext = (a: RoomAutomation, b: RoomAutomation) => Date.parse(a.nextAt ?? "") - Date.parse(b.nextAt ?? "");
  const todayItems = items
    .filter((i) => i.isActive && i.nextAt && tzYmd(new Date(i.nextAt), tz) === today && Date.parse(i.nextAt) >= nowMs - 60_000)
    .sort(byNext);
  const rest = items.filter((i) => !todayItems.includes(i));
  const events = rest.filter((i) => i.anchor === "event");
  const planned = rest
    .filter((i) => i.anchor !== "event")
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      if (!!a.nextAt !== !!b.nextAt) return a.nextAt ? -1 : 1;
      return byNext(a, b);
    });
  return [
    { title: "Heute noch", items: todayItems },
    { title: "Geplant", items: planned },
    { title: "Bei Ereignis", items: events },
  ].filter((g) => g.items.length > 0);
}

export function AutomationWidget({
  items,
  nowMs,
  timezone,
}: {
  items: RoomAutomation[];
  nowMs: number;
  timezone: string;
}) {
  const groups = groupAutomations(items, nowMs, timezone);
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.title} className="glass-tile overflow-hidden">
          <p className="text-label px-3 pb-1 pt-2.5">{g.title}</p>
          {g.items.map((item, i) => {
            const anchor = ANCHOR[item.anchor];
            const next = item.nextAt ? nextParts(item.nextAt, nowMs, timezone) : null;
            const inMs = item.nextAt ? Date.parse(item.nextAt) - nowMs : null;
            const soon = inMs != null && inMs < 3 * 3_600_000;
            return (
              <Link
                key={item.key}
                href={item.kind === "audio" ? "/audio" : "/regeln"}
                className={cn(
                  "flex items-stretch gap-3 px-3 py-2.5 transition-colors hover:bg-foreground/5",
                  i > 0 && "border-t border-border/50",
                  !item.isActive && "opacity-55",
                )}
              >
                <div
                  className={cn(
                    "flex w-14 shrink-0 flex-col items-center justify-center rounded-control py-1.5 text-center",
                    next ? (soon ? "bg-primary text-primary-foreground" : "bg-foreground/8") : "bg-foreground/5",
                  )}
                >
                  {next ? (
                    <>
                      <span className={cn("text-[10px] font-medium uppercase", soon ? "opacity-80" : "text-muted-foreground")}>
                        {next.day}
                      </span>
                      <span className="text-sm font-semibold tabular-nums leading-tight">{next.time}</span>
                    </>
                  ) : (
                    <span className="px-1 text-[10px] leading-tight text-muted-foreground">
                      {item.isActive ? (item.anchor === "event" ? "bei Bedarf" : "kein Termin") : "pausiert"}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md", anchor.tone)}>
                      <anchor.Icon className="h-3 w-3" />
                    </span>
                    <span className="truncate text-[13px] font-semibold">{item.name}</span>
                    {item.kind === "audio" ? (
                      <Volume2 className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" aria-label="Beschallung" />
                    ) : (
                      <Workflow className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" aria-label="Regel" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {g.title === "Heute noch" && inMs != null ? `${fmtIn(inMs)} · ${item.when}` : item.when}
                    {item.lastRunAt && <span className="text-muted-foreground/70"> · zuletzt {fmtAgo(item.lastRunAt, nowMs)}</span>}
                  </p>
                  {item.actions.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.actions.map((action, j) => (
                        <span
                          key={j}
                          className="inline-flex max-w-full items-center rounded-full bg-foreground/8 px-2 py-0.5 text-[10px] text-foreground/80"
                        >
                          <span className="truncate">{action}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
