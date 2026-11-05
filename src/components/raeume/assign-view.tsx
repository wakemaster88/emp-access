"use client";

/**
 * Tab "Ohne Raum": Geräte, Kameras und Zonen ohne Raum, gruppiert nach dem
 * Ort im Namen (src/lib/room-overview.ts). Je Gruppe ein Vorschlag und eine
 * Taste "Alle zuweisen"; Einzelauswahl über Kästchen mit einer Leiste unten.
 * Ersetzt das Banner "Noch keinem Raum zugeordnet".
 */

import { useMemo, useState } from "react";
import { Cctv, Check, ChevronDown, ChevronRight, Cpu, Loader2, Plus, Sparkles, Volume2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { ErrorLine } from "@/components/raeume/shared";
import type { LooseGroup, LooseItem, NamedRoom } from "@/lib/room-overview";
import { cn } from "@/lib/utils";

const KIND_ICON = { device: Cpu, camera: Cctv, zone: Volume2 } as const;

/** Kästchen in einer antippbaren Zeile: der Tipp bleibt beim Kästchen. */
function PickBox({ checked, mixed, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  return (
    <Checkbox
      checked={mixed && !checked ? "indeterminate" : checked}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={onChange}
    />
  );
}

export function AssignView({
  groups,
  rooms,
  readonly,
  onAssign,
  onCreateRoom,
}: {
  groups: LooseGroup[];
  rooms: NamedRoom[];
  readonly: boolean;
  /** Weist die Elemente dem Raum zu; Fehlertext oder null. */
  onAssign: (items: LooseItem[], roomId: number) => Promise<string | null>;
  /** Legt einen Raum an und gibt seine ID zurück; null bei Fehler (Meldung über onAssign-Pfad). */
  onCreateRoom: (name: string) => Promise<{ id: number } | { error: string }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map((g) => g.label)));
  const [target, setTarget] = useState<number | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const all = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const byKey = useMemo(() => new Map(all.map((i) => [i.key, i])), [all]);
  const total = all.length;
  const countByKind = (kind: LooseItem["kind"]) => all.filter((i) => i.kind === kind).length;
  const selectedItems = [...selected].map((k) => byKey.get(k)).filter((i): i is LooseItem => !!i);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleGroup(g: LooseGroup) {
    const allIn = g.items.every((i) => selected.has(i.key));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of g.items) {
        if (allIn) next.delete(i.key);
        else next.add(i.key);
      }
      return next;
    });
  }
  function toggleOpen(label: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function assign(items: LooseItem[], roomId: number, busyKey: string) {
    if (readonly || items.length === 0) return;
    setBusy(busyKey);
    setError("");
    const msg = await onAssign(items, roomId);
    setBusy(null);
    if (msg) setError(msg);
    else setSelected((prev) => new Set([...prev].filter((k) => !items.some((i) => i.key === k))));
  }

  async function createAndAssign(g: LooseGroup) {
    if (readonly) return;
    setBusy(`create:${g.label}`);
    setError("");
    const res = await onCreateRoom(g.label);
    if ("error" in res) {
      setBusy(null);
      setError(res.error);
      return;
    }
    const msg = await onAssign(g.items, res.id);
    setBusy(null);
    if (msg) setError(msg);
  }

  if (total === 0) {
    return (
      <section className="glass-card flex items-center gap-3 border-dashed p-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
        <span>
          <span className="block text-sm font-semibold">Alle Geräte sind zugeordnet.</span>
          <span className="block text-xs text-muted-foreground">Neue Geräte landen wieder hier.</span>
        </span>
      </section>
    );
  }

  return (
    <div className="space-y-4 pb-20">
      <section className="glass-card p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-base font-semibold">
            Ohne Raum <span className="text-sm font-normal text-muted-foreground">· {total} Elemente</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {countByKind("device")} Geräte, {countByKind("camera")} Kameras, {countByKind("zone")} Zonen. Erst mit Raum bekommen sie eine
            Betriebszeit und erscheinen in der Übersicht.
          </p>
        </div>
        <ErrorLine message={error} />
      </section>

      <div className="space-y-2">
        {groups.map((g) => {
          const isOpen = open.has(g.label);
          const chosen = g.items.filter((i) => selected.has(i.key)).length;
          const kinds = (["device", "camera", "zone"] as const)
            .map((k) => [k, g.items.filter((i) => i.kind === k).length] as const)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k === "device" ? "Gerät" : k === "camera" ? "Kamera" : "Zone"}${n === 1 ? "" : k === "device" ? "e" : k === "camera" ? "s" : "n"} ${n}`)
            .join(" · ");
          const busyHere = busy === `group:${g.label}` || busy === `create:${g.label}`;
          return (
            <section
              key={g.label}
              className={cn(
                "glass-tile overflow-hidden",
                g.suggestedRoom && "border-emerald-400/35",
                g.label === "Unklar" && "opacity-80",
              )}
            >
              <div
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
                onClick={() => toggleOpen(g.label)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleOpen(g.label);
                  }
                }}
              >
                {!readonly && (
                  <PickBox
                    checked={chosen === g.items.length}
                    mixed={chosen > 0 && chosen < g.items.length}
                    onChange={() => toggleGroup(g)}
                    label={`Gruppe ${g.label} auswählen`}
                  />
                )}
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">
                    {g.label} <span className="font-normal text-muted-foreground">· {g.items.length}</span>
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{kinds}</span>
                </span>
                {g.suggestedRoom ? (
                  <>
                    <span className="hidden items-center gap-1 text-[11px] text-emerald-700 sm:flex dark:text-emerald-400">
                      <Sparkles className="h-3 w-3" />
                      Vorschlag: {g.suggestedRoom.name}
                    </span>
                    {!readonly && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void assign(g.items, g.suggestedRoom!.id, `group:${g.label}`);
                        }}
                        className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-3 text-[11px] font-bold text-white transition-transform enabled:active:scale-95 disabled:opacity-60"
                      >
                        {busyHere ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {g.items.length === 1 ? "Zuweisen" : `Alle ${g.items.length} zuweisen`}
                      </button>
                    )}
                  </>
                ) : g.label !== "Unklar" ? (
                  <>
                    <span className="hidden text-[11px] text-warning sm:inline">kein Raum „{g.label}“</span>
                    {!readonly && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void createAndAssign(g);
                        }}
                        className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-foreground/10 px-3 text-[11px] font-semibold transition-transform enabled:hover:bg-foreground/15 enabled:active:scale-95 disabled:opacity-60"
                      >
                        {busyHere ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Raum anlegen
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">kein Vorschlag</span>
                )}
              </div>
              {isOpen && (
                <ul className="border-t border-border/50">
                  {g.items.map((i) => {
                    const Icon = KIND_ICON[i.kind];
                    return (
                      <li key={i.key} className="flex items-center gap-3 px-3 py-1.5 pl-[22px] text-[12px] sm:pl-11">
                        {!readonly && <PickBox checked={selected.has(i.key)} onChange={() => toggle(i.key)} label={`${i.name} auswählen`} />}
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{i.name}</span>
                        <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{i.meta}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {!readonly && selectedItems.length > 0 && (
        <div className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-xl items-center gap-2 glass-card p-2 pl-4 md:bottom-6">
          <span className="text-[12px] font-semibold tabular-nums">{selectedItems.length} ausgewählt</span>
          <NativeSelect
            value={target}
            onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}
            aria-label="Zielraum"
            containerClassName="ml-auto w-auto max-w-[45%]"
          >
            <option value="">Raum wählen …</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
          <button
            type="button"
            disabled={target === "" || !!busy}
            onClick={() => target !== "" && void assign(selectedItems, target, "bar")}
            className="flex h-9 items-center gap-1 rounded-control bg-primary-fill px-3 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {busy === "bar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Zuweisen
          </button>
        </div>
      )}
    </div>
  );
}
