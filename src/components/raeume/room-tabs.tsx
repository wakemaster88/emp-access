"use client";

/**
 * Tab-Leiste im Kopf der Räume-Seite: "Übersicht" links, ein Tab je Raum,
 * "Ohne Raum" rechts. Eine schwebende Glas-Kapsel, der aktive Tab ist eine
 * helle Pille (docs/design-regeln.md, Abschnitt 6).
 *
 * Ein Tab zeigt höchstens einen Punkt (Zustand) und eine Zahl (Störungen).
 */

import { ChevronDown, ChevronUp, LayoutGrid, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabDot = "alert" | "present" | "open" | "closed" | "none";

export interface RoomTabItem {
  id: number;
  name: string;
  dot: TabDot;
  /** Anzahl Störungen; null = keine. */
  badge: number | null;
  /** Raum ohne Ausstattung: nur sichtbar, wenn aufgeklappt. */
  empty: boolean;
}

export type RoomView = { kind: "overview" } | { kind: "room"; id: number } | { kind: "assign" };

const DOT: Record<Exclude<TabDot, "none">, string> = {
  alert: "bg-destructive",
  present: "bg-violet-500 dark:bg-violet-400",
  open: "bg-emerald-500 dark:bg-emerald-400",
  closed: "bg-muted-foreground/50",
};

function TabButton({
  active,
  onClick,
  className,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap transition-all duration-200",
        active ? "glass-pill-active font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function RoomTabs({
  items,
  view,
  looseCount,
  showEmpty,
  onToggleEmpty,
  onSelect,
}: {
  items: RoomTabItem[];
  view: RoomView;
  looseCount: number;
  showEmpty: boolean;
  onToggleEmpty: () => void;
  onSelect: (view: RoomView) => void;
}) {
  const equipped = items.filter((t) => !t.empty);
  const empty = items.filter((t) => t.empty);
  const activeRoom = view.kind === "room" ? view.id : null;
  // Ein aufgerufener Raum ohne Ausstattung bleibt sichtbar, auch wenn zugeklappt.
  const visibleEmpty = showEmpty ? empty : empty.filter((t) => t.id === activeRoom);

  return (
    <div
      role="tablist"
      aria-label="Räume"
      className="glass-strip flex items-center gap-0.5 overflow-x-auto scrollbar-thin [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <TabButton active={view.kind === "overview"} onClick={() => onSelect({ kind: "overview" })} label="Übersicht">
        <LayoutGrid className="h-3.5 w-3.5" />
        <span>Übersicht</span>
      </TabButton>
      {[...equipped, ...visibleEmpty].map((t) => (
        <TabButton
          key={t.id}
          active={activeRoom === t.id}
          onClick={() => onSelect({ kind: "room", id: t.id })}
          label={t.name}
          className={cn(t.empty && "text-muted-foreground/70")}
        >
          {t.dot !== "none" && (
            <span aria-hidden className={cn("h-[7px] w-[7px] rounded-full", DOT[t.dot], t.dot === "present" && "animate-pulse")} />
          )}
          <span>{t.name}</span>
          {t.badge != null && t.badge > 0 && (
            <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold tabular-nums text-destructive">
              {t.badge}
            </span>
          )}
        </TabButton>
      ))}
      {empty.length > 0 && (
        <button
          type="button"
          onClick={onToggleEmpty}
          className="flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] text-muted-foreground/80 hover:text-foreground"
          aria-expanded={showEmpty}
        >
          {showEmpty ? "weniger" : `+ ${empty.length} ohne Ausstattung`}
          {showEmpty ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
      {(looseCount > 0 || view.kind === "assign") && (
        <TabButton
          active={view.kind === "assign"}
          onClick={() => onSelect({ kind: "assign" })}
          label={`Ohne Raum, ${looseCount} Geräte`}
          className={cn("ml-auto", view.kind !== "assign" && looseCount > 0 && "text-warning")}
        >
          <PackageOpen className="h-3.5 w-3.5" />
          <span>Ohne Raum</span>
          {looseCount > 0 && (
            <span className="rounded-full bg-warning/15 px-1.5 text-[10px] font-semibold tabular-nums text-warning">{looseCount}</span>
          )}
        </TabButton>
      )}
    </div>
  );
}
