"use client";

import { useEffect, useState, useCallback, use, useRef, type CSSProperties } from "react";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";

interface TimeSlot {
  start: string;
  end: string;
  status: "free" | "booked";
  count: number;
  names: string[];
  capacity: number | null;
  source?: string;
  isPublic?: boolean;
  price?: string;
  checkins?: number;
}

interface Resource {
  id: number;
  name: string;
  capacity: number | null;
  totalBooked: number;
  dayCheckins?: number;
  slots: TimeSlot[];
}

interface MonitorData {
  name: string;
  date: string;
  now: string;
  resources: Resource[];
}

const HOUR_START = 8;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const TOTAL_MINUTES = TOTAL_HOURS * 60;
const POLL_INTERVAL = 60_000;
const COL_HEADER_HEIGHT = 36;
const TIME_GUTTER = 54;
const GRID_PAD = 12;
/** Handy: Mindestbreite je Ressource, damit Titel und Pillen lesbar bleiben; sonst scrollt das Raster. */
const MIN_COL_WIDTH = 112;

function timeToMinutes(timeStr: string): number | null {
  const parts = timeStr.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function clampMinutes(min: number): number {
  return Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, min));
}

function minutesToPercent(minutes: number): number {
  return ((minutes - HOUR_START * 60) / TOTAL_MINUTES) * 100;
}

function getNowBerlinMinutes(): number {
  const now = new Date();
  const parts = now
    .toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false })
    .split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function getNowBerlinTime(): string {
  return new Date().toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LONG_DATE: Intl.DateTimeFormatOptions = { weekday: "long", day: "2-digit", month: "long", year: "numeric" };
/** Kurzform für die Datumstaste auf dem Handy („Do., 05.11.“). */
const SHORT_DATE: Intl.DateTimeFormatOptions = { weekday: "short", day: "2-digit", month: "2-digit" };

function formatDateDE(dateStr: string, options: Intl.DateTimeFormatOptions = LONG_DATE): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("de-DE", options);
  } catch {
    return dateStr;
  }
}

export default function ResourceMonitorPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  // Bildschirm wach halten, solange die Seite sichtbar ist.
  useWakeLock(true);
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState(false);
  const [nowMinutes, setNowMinutes] = useState(getNowBerlinMinutes);
  const [nowTime, setNowTime] = useState(getNowBerlinTime);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const gridRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const todayBerlin = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const isToday = !selectedDate || selectedDate === todayBerlin;

  const fetchData = useCallback(async () => {
    try {
      const dateParam = selectedDate ? `?date=${selectedDate}` : "";
      const res = await fetch(`/api/monitor/public/${token}/resources${dateParam}`);
      if (!res.ok) { setError(true); return; }
      const json: MonitorData = await res.json();
      setData(json);
      setError(false);
    } catch {
      setError(true);
    }
  }, [token, selectedDate]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [fetchData]);

  useEffect(() => {
    const iv = setInterval(() => {
      setNowMinutes(getNowBerlinMinutes());
      setNowTime(getNowBerlinTime());
    }, 15_000);
    return () => clearInterval(iv);
  }, []);

  // Farbgrund, dunkles Farbschema und Bildschirmhöhe kommen aus dem Layout (page-ambient,
  // `dark`, Rahmen ohne Safe-Area); die Seite füllt den Rahmen (`flex-1`).
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Notice tone="danger" title={<span className="sm:text-xl">Monitor nicht gefunden oder inaktiv.</span>} className="w-full max-w-md sm:max-w-xl sm:p-6" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3 text-lg text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Laden…
        </div>
      </div>
    );
  }

  const nowPct = minutesToPercent(clampMinutes(nowMinutes));
  const showNowLine = isToday && nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;
  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_START + i);
  const resources = data.resources;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden select-none">
      {/* Header: Glasleiste mit Titel links, Datum und großer Uhr rechts (Zahlen 48 px). Tasten
          56 px wie auf allen Wandmonitoren, auf dem Handy 44 px (docs/design-regeln.md,
          Abschnitte 20 und 23); dort steht das Datum kurz, damit der
          Titel Platz behält. Der Titel nimmt den Rest und kürzt zuerst; reicht selbst das nicht,
          kürzt das Datum – die Uhr bleibt immer ganz sichtbar. */}
      <header
        className="shrink-0 h-16 sm:h-18 glass-bar border-b border-border px-3 sm:px-5 flex items-center justify-between"
      >
        <h1 className="flex-1 text-lg sm:text-xl 2xl:text-2xl font-semibold tracking-tight truncate">{data.name}</h1>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 pl-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => dateInputRef.current?.showPicker()}
            className="h-11 min-w-0 shrink gap-2 rounded-full px-3 sm:h-14 sm:px-4 sm:text-base"
          >
            <CalendarDays className="text-muted-foreground" />
            <span className="truncate sm:hidden">{formatDateDE(data.date, SHORT_DATE)}</span>
            <span className="hidden truncate sm:inline">{formatDateDE(data.date)}</span>
          </Button>
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate || todayBerlin}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="sr-only"
            tabIndex={-1}
          />
          {!isToday && (
            // Glas-Pille statt Akzent-Text: primary bliebe auf der dunklen Leiste knapp unter 4,5:1.
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSelectedDate("")}
              className="h-11 rounded-full px-4 font-semibold sm:h-14 sm:px-5 sm:text-base"
            >
              Heute
            </Button>
          )}
          <p className="shrink-0 text-2xl sm:text-5xl leading-none font-mono font-bold tabular-nums">{nowTime}</p>
        </div>
      </header>

      {resources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <EmptyState icon={CalendarDays} title="Keine Ressourcen konfiguriert." />
          </Card>
        </div>
      ) : (
        // Spaltenköpfe und Raster scrollen gemeinsam in ihrem Rahmen waagerecht, nie die Seite
        // (docs/design-regeln.md, Abschnitt 17): Auf dem Handy sind beide Zeilen mindestens
        // Zeitleiste + MIN_COL_WIDTH je Ressource breit, die Zeitleiste bleibt links stehen. Ab sm
        // teilen sich die Spalten die Breite wie bisher – ein Wandmonitor zeigt alles ohne Scrollen.
        <div
          className="flex-1 min-h-0 flex flex-col overflow-x-auto overflow-y-hidden monitor-scrollbar"
          style={{ "--grid-min-w": `${TIME_GUTTER + resources.length * MIN_COL_WIDTH}px` } as CSSProperties}
        >
          {/* Column headers */}
          <div
            className="shrink-0 flex border-b border-border bg-glass max-sm:min-w-(--grid-min-w)"
            style={{ height: COL_HEADER_HEIGHT }}
          >
            <div className="w-[54px] 2xl:w-16 shrink-0 max-sm:sticky max-sm:left-0 max-sm:z-30 max-sm:bg-background/80" />
            {resources.map((r) => (
              <div
                key={r.id}
                className="flex-1 min-w-0 px-1 flex items-center justify-center border-l border-border"
              >
                <p className="text-base sm:text-lg 2xl:text-xl font-bold truncate max-w-full">{r.name}</p>
              </div>
            ))}
          </div>

          {/* Grid – ohne eigenes overflow-hidden, damit die Zeitleiste am Rahmen kleben kann;
              der Rahmen darüber schneidet senkrecht ab. */}
          <div
            ref={gridRef}
            className="flex flex-1 max-sm:min-w-(--grid-min-w)"
            style={{ paddingTop: GRID_PAD, paddingBottom: GRID_PAD }}
          >
            <div className="relative flex w-full h-full">
              {/* Time gutter: auf dem Handy klebt sie links und deckt die Spalten darunter ab. */}
              <div className="w-[54px] 2xl:w-16 shrink-0 relative z-10 max-sm:sticky max-sm:left-0 max-sm:z-30 max-sm:bg-background/80">
                {hours.map((h) => {
                  const pct = ((h - HOUR_START) / TOTAL_HOURS) * 100;
                  return (
                    <div
                      key={h}
                      className="absolute right-0 left-0 flex justify-end pr-1.5 sm:pr-2"
                      style={{ top: `${pct}%`, transform: "translateY(-50%)" }}
                    >
                      <span className="text-xs sm:text-sm 2xl:text-base text-muted-foreground font-mono font-medium leading-none tabular-nums">
                        {String(h).padStart(2, "0")}:00
                      </span>
                    </div>
                  );
                })}

                {showNowLine && (
                  <div
                    className="absolute left-0 right-0 flex justify-end pr-1.5 sm:pr-2 z-30"
                    style={{ top: `${nowPct}%`, transform: "translateY(-50%)" }}
                  >
                    <span className="text-[10px] sm:text-xs 2xl:text-sm font-mono font-bold text-foreground bg-background px-0.5 2xl:px-1 rounded leading-none tabular-nums">
                      {nowTime}
                    </span>
                  </div>
                )}
              </div>

              {/* Resource columns */}
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex-1 min-w-0 relative border-l border-border"
                >
                  {/* Hour lines */}
                  {hours.map((h) => {
                    const pct = ((h - HOUR_START) / TOTAL_HOURS) * 100;
                    return (
                      <div
                        key={h}
                        className="absolute left-0 right-0 border-t border-border"
                        style={{ top: `${pct}%` }}
                      />
                    );
                  })}

                  {/* Half-hour lines */}
                  {hours.slice(0, -1).map((h) => {
                    const pct = ((h - HOUR_START + 0.5) / TOTAL_HOURS) * 100;
                    return (
                      <div
                        key={`half-${h}`}
                        className="absolute left-0 right-0 border-t border-dashed border-border/50"
                        style={{ top: `${pct}%` }}
                      />
                    );
                  })}

                  {/* Slots: frei = success, öffentlich/ÖB = info, gebucht = violett („jemand da“,
                      docs/design-regeln.md, Abschnitt 3) – gebucht ist Normalbetrieb, Rot heißt Störung.
                      Die Seite läuft immer dunkel, deshalb die 400er-Töne (Abschnitte 10 und 15).
                      Deckender Grund (bg-background) unter der Tönung, weil sich Slots überlappen
                      und der obere den unteren verdecken muss (z-Reihenfolge). */}
                  {resource.slots.map((slot, i) => {
                    const startMin = timeToMinutes(slot.start);
                    const endMin = slot.end ? timeToMinutes(slot.end) : null;
                    if (startMin == null) return null;
                    const topPct = minutesToPercent(clampMinutes(startMin));
                    const effectiveEndMin = endMin != null ? endMin : startMin + 60;
                    const bottomPct = minutesToPercent(clampMinutes(effectiveEndMin));
                    const heightPct = Math.max(bottomPct - topPct, 2);
                    const isFree = slot.status === "free";
                    const isPublic = slot.isPublic;

                    const checkins = slot.checkins ?? 0;
                    const dayCI = resource.dayCheckins ?? 0;
                    let badge: string | null = null;
                    if (isPublic) {
                      badge = `${(slot.count || 0) + dayCI} Gäste`;
                    } else if (isFree) {
                      badge = "0/1";
                    } else {
                      badge = `${slot.count}/1`;
                    }

                    return (
                      <div
                        key={`slot-${i}`}
                        className={cn(
                          "absolute left-1 right-1 sm:left-1.5 sm:right-1.5 rounded-lg",
                          // bg-linear-to-*, nicht bg-gradient-to-*: tailwind-merge hielte das für eine
                          // Hintergrundfarbe und würfe bg-background in cn() weg.
                          "flex flex-col justify-center px-1.5 sm:px-2 overflow-hidden border bg-background bg-linear-to-br text-foreground",
                          // Kurze Slots (15 Min.): Titel kleiner und ohne Zeilenabstand, sonst abgeschnitten.
                          heightPct < 4 && "[&>p]:text-xs [&>p]:leading-none",
                          isPublic
                            ? "from-info/22 to-info/12 border-info/45 z-[2]"
                            : isFree
                              ? "from-success/22 to-success/12 border-success/45 z-[1]"
                              : "from-violet-400/28 to-violet-400/16 border-violet-400/50 z-[5]",
                        )}
                        style={{ top: `${topPct}%`, height: `${heightPct}%` }}
                        title={isPublic
                          ? `${slot.source ? slot.source + ": " : ""}${slot.start} – ${slot.end}${slot.count > 0 ? ` | ${slot.count}x gebucht: ${slot.names.join(", ")}` : ""}${dayCI > 0 ? ` | ${dayCI} Tages-Checkins` : ""}`
                          : isFree
                            ? `${slot.source ? slot.source + ": " : ""}Frei ${slot.start} – ${slot.end}${slot.price ? ` (${slot.price})` : ""}${checkins > 0 ? ` | ${checkins} Abo-Checkins` : ""}`
                            : `${slot.count}x gebucht: ${slot.start} – ${slot.end}\n${slot.names.join(", ")}${checkins > 0 ? `\n${checkins} Abo-Checkins` : ""}`}
                      >
                        {badge && (
                          <span className={cn(
                            "absolute right-0.5 sm:right-1 px-1.5 sm:px-2 rounded-full text-[11px] sm:text-xs 2xl:text-sm font-bold whitespace-nowrap tabular-nums",
                            heightPct < 4 ? "top-1/2 -translate-y-1/2 leading-none" : "top-0.5 sm:top-1 py-0.5 leading-tight",
                            // Schrift in foreground: Zustandsfarbe auf getönter Fläche bliebe unter 4,5:1.
                            isPublic
                              ? "bg-info/25 text-foreground"
                              : isFree
                                ? "bg-success/25 text-foreground"
                                : "bg-violet-400/25 text-foreground",
                          )}>
                            {badge}
                          </span>
                        )}
                        {isFree && !isPublic ? (
                          <>
                            <p className="text-xs sm:text-sm 2xl:text-base font-bold leading-tight truncate pr-8 sm:pr-10 2xl:pr-14">
                              {slot.source || "Frei"}
                            </p>
                            {heightPct > 4 && (
                              <p className="text-[11px] sm:text-xs 2xl:text-sm font-medium leading-tight truncate opacity-70">
                                {slot.start} – {slot.end}
                              </p>
                            )}
                            {slot.price && heightPct > 6 && slot.price.split("\n").map((p, j) => (
                              <p key={j} className="text-[11px] sm:text-xs 2xl:text-sm font-semibold leading-tight truncate">
                                {p}
                              </p>
                            ))}
                          </>
                        ) : isPublic ? (
                          <>
                            <p className="text-xs sm:text-sm 2xl:text-base font-bold leading-tight truncate pr-8 sm:pr-10 2xl:pr-14">
                              {slot.source || "Öffentlicher Betrieb"}
                            </p>
                            {heightPct > 4 && (
                              <p className="text-[11px] sm:text-xs 2xl:text-sm font-medium leading-tight truncate opacity-70">
                                {slot.start} – {slot.end}
                              </p>
                            )}
                            {slot.price && heightPct > 6 && slot.price.split("\n").map((p, j) => (
                              <p key={j} className="text-[11px] sm:text-xs 2xl:text-sm font-semibold leading-tight truncate">
                                {p}
                              </p>
                            ))}
                          </>
                        ) : (
                          <>
                            <p className="text-xs sm:text-sm 2xl:text-base font-bold leading-tight truncate pr-8 sm:pr-10 2xl:pr-14">
                              {slot.count}x gebucht
                            </p>
                            {heightPct > 4 && (
                              <p className="text-[11px] sm:text-xs 2xl:text-sm font-medium leading-tight truncate opacity-70">
                                {slot.start} – {slot.end}
                              </p>
                            )}
                            {heightPct > 7 && slot.names.length > 0 && (
                              <p className="text-[11px] sm:text-xs 2xl:text-sm leading-tight truncate opacity-60 mt-px">
                                {slot.names.slice(0, 3).join(", ")}
                                {slot.count > 3 ? " …" : ""}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Now line */}
                  {showNowLine && (
                    <div
                      className="absolute left-0 right-0 z-20 pointer-events-none"
                      style={{ top: `${nowPct}%` }}
                    >
                      {/* Jetzt-Marke gestrichelt (docs/design-regeln.md, Abschnitt 8); der Punkt am
                          Spaltenrand macht sie als Marke lesbar, nicht als Durchstreichung im Slot. */}
                      <div className="border-t-2 border-dashed border-foreground/70" />
                      <div className="absolute -left-1 top-px size-2 -translate-y-1/2 rounded-full bg-foreground" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
