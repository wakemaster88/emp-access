"use client";

/**
 * Auslastungs-Uebersicht des Check-in-Kiosks (ANNY-Slots je Ressource).
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { useEffect, useState, useMemo, createContext, useContext } from "react";
import { Clock, Ticket, Loader2, Mountain } from "lucide-react";
import { cn } from "@/lib/utils";
import { Lock, LockOpen } from "lucide-react";
import type { SlotOverviewData, SlotOverviewPickPayload, SlotOverviewService, SlotOverviewSlot, SlotOverviewUIState, TimeRange } from "./checkin-types";
import { annyReasonLabel, computeGlobalRange, groupByResource, groupOverviewServices, minutesToTimeString, splitServiceLabel, timeStringToMinutes } from "./checkin-utils";

export const SlotOverviewUIContext = createContext<SlotOverviewUIState>({
  nowMin: null,
  hoverMin: null,
  setHoverMin: () => {},
});


/**
 * Hook: liefert die aktuelle Berlin-Uhrzeit als Minutes-seit-Mitternacht,
 * aktualisiert sich jede Minute. Liefert null, wenn das angefragte Datum
 * nicht der heutige Tag ist (dann waere ein Now-Indicator irrefuehrend).
 */
export function useCurrentMinuteIfToday(dateStr: string): number | null {
  const [nowMin, setNowMin] = useState<number | null>(() => null);
  useEffect(() => {
    const compute = (): number | null => {
      const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      if (todayStr !== dateStr) return null;
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(new Date());
      let h = 0;
      let m = 0;
      for (const p of parts) {
        if (p.type === "hour") h = parseInt(p.value, 10);
        if (p.type === "minute") m = parseInt(p.value, 10);
      }
      return h * 60 + m;
    };
    setNowMin(compute());
    const interval = setInterval(() => setNowMin(compute()), 60 * 1000);
    return () => clearInterval(interval);
  }, [dateStr]);
  return nowMin;
}


/**
 * Renderer-Container fuer eine Service-Zeile. Rendert:
 *   1. Stunden-Gridlines im Hintergrund (vertikale subtile Borders)
 *   2. Now-Marker (rote Linie auf aktueller Uhrzeit, nur heute)
 *   3. Hover-Highlight (sky Linie auf hover-Position, von Pills gesetzt)
 *   4. Children (die eigentlichen Pills via TimelineSlot)
 */
export function SlotTimeline({
  range,
  children,
  empty,
  heightPx = 28,
}: {
  range: TimeRange;
  children?: React.ReactNode;
  /** Optionaler Empty-State-Text fuer Services ohne Slots. */
  empty?: string;
  /** Hoehe des Timeline-Containers in Pixel (Default 28). Bei Combined-Rows
   *  mit gestackten Stripes wird die Hoehe hochgesetzt, damit die Stripes
   *  nicht ueberlappen. */
  heightPx?: number;
}) {
  const { nowMin, hoverMin } = useContext(SlotOverviewUIContext);
  const total = Math.max(1, range.endMin - range.startMin);
  // Stundliches Raster (wie TimelineAxis).
  const tickStepMin = 60;
  const firstTick = Math.ceil(range.startMin / tickStepMin) * tickStepMin;
  const ticks: number[] = [];
  for (let t = firstTick; t < range.endMin; t += tickStepMin) ticks.push(t);
  const nowVisible = nowMin != null && nowMin >= range.startMin && nowMin <= range.endMin;
  const hoverVisible = hoverMin != null && hoverMin >= range.startMin && hoverMin <= range.endMin;
  return (
    <div className="relative" style={{ height: `${heightPx}px` }}>
      <div className="absolute inset-0 pointer-events-none">
        {ticks.map((t) => {
          const left = ((t - range.startMin) / total) * 100;
          const isStrong = t % 120 === 0;
          return (
            <span
              key={t}
              className={cn(
                "absolute top-0 bottom-0 border-l",
                isStrong ? "border-slate-700/60" : "border-slate-800/40",
              )}
              style={{ left: `${left}%` }}
            />
          );
        })}
        {hoverVisible && (
          <span
            className="absolute top-0 bottom-0 border-l-2 border-sky-400/60"
            style={{ left: `${((hoverMin! - range.startMin) / total) * 100}%` }}
          />
        )}
        {nowVisible && (
          <span
            className="absolute top-0 bottom-0 border-l-2 border-rose-500/80"
            style={{ left: `${((nowMin! - range.startMin) / total) * 100}%` }}
          />
        )}
      </div>
      {empty ? (
        <p className="absolute inset-0 flex items-center text-[11px] text-slate-500 px-1">
          {empty}
        </p>
      ) : (
        children
      )}
    </div>
  );
}


/**
 * Absolut positionierter Wrapper fuer einen Pill in der Timeline.
 * Berechnet left/width aus der Zeit relativ zur globalen Range.
 */
export function TimelineSlot({
  range,
  startMin,
  endMin,
  children,
}: {
  range: TimeRange;
  startMin: number;
  endMin: number;
  children: React.ReactNode;
}) {
  const total = Math.max(1, range.endMin - range.startMin);
  const left = Math.max(0, ((startMin - range.startMin) / total) * 100);
  const widthRaw = ((endMin - startMin) / total) * 100;
  const width = Math.max(2, Math.min(100 - left, widthRaw));
  return (
    <div
      className="absolute top-0 bottom-0"
      style={{ left: `${left}%`, width: `${width}%`, paddingRight: "3px" }}
    >
      {children}
    </div>
  );
}


/**
 * Zeitachsen-Header: zeigt eine Skala mit Stunden-Tick-Marken oberhalb
 * der Timeline-Zeilen. Beispiel: 10:00 | 12:00 | 14:00 | 16:00 | 18:00 | 20:00.
 * Wird mit derselben Range gerendert wie die Pills, damit die Tick-Positionen
 * exakt zu den Pills passen.
 */
export function TimelineAxis({ range }: { range: TimeRange }) {
  const { nowMin } = useContext(SlotOverviewUIContext);
  const total = Math.max(1, range.endMin - range.startMin);
  // Stuendliche Ticks, alle 2h stark markiert.
  const tickStepMin = 60;
  const ticks: number[] = [];
  const firstTick = Math.ceil(range.startMin / tickStepMin) * tickStepMin;
  for (let t = firstTick; t <= range.endMin; t += tickStepMin) {
    ticks.push(t);
  }
  const nowVisible = nowMin != null && nowMin >= range.startMin && nowMin <= range.endMin;
  return (
    <div className="relative h-5">
      {ticks.map((t) => {
        const left = ((t - range.startMin) / total) * 100;
        const isStrong = t % 120 === 0;
        return (
          <span
            key={t}
            className={cn(
              "absolute top-0 -translate-x-1/2 text-[10px] font-mono tabular-nums",
              isStrong ? "text-slate-400 font-semibold" : "text-slate-600",
            )}
            style={{ left: `${left}%` }}
          >
            {minutesToTimeString(t)}
          </span>
        );
      })}
      {nowVisible && (
        <span
          className="absolute -top-0.5 -translate-x-1/2 text-[9px] font-mono tabular-nums bg-rose-500/90 text-white px-1 rounded-sm shadow"
          style={{ left: `${((nowMin! - range.startMin) / total) * 100}%` }}
        >
          {minutesToTimeString(nowMin!)}
        </span>
      )}
    </div>
  );
}

export function SlotOverviewSection({
  data,
  currentDate,
  onPick,
  onBlockSlot,
  onUnblockSlot,
  blockBusyKey,
}: {
  data: SlotOverviewData;
  /** Datum des Monitors (YYYY-MM-DD), wird ans Overlay weitergereicht. */
  currentDate: string;
  onPick: (payload: SlotOverviewPickPayload) => void;
  onBlockSlot?: (serviceId: number, slot: SlotOverviewSlot) => void;
  onUnblockSlot?: (blockId: number, busyKey: string) => void;
  blockBusyKey?: string | null;
}) {
  const { summary, services } = data;
  // Saisonale / nicht-heute-buchbare Services werden ausgeblendet (z.B.
  // Ferienkurs erst im Juli, Anfaengerkurs nur am Wochenende). Falls fuer
  // den Service heute aber doch schon EMP-Tickets verkauft wurden, zeigen
  // wir ihn trotzdem - so verschwinden die Buchungen nicht aus der
  // Auslastungssicht.
  const visible = services.filter(
    (sv) => sv.availableToday || sv.totalEmpBookings > 0,
  );
  if (visible.length === 0) return null;
  // Top-Level: manuell kuratierte Lift-/Bereich-Reihenfolge (siehe
  // MANUAL_GROUP_ORDER). Innerhalb jeder Gruppe die bestehende
  // Service-Gruppierung.
  //
  // Resource-Header werden pro Gruppe entschieden:
  //   - >=2 Service-Gruppen: Header zeigen ("Seilbahn A" enthaelt
  //     "Oeffentlicher Betrieb" + "Exklusive Bahnmiete A" -> Header sinnvoll).
  //   - 1 Service-Gruppe + Name-Match: Header weglassen ("Strandbad"-
  //     Gruppe enthaelt nur 1 Service-Gruppe "Strandbad" -> Header waere
  //     reine Doppel-Info).
  const range = computeGlobalRange(visible);
  const nowMin = useCurrentMinuteIfToday(currentDate);
  const [hoverMin, setHoverMin] = useState<number | null>(null);
  const uiState = useMemo<SlotOverviewUIState>(
    () => ({ nowMin, hoverMin, setHoverMin, onBlockSlot, onUnblockSlot, blockBusyKey }),
    [nowMin, hoverMin, onBlockSlot, onUnblockSlot, blockBusyKey],
  );
  const resourceGroups = groupByResource(visible);
  const groupedPerResource = resourceGroups.map((rg) => {
    const serviceGroups = groupOverviewServices(rg.services);
    let showHeader = serviceGroups.length >= 2;
    if (!showHeader && serviceGroups.length === 1) {
      const onlyName = serviceGroups[0].group.toLowerCase();
      const resName = rg.resourceName.toLowerCase();
      const namesAreSimilar =
        onlyName === resName
        || onlyName.startsWith(resName)
        || resName.startsWith(onlyName);
      showHeader = !namesAreSimilar;
    }
    return { ...rg, serviceGroups, showHeader };
  });
  const anyHeader = groupedPerResource.some((rg) => rg.showHeader);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Clock className="h-4 w-4 text-sky-400" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-sky-400">
          Slot-Auslastung
        </h2>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
          {summary.totalSlots > 0 && (
            <>
              <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-1.5 py-0.5">
                {summary.freeSlots} frei
              </span>
              {summary.partialSlots > 0 && (
                <span className="text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-1.5 py-0.5">
                  {summary.partialSlots} teils
                </span>
              )}
              {summary.fullSlots > 0 && (
                <span className="text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-md px-1.5 py-0.5">
                  {summary.fullSlots} voll
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <SlotOverviewUIContext.Provider value={uiState}>
      <div
        className={cn(
          "rounded-xl border border-slate-800/70 bg-slate-900/40 p-3",
          anyHeader ? "space-y-4" : "space-y-3",
        )}
      >
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm -mx-3 -mt-3 px-3 pt-3 pb-1 border-b border-slate-800/40">
          <div className="flex items-stretch gap-2 text-[11px]">
            <div className="shrink-0 w-[130px]" />
            <div className="flex-1 min-w-0">
              <TimelineAxis range={range} />
            </div>
          </div>
        </div>
        {groupedPerResource.map(
          ({ resourceId, resourceName, services: resSvcs, serviceGroups, showHeader }) => (
            <div key={resourceId ?? "__none__"} className="space-y-3">
              {showHeader && (
                <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-sky-300/90 border-b border-sky-500/20 pb-1">
                  <Mountain className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span>{resourceName}</span>
                  <span className="text-[10px] font-normal normal-case tracking-normal text-slate-500">
                    · {resSvcs.length} {resSvcs.length === 1 ? "Service" : "Services"}
                  </span>
                </div>
              )}
              <div className="space-y-3">
                {serviceGroups.map(({ group, members }) => (
                  <SlotOverviewGroup
                    key={group}
                    group={group}
                    members={members}
                    range={range}
                    currentDate={currentDate}
                    onPick={onPick}
                  />
                ))}
              </div>
            </div>
          ),
        )}
      </div>
      </SlotOverviewUIContext.Provider>
    </div>
  );
}


/**
 * Eine Gruppe (= Services mit gemeinsamem Praefix). Wenn die Gruppe
 * nur EIN Mitglied hat, rendern wir kompakt ohne Sub-Bullet. Sonst Header
 * mit Gruppen-Namen + Aggregat-Verkaufszahl, darunter pro Variante eine
 * Zeile mit Variant-Name + optional Slot-Pills.
 */
export function SlotOverviewGroup({
  group,
  members,
  range,
  currentDate,
  onPick,
}: {
  group: string;
  members: SlotOverviewService[];
  range: TimeRange;
  currentDate: string;
  onPick: (payload: SlotOverviewPickPayload) => void;
}) {
  const totalEmp = members.reduce((a, m) => a + m.totalEmpBookings, 0);
  const allDay = members.every((m) => m.serviceType === "day");

  // Einzel-Service: kompakter Header ohne Sub-Bullet (Variant-Name landet im
  // Header). Verhalten wie vor der Gruppierung, fuer "Strandbad - Tageskarte"
  // ohne weitere Geschwister. Der Header ist klickbar fuer Day-Pass-
  // Services (oeffnet Add-Ticket-Overlay) - bei Slot-Services klickt der
  // User unten auf die Slot-Pills.
  const isMulti = members.length > 1;
  const variantLabels = members.map(
    (m) => splitServiceLabel(m.name, group).variant || m.name,
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
        <Ticket className="h-3 w-3 shrink-0 text-sky-400" />
        <span className="font-semibold truncate shrink-0">{group}</span>
        {/* Varianten-Namen explizit listen statt nur "· N Varianten" - so
            sieht der User auf einen Blick welche Tickets in der Gruppe
            stecken (z.B. "Tageskarte · Abendkarte"). In den einzelnen
            Service-Zeilen unten ist die linke Spalte deshalb leer, damit
            das Label nicht doppelt erscheint. */}
        {variantLabels.some((v) => v) && (
          <span className="text-[10px] text-slate-500 font-normal normal-case tracking-normal truncate">
            · {variantLabels.join(" · ")}
          </span>
        )}
        {totalEmp > 0 && (
          <span className="text-[10px] bg-slate-700/50 text-slate-300 px-1.5 py-0.5 rounded ml-auto shrink-0">
            {totalEmp} verkauft
          </span>
        )}
      </div>
      {/* Kein zusaetzlicher Indent bei Multi-Gruppen - die Timelines bleiben
          so vertikal aligned mit der globalen Zeit-Axis und der Heatmap. */}
      <div className="space-y-1.5">
        {isMulti && allDay ? (
          // Mehrere Day-Pass-Varianten: stacked Stripes in EINER Zeile, damit
          // man Tageskarte + Abendkarte (Strandbad), Tageskarte + Stundenkarte
          // (Aquapark) oder 1h/2h/Tageskarte (Oeffentlicher Betrieb) visuell
          // als ineinanderliegende Zeitbereiche erkennt.
          <CombinedDayPassRow
            group={group}
            members={members}
            range={range}
            currentDate={currentDate}
            onPick={onPick}
          />
        ) : (
          members.map((sv) => (
            <SlotOverviewServiceRow
              key={sv.serviceId}
              sv={sv}
              range={range}
              currentDate={currentDate}
              onPick={onPick}
            />
          ))
        )}
      </div>
    </div>
  );
}


/**
 * Eine Zeile pro Service-Variante: [Variant-Label | Timeline | Verkaufs-
 * Counter]. Layout ist ueber alle Service-Gruppen einheitlich, damit Slots
 * mit gleicher Uhrzeit ueberall auf derselben horizontalen Position liegen.
 *
 * Bei hasSingleMember (isMulti=false) bleibt das Label leer - der Service-
 * Name steht schon im Group-Header darueber.
 */
export function SlotOverviewServiceRow({
  sv,
  range,
  currentDate,
  onPick,
}: {
  sv: SlotOverviewService;
  range: TimeRange;
  currentDate: string;
  onPick: (payload: SlotOverviewPickPayload) => void;
}) {
  const dayClickable = sv.serviceType === "day" && sv.availableToday && !sv.note;
  return (
    <div className="flex items-stretch gap-2 text-[11px]">
      {/* Linke Spalte ist leer (Spacer fuer Axis-Alignment) - die Variant-
          Namen stehen oben im Group-Header. */}
      <div className="shrink-0 w-[130px]" aria-hidden />
      <div className="flex-1 min-w-0">
        <SlotOverviewServiceBody
          sv={sv}
          range={range}
          currentDate={currentDate}
          onPick={onPick}
          onDayClick={
            dayClickable
              ? () => onPick({ serviceId: sv.serviceId, slotDate: currentDate })
              : undefined
          }
        />
      </div>
    </div>
  );
}


/**
 * Kombiniert mehrere Day-Pass / DayPass-aehnliche Varianten einer Service-
 * Gruppe in EINER Zeile mit vertikal gestackten Stripes. Beispiele:
 *
 *   Strandbad - Tageskarte + Abendkarte:
 *     [────── Tageskarte 10:00-20:00 ──────]
 *                        [── Abend 18-20 ──]
 *
 *   Aquapark - Tageskarte + Stundenkarte:
 *     [────── Tageskarte 10:00-20:00 ──────]
 *     [────── Stundenkarte 10-20 ──────]    (gleiche Range)
 *
 * Jede Variante hat ihre eigene Farbe. Pills sind klickbar (oeffnen Add-
 * Ticket-Overlay fuer die jeweilige Variante).
 */
export function CombinedDayPassRow({
  group,
  members,
  range,
  currentDate,
  onPick,
}: {
  group: string;
  members: SlotOverviewService[];
  range: TimeRange;
  currentDate: string;
  onPick: (payload: SlotOverviewPickPayload) => void;
}) {
  // Schluessel-Funktion zum Erkennen identischer Period-Footprints: wenn
  // alle Varianten dieselbe Oeffnungszeit haben (typisch fuer Aquapark
  // Tageskarte/Stundenkarte oder Oeffentlicher Betrieb 1h/2h/Tageskarte),
  // brauchen wir nur EINEN Pill statt N gestackter Stripes.
  const periodKey = (sv: SlotOverviewService): string => {
    if (sv.openingHours.length === 0) return "__FALLBACK__";
    return sv.openingHours.map((p) => `${p.start}|${p.end}`).join(",");
  };
  const allSameRange = useMemo(
    () => members.every((sv) => periodKey(sv) === periodKey(members[0])),
    [members],
  );

  // Sortiere Members: laengste Range zuerst. Wichtig fuer Stack-Mode -
  // damit liegt die Tageskarte als "Background-Bar" hinter der kuerzeren
  // Abendkarte.
  const sorted = useMemo(() => {
    const periodLen = (sv: SlotOverviewService): number => {
      if (sv.openingHours.length === 0) return range.endMin - range.startMin;
      let total = 0;
      for (const oh of sv.openingHours) {
        const s = timeStringToMinutes(oh.start);
        const e = timeStringToMinutes(oh.end);
        if (s != null && e != null) total += Math.max(0, e - s);
      }
      return total;
    };
    return [...members].sort((a, b) => periodLen(b) - periodLen(a));
  }, [members, range]);

  const totalBookings = members.reduce((s, sv) => s + sv.totalEmpBookings, 0);

  // Berechnet den Zeitraum, in dem ALLE Varianten gleichzeitig
  // verkaufbar sind (Intersection der einzelnen Öffnungszeiten).
  //   Beispiel Öffentlicher Betrieb:
  //     1 Stunde      = 10:00-20:00   (ANNY Service-Period)
  //     2 Stunden     = 10:00-20:00
  //     Tageskarte    = 12:00-20:00
  //   -> Intersection = 12:00-20:00     (die "echte" Öffnungszeit der Gruppe)
  // Wenn die Intersection leer ist (z.B. komplett disjoint), fallen wir
  // auf den Stack-Layered-Pfad weiter unten zurueck, damit zumindest
  // alle Periods sichtbar bleiben.
  const intersection = useMemo<{ start: string; end: string } | null>(() => {
    let latestStart: number | null = null;
    let earliestEnd: number | null = null;
    for (const m of members) {
      if (m.openingHours.length === 0) return null;
      let memberStart = Infinity;
      let memberEnd = -Infinity;
      for (const oh of m.openingHours) {
        const s = timeStringToMinutes(oh.start);
        const e = timeStringToMinutes(oh.end);
        if (s != null && s < memberStart) memberStart = s;
        if (e != null && e > memberEnd) memberEnd = e;
      }
      if (memberStart === Infinity || memberEnd === -Infinity) return null;
      if (latestStart == null || memberStart > latestStart) latestStart = memberStart;
      if (earliestEnd == null || memberEnd < earliestEnd) earliestEnd = memberEnd;
    }
    if (latestStart == null || earliestEnd == null || latestStart >= earliestEnd) return null;
    return {
      start: minutesToTimeString(latestStart),
      end: minutesToTimeString(earliestEnd),
    };
  }, [members]);

  // Wenn alle Varianten dieselbe Range haben: 1 Pill (im Slot-Pill-Stil)
  // mit zusammengefasstem Label.
  if (allSameRange) {
    const primary = sorted[0];
    const periods =
      primary.openingHours.length > 0
        ? primary.openingHours
        : [
            {
              start: minutesToTimeString(range.startMin),
              end: minutesToTimeString(range.endMin),
            },
          ];
    const isFallback = primary.openingHours.length === 0;
    const variantNames = sorted.map(
      (sv) => splitServiceLabel(sv.name, group).variant || sv.name,
    );
    return (
      <div className="flex items-stretch gap-2 text-[11px]">
        {/* Linke Spalte: leer (Spacer). Variant-Namen stehen oben im
            Group-Header, hier wuerde sie sonst doppelt erscheinen. */}
        <div className="shrink-0 w-[130px]" aria-hidden />
        <div className="flex-1 min-w-0">
          <SlotTimeline range={range}>
            {periods.map((oh, pidx) => {
              const startMin = timeStringToMinutes(oh.start) ?? range.startMin;
              const endMin = timeStringToMinutes(oh.end) ?? range.endMin;
              return (
                <TimelineSlot
                  key={`combined-${pidx}`}
                  range={range}
                  startMin={startMin}
                  endMin={endMin}
                >
                  <CombinedPill
                    startLabel={oh.start}
                    endLabel={oh.end}
                    tooltip={`${variantNames.join(" + ")} · ${oh.start}-${oh.end} · ${totalBookings} verkauft`}
                    onClick={() =>
                      primary.availableToday
                      && onPick({ serviceId: primary.serviceId, slotDate: currentDate })
                    }
                    disabled={!primary.availableToday}
                    isFallback={isFallback}
                    bookingCount={totalBookings}
                  />
                </TimelineSlot>
              );
            })}
          </SlotTimeline>
        </div>
      </div>
    );
  }

  // Unterschiedliche Ranges, aber es gibt eine Intersection: zeige nur
  // einen Pill, der genau diesen "alle gleichzeitig verkaufbar"-Bereich
  // markiert. Der Tooltip listet die einzelnen ANNY-Periods auf, damit
  // man falsch gepflegte Service-Schedules schnell erkennt.
  if (intersection) {
    const primary = sorted[0];
    const detail = sorted
      .map((sv) => {
        const v = splitServiceLabel(sv.name, group).variant || sv.name;
        if (sv.openingHours.length === 0) return `${v}: keine Period`;
        const ranges = sv.openingHours
          .map((oh) => `${oh.start}-${oh.end}`)
          .join(", ");
        return `${v}: ${ranges}`;
      })
      .join(" | ");
    return (
      <div className="flex items-stretch gap-2 text-[11px]">
        <div className="shrink-0 w-[130px]" aria-hidden />
        <div className="flex-1 min-w-0">
          <SlotTimeline range={range}>
            <TimelineSlot
              range={range}
              startMin={timeStringToMinutes(intersection.start) ?? range.startMin}
              endMin={timeStringToMinutes(intersection.end) ?? range.endMin}
            >
              <CombinedPill
                startLabel={intersection.start}
                endLabel={intersection.end}
                tooltip={`Schnittmenge aller Varianten: ${intersection.start}-${intersection.end} · ${totalBookings} verkauft\n\nANNY-Periods:\n${detail}`}
                onClick={() =>
                  primary.availableToday
                  && onPick({ serviceId: primary.serviceId, slotDate: currentDate })
                }
                disabled={!primary.availableToday}
                isFallback={false}
                bookingCount={totalBookings}
              />
            </TimelineSlot>
          </SlotTimeline>
        </div>
      </div>
    );
  }

  // Letzter Fallback: disjoint Ranges (sehr selten). Ueberlagernde Pills,
  // laengster Pill im Hintergrund (z=0), kuerzere darueber.
  const variantStyles = [
    "border-sky-500/50 text-sky-100 bg-sky-500/15",
    "border-emerald-500/60 text-emerald-100 bg-emerald-500/25",
    "border-violet-500/60 text-violet-100 bg-violet-500/25",
    "border-amber-500/60 text-amber-100 bg-amber-500/25",
  ];

  return (
    <div className="flex items-stretch gap-2 text-[11px]">
      {/* Linke Spalte: leer (Spacer). Die Variant-Namen stehen oben im
          Group-Header; die Pills tragen Variante + Zeit als Tooltip und
          Farbcode visuell. */}
      <div className="shrink-0 w-[130px]" aria-hidden />
      <div className="flex-1 min-w-0">
        <SlotTimeline range={range}>
          {sorted.flatMap((sv, idx) => {
            const { variant } = splitServiceLabel(sv.name, group);
            const periods =
              sv.openingHours.length > 0
                ? sv.openingHours
                : [
                    {
                      start: minutesToTimeString(range.startMin),
                      end: minutesToTimeString(range.endMin),
                    },
                  ];
            const styleCls = variantStyles[idx % variantStyles.length];
            const isFallback = sv.openingHours.length === 0;
            return periods.map((oh, pidx) => {
              const startMin = timeStringToMinutes(oh.start) ?? range.startMin;
              const endMin = timeStringToMinutes(oh.end) ?? range.endMin;
              return (
                <TimelineSlot
                  key={`${sv.serviceId}-${pidx}`}
                  range={range}
                  startMin={startMin}
                  endMin={endMin}
                >
                  <button
                    type="button"
                    onClick={() =>
                      sv.availableToday
                      && onPick({ serviceId: sv.serviceId, slotDate: currentDate })
                    }
                    disabled={!sv.availableToday}
                    title={`${variant || sv.name}: ${oh.start}-${oh.end} · ${sv.totalEmpBookings} verkauft`}
                    className={cn(
                      "relative overflow-hidden rounded-lg border h-full w-full px-1.5 py-1 text-[11px] font-mono tabular-nums leading-tight",
                      "hover:brightness-125 active:scale-95 transition-all",
                      styleCls,
                      isFallback && "border-dashed",
                      sv.availableToday ? "" : "opacity-50 cursor-not-allowed",
                    )}
                    style={{ zIndex: idx + 1 }}
                  >
                    <span className="relative flex items-center justify-center gap-1 h-full truncate">
                      <span className="font-bold">{oh.start}-{oh.end}</span>
                    </span>
                  </button>
                </TimelineSlot>
              );
            });
          })}
        </SlotTimeline>
      </div>
    </div>
  );
}


/**
 * Pill fuer "alle Varianten haben dieselbe Range"-Fall. Look-and-feel der
 * normalen Slot-Pills (rounded-lg border, full height), aber in sky-color
 * statt rose/amber/emerald, weil es kein Slot-Status sondern eine reine
 * Oeffnungszeit-Anzeige ist.
 */
export function CombinedPill({
  startLabel,
  endLabel,
  tooltip,
  onClick,
  disabled,
  isFallback,
  bookingCount,
}: {
  startLabel: string;
  endLabel: string;
  tooltip: string;
  onClick?: () => void;
  disabled?: boolean;
  isFallback: boolean;
  /** Anzahl EMP-Tickets in diesem Period (optional). Wird als Badge sichtbar. */
  bookingCount?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        "relative overflow-hidden rounded-lg border h-full w-full px-1.5 py-1 text-[11px] font-mono tabular-nums leading-tight",
        "border-sky-500/40 text-sky-100 bg-sky-500/10",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:brightness-125 active:scale-95 transition-all",
        isFallback && "border-dashed",
      )}
    >
      <span className="relative flex items-center justify-center gap-1 h-full">
        <span className="font-bold shrink-0">{startLabel}-{endLabel}</span>
        {bookingCount != null && bookingCount > 0 && (
          <span
            className="shrink-0 inline-flex items-center rounded-sm bg-sky-500/40 text-sky-50 px-1 text-[10px] font-bold leading-tight tabular-nums"
            title={`${bookingCount} EMP-Ticket(s)`}
          >
            {bookingCount}
          </span>
        )}
      </span>
    </button>
  );
}


/**
 * Body eines einzelnen Service in der Auslastungs-Section: Note (falls
 * ANNY-Match fehlt), Tageskarten-Hinweis oder Slot-Pill-Reihe.
 */
export function SlotOverviewServiceBody({
  sv,
  range,
  currentDate,
  onPick,
  onDayClick,
}: {
  sv: SlotOverviewService;
  range: TimeRange;
  currentDate: string;
  onPick: (payload: SlotOverviewPickPayload) => void;
  /** Click-Handler fuer Day-Pass-Services (gibt es keinen Slot zum Klicken). */
  onDayClick?: () => void;
}) {
  if (sv.note) {
    return (
      <SlotTimeline range={range}>
        <p className="absolute inset-0 flex items-center text-[11px] text-amber-400/80 px-1 truncate">
          {sv.note}
        </p>
      </SlotTimeline>
    );
  }
  if (sv.serviceType === "day") {
    // Day-Pass: 1 grosser Pill ueber die Oeffnungszeit. Wenn ANNY keine
    // Periods liefert, nutzen wir den globalen Range als Fallback und
    // markieren den Pill als gestrichelt (Hinweis: unsichere Range).
    // Visueller Stil identisch mit CombinedPill aus der Multi-Day-Gruppe,
    // damit ein einzelner Day-Pass-Service (z.B. Ferienkurs) nicht
    // anders aussieht als die Strandbad-/Aquapark-Combined-Pills.
    const periods =
      sv.openingHours.length > 0
        ? sv.openingHours
        : sv.availableToday
          ? [
              {
                start: minutesToTimeString(range.startMin),
                end: minutesToTimeString(range.endMin),
              },
            ]
          : [];
    if (periods.length === 0) {
      return <SlotTimeline range={range} empty="Heute nicht verfügbar." />;
    }
    const isFallback = sv.openingHours.length === 0;
    return (
      <SlotTimeline range={range}>
        {periods.map((oh, idx) => {
          const startMin = timeStringToMinutes(oh.start) ?? range.startMin;
          const endMin = timeStringToMinutes(oh.end) ?? range.endMin;
          return (
            <TimelineSlot
              key={`${sv.serviceId}-day-${idx}`}
              range={range}
              startMin={startMin}
              endMin={endMin}
            >
              <CombinedPill
                startLabel={oh.start}
                endLabel={oh.end}
                tooltip={`${sv.name} · ${oh.start}-${oh.end} · ${sv.totalEmpBookings} verkauft`}
                onClick={onDayClick}
                disabled={!onDayClick || !sv.availableToday}
                isFallback={isFallback}
                bookingCount={sv.totalEmpBookings}
              />
            </TimelineSlot>
          );
        })}
      </SlotTimeline>
    );
  }
  if (sv.slots.length === 0) {
    return <SlotTimeline range={range} empty="Keine Slots heute." />;
  }
  return (
    <SlotTimeline range={range}>
      {sv.slots.map((slot) => {
        const startMin = timeStringToMinutes(slot.startTime);
        const endMin = timeStringToMinutes(slot.endTime);
        if (startMin == null || endMin == null) return null;
        return (
          <TimelineSlot
            key={`${sv.serviceId}-${slot.startTime}`}
            range={range}
            startMin={startMin}
            endMin={endMin}
          >
            <SlotOverviewPill
              slot={slot}
              serviceId={sv.serviceId}
              onClick={() =>
                onPick({
                  serviceId: sv.serviceId,
                  slotDate: currentDate,
                  slotStart: slot.startTime,
                  slotEnd: slot.endTime,
                })
              }
            />
          </TimelineSlot>
        );
      })}
    </SlotTimeline>
  );
}


/**
 * Einzelner Slot-Pill in der Auslastungssicht. Hintergrundbalken zeigt
 * den belegten Anteil. Pill-Farbe nach Buchungsstand: gruen = frei (keine
 * Buchung), amber = teilweise gebucht, rose = ausgebucht.
 */
export function SlotOverviewPill({
  slot,
  serviceId,
  onClick,
}: {
  slot: SlotOverviewSlot;
  serviceId: number;
  onClick: () => void;
}) {
  const { setHoverMin, onBlockSlot, onUnblockSlot, blockBusyKey } =
    useContext(SlotOverviewUIContext);
  const slotStartMin = timeStringToMinutes(slot.startTime);
  const isManuallyBlocked = slot.blockId != null;
  const busy = blockBusyKey === `${serviceId}|${slot.startTime.slice(0, 5)}`;
  // Belegte Plaetze: ANNY-Auslastung (capacity-remaining) ODER lokale EMP-
  // Tickets, je nachdem was hoeher ist. EMP-Verkaeufe am Schalter sind ANNY
  // evtl. noch unbekannt, sollen die Auslastung aber trotzdem widerspiegeln.
  const annyUsed =
    slot.capacity != null && slot.remaining != null
      ? Math.max(0, slot.capacity - slot.remaining)
      : 0;
  const used = Math.max(annyUsed, slot.empBookings);
  // Restkapazitaet: bei bekannter Kapazitaet aus belegten Plaetzen, sonst
  // ANNY-remaining. null = Kapazitaet unbekannt (z.B. exklusive Bahnmiete,
  // bei der ANNY capacity/remaining ausblendet).
  const effectiveRemaining =
    slot.capacity != null ? Math.max(0, slot.capacity - used) : slot.remaining;
  // Ausgebucht (rot): manuell gesperrt, von ANNY blockiert, keine Restplaetze
  // mehr, ODER ein exklusiver Slot (Kapazitaet unbekannt) mit mind. einer
  // Buchung (exklusive Resourcen sind nach erster Buchung belegt).
  const isFull =
    isManuallyBlocked
    || !slot.available
    || (effectiveRemaining != null && effectiveRemaining <= 0)
    || (slot.capacity == null && slot.remaining == null && slot.empBookings > 0);
  // Teilweise belegt (gelb): nicht ausgebucht, aber mindestens eine Buchung.
  const isPartial = !isFull && used > 0;
  // Auslastungsbalken im Hintergrund.
  const pct =
    isFull
      ? 100
      : slot.capacity != null && slot.capacity > 0
        ? Math.max(0, Math.min(100, (used / slot.capacity) * 100))
        : null;
  const baseColor = isFull
    ? "border-rose-500/50 text-rose-100 bg-rose-500/15"
    : isPartial
      ? "border-amber-500/50 text-amber-100 bg-amber-500/15"
      : "border-emerald-500/50 text-emerald-100 bg-emerald-500/15";
  const fillColor = isFull
    ? "bg-rose-500/30"
    : isPartial
      ? "bg-amber-500/30"
      : "bg-emerald-500/25";
  // Konsistent immer "X frei" zeigen (statt mehrdeutigem "1/10" das wie
  // "1 verkauft" gelesen wird). Bei 0 oder blockiert: "voll".
  const label = isManuallyBlocked
    ? "Gesperrt"
    : isFull
    ? annyReasonLabel(slot.unavailabilityType ?? undefined) || "voll"
    : effectiveRemaining != null
      ? `${effectiveRemaining} frei`
      : "";
  // Hinweis wenn lokale EMP-Tickets die ANNY-Restkapazitaet uebersteigen
  // (z.B. manuell angelegte Gaeste). Macht Diskrepanz im Tooltip transparent.
  const overbookHint =
    slot.capacity != null && slot.remaining != null
      ? slot.empBookings > slot.capacity - slot.remaining
      : false;
  const canToggleBlock = Boolean(onBlockSlot && onUnblockSlot);
  return (
    <div className="relative h-full w-full">
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => slotStartMin != null && setHoverMin(slotStartMin)}
      onMouseLeave={() => setHoverMin(null)}
      onFocus={() => slotStartMin != null && setHoverMin(slotStartMin)}
      onBlur={() => setHoverMin(null)}
      title={(() => {
        const lines: string[] = [];
        lines.push(`${slot.startTime}–${slot.endTime}`);
        lines.push(`Status: ${slot.available ? "verfuegbar" : "blockiert"}`);
        if (slot.unavailabilityType) {
          lines.push(`Grund: ${slot.unavailabilityType}`);
        }
        if (slot.capacity != null) {
          lines.push(`Kapazitaet (ANNY): ${slot.remaining ?? "?"} von ${slot.capacity} frei`);
        } else {
          lines.push(`Kapazitaet (ANNY): ${slot.remaining ?? "unbekannt"}`);
        }
        lines.push(`EMP-Tickets: ${slot.empBookings}`);
        if (overbookHint) {
          lines.push(`! EMP-Tickets > ANNY-belegt (lokal mehr Tickets als ANNY weiss)`);
        }
        if (isManuallyBlocked) {
          lines.push(`Manuell gesperrt${slot.blockReason ? ` (${slot.blockReason})` : ""}`);
        }
        return lines.join("\n");
      })()}
      className={cn(
        "relative overflow-hidden rounded-lg border h-full w-full px-1.5 py-1 text-[11px] font-mono tabular-nums leading-tight",
        "hover:brightness-125 active:scale-95 transition-all",
        canToggleBlock && "pr-5",
        baseColor,
      )}
    >
      {pct != null && (
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0", fillColor)}
          style={{ width: `${pct}%` }}
        />
      )}
      <span className="relative flex items-center justify-center gap-1 h-full">
        <span className="font-bold shrink-0">{slot.startTime}</span>
        {label && <span className="opacity-90 truncate min-w-0">{label}</span>}
        {slot.empBookings > 0 && (
          <span
            className={cn(
              "shrink-0 inline-flex items-center rounded-sm px-1 text-[10px] font-bold leading-tight tabular-nums",
              overbookHint
                ? "bg-rose-500/50 text-white"
                : "bg-sky-500/40 text-sky-50",
            )}
            title={`${slot.empBookings} EMP-Ticket(s) in diesem Slot`}
          >
            {slot.empBookings}
          </span>
        )}
      </span>
    </button>
      {canToggleBlock && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (busy) return;
            if (isManuallyBlocked) {
              onUnblockSlot!(slot.blockId!, `${serviceId}|${slot.startTime.slice(0, 5)}`);
            } else {
              onBlockSlot!(serviceId, slot);
            }
          }}
          disabled={busy}
          title={isManuallyBlocked ? "Sperre aufheben" : "Slot sperren"}
          className={cn(
            "absolute top-0.5 right-0.5 z-10 inline-flex items-center justify-center rounded-md p-0.5",
            "transition-colors disabled:opacity-60",
            isManuallyBlocked
              ? "text-rose-300 hover:text-rose-100 hover:bg-rose-500/30"
              : "text-slate-400 hover:text-rose-200 hover:bg-rose-500/20",
          )}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isManuallyBlocked ? (
            <Lock className="h-3 w-3" />
          ) : (
            <LockOpen className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}
