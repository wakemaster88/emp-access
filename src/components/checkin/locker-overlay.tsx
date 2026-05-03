"use client";

/**
 * Vollbild-Overlay für die Schließfach-Verwaltung im Shop-/Checkin-Monitor.
 *
 * Zwei Ansichten in einem Overlay:
 *  1) Liste – Filter (Alle / Belegt / Frei) + Suche, große Tap-Targets.
 *  2) Detail – Mieter zuordnen oder Schlüssel ausgeben/zurücknehmen.
 *
 * Datenlieferant ist /api/checkin/public/[token]/lockers (GET) und
 * /lockers/[id]/rental (POST upsert / DELETE) – damit greift dieselbe
 * Tenant-Auflösung über den Monitor-Token wie bei den anderen Overlays.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Loader2, Search, X, Lock, Key, MapPin, Hash, ChevronLeft,
  Ticket as TicketIcon, CreditCard, ArrowRightCircle, ArrowLeftCircle,
  Trash2, Check, AlertTriangle, RefreshCw, User,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LockerType = "KEY" | "PADLOCK";

interface PickerTicket {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  status: string;
  endDate: string | null;
  profileImage: string | null;
  subscription: { id: number; name: string } | null;
}

interface LockerRentalApi {
  id: number;
  year: number;
  /// Optional: bei manuellen Mietern ist `ticketId` null und `renterName` gesetzt.
  ticketId: number | null;
  renterName: string | null;
  keysIssued: number;
  keysReturned: number;
  issuedAt: string | null;
  returnedAt: string | null;
  notes: string | null;
  ticket: PickerTicket | null;
}

interface LockerApi {
  id: number;
  name: string;
  number: string;
  location: string | null;
  notes: string | null;
  lockType: LockerType;
  keyCount: number;
  lockNumber: string | null;
  rentals: LockerRentalApi[];
}

interface ApiResponse {
  year: number;
  lockers: LockerApi[];
  tickets: PickerTicket[];
}

interface LockerOverlayProps {
  token: string;
  onClose: () => void;
}

function ticketDisplayName(t: PickerTicket): string {
  return [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
}

/// Anzeigename einer Vermietung: Ticket bevorzugt, dann manueller Name, dann Fallback.
function rentalDisplayName(r: { ticket: PickerTicket | null; renterName: string | null }): string {
  if (r.ticket) return ticketDisplayName(r.ticket);
  if (r.renterName?.trim()) return r.renterName.trim();
  return "Unbekannt";
}

function itemLabel(lockType: LockerType, plural: boolean): string {
  if (lockType === "PADLOCK") return plural ? "Vorhängeschlösser" : "Vorhängeschloss";
  return "Schlüssel";
}

function todayIso(): string {
  return new Date().toISOString();
}

export function LockerOverlay({ token, onClose }: LockerOverlayProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "assigned" | "free" | "openKeys">("all");
  const [activeId, setActiveId] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/checkin/public/${token}/lockers`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(false); }, [load]);

  const lockers = data?.lockers ?? [];
  const year = data?.year ?? new Date().getFullYear();

  const enriched = useMemo(() => {
    return lockers.map((l) => {
      const current = l.rentals.find((r) => r.year === year) ?? null;
      const past = l.rentals.filter((r) => r.year !== year);
      const openPast = past
        .filter((r) => r.keysIssued - r.keysReturned > 0)
        .sort((a, b) => b.year - a.year);
      const openPastCount = openPast.reduce(
        (acc, r) => acc + (r.keysIssued - r.keysReturned),
        0,
      );
      return { ...l, current, openPast, openPastCount };
    });
  }, [lockers, year]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((l) => {
      if (filter === "assigned" && !l.current) return false;
      if (filter === "free" && l.current) return false;
      if (filter === "openKeys" && l.openPast.length === 0) return false;
      if (!q) return true;
      const hay = [
        l.name, l.number, l.location ?? "", l.notes ?? "", l.lockNumber ?? "",
        l.current ? rentalDisplayName(l.current) : "",
        l.current?.ticket?.subscription?.name ?? "",
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, search, filter]);

  const assignedCount = enriched.filter((l) => l.current).length;
  const freeCount = lockers.length - assignedCount;
  const openKeyLockers = enriched.filter((l) => l.openPast.length > 0);
  const openKeyCount = openKeyLockers.reduce((acc, l) => acc + l.openPastCount, 0);

  const active = activeId != null ? enriched.find((l) => l.id === activeId) ?? null : null;

  function handleSavedRental(updated: LockerRentalApi | null) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lockers: prev.lockers.map((l) => {
          if (l.id !== activeId) return l;
          const others = l.rentals.filter((r) => r.year !== year);
          return { ...l, rentals: updated ? [updated, ...others] : others };
        }),
      };
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl w-full sm:max-w-2xl max-h-[92dvh] flex flex-col pb-[env(safe-area-inset-bottom)] monitor-scrollbar overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {active && (
              <button
                onClick={() => setActiveId(null)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-95"
                title="Zurück"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <h2 className="text-lg font-bold flex items-center gap-2 truncate">
              <Lock className="h-5 w-5 text-indigo-400 shrink-0" />
              {active ? (
                <>
                  <span className="font-mono">#{active.number}</span>
                  <span className="text-slate-400 truncate">· {active.name}</span>
                </>
              ) : (
                <>Schließfächer <span className="text-slate-500 text-sm font-normal">· {year}</span></>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white active:scale-95"
              title="Aktualisieren"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </button>
            <button
              onClick={onClose}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white active:scale-95"
              title="Schließen"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto monitor-scrollbar">
          {loading && !data && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
            </div>
          )}
          {error && (
            <div className="m-4 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300 text-sm px-4 py-3 inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {!loading && data && !active && (
            <ListView
              lockers={filtered}
              total={lockers.length}
              assignedCount={assignedCount}
              freeCount={freeCount}
              openKeyLockers={openKeyLockers}
              openKeyCount={openKeyCount}
              filter={filter}
              setFilter={setFilter}
              search={search}
              setSearch={setSearch}
              onPick={(id) => setActiveId(id)}
            />
          )}

          {!loading && data && active && (
            <DetailView
              token={token}
              year={year}
              locker={active}
              tickets={data.tickets}
              onSaved={handleSavedRental}
              onError={setError}
              onPastUpdated={(rental) => {
                setData((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    lockers: prev.lockers.map((l) => {
                      if (l.id !== activeId) return l;
                      return {
                        ...l,
                        rentals: l.rentals.map((r) => (r.id === rental.id ? rental : r)),
                      };
                    }),
                  };
                });
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── List ───────── */

function ListView({
  lockers, total, assignedCount, freeCount, openKeyLockers, openKeyCount,
  filter, setFilter, search, setSearch, onPick,
}: {
  lockers: (LockerApi & { current: LockerRentalApi | null; openPast: LockerRentalApi[]; openPastCount: number })[];
  total: number;
  assignedCount: number;
  freeCount: number;
  openKeyLockers: (LockerApi & { current: LockerRentalApi | null; openPast: LockerRentalApi[]; openPastCount: number })[];
  openKeyCount: number;
  filter: "all" | "assigned" | "free" | "openKeys";
  setFilter: (f: "all" | "assigned" | "free" | "openKeys") => void;
  search: string;
  setSearch: (s: string) => void;
  onPick: (id: number) => void;
}) {
  return (
    <div className="p-4 space-y-3">
      {openKeyLockers.length > 0 && (
        <button
          type="button"
          onClick={() => setFilter("openKeys")}
          className="w-full text-left rounded-xl border border-amber-700/50 bg-amber-950/30 hover:bg-amber-950/40 p-3 transition-colors active:scale-[0.99]"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-amber-200">
              <p className="text-sm font-semibold">
                {openKeyCount} {openKeyCount === 1 ? "Schlüssel" : "Schlüssel/Schlösser"} aus früheren Jahren offen
              </p>
              <p className="text-[11px] text-amber-200/80 truncate">
                {openKeyLockers.slice(0, 4).map((l) => {
                  const r = l.openPast[0];
                  return `#${l.number} ${rentalDisplayName(r)} (${r.year})`;
                }).join(" · ")}
                {openKeyLockers.length > 4 && ` · +${openKeyLockers.length - 4}`}
              </p>
            </div>
          </div>
        </button>
      )}

      <div className={cn("grid gap-1.5", openKeyLockers.length > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        <FilterChip label={`Alle ${total}`} active={filter === "all"} color="indigo" onClick={() => setFilter("all")} />
        <FilterChip label={`Belegt ${assignedCount}`} active={filter === "assigned"} color="emerald" onClick={() => setFilter("assigned")} />
        <FilterChip label={`Frei ${freeCount}`} active={filter === "free"} color="slate" onClick={() => setFilter("free")} />
        {openKeyLockers.length > 0 && (
          <FilterChip
            label={`Offen ${openKeyLockers.length}`}
            active={filter === "openKeys"}
            color="amber"
            onClick={() => setFilter("openKeys")}
          />
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nr., Standort, Mieter, Abo…"
          className="w-full bg-slate-800/60 border border-slate-700/50 text-white rounded-xl pl-9 pr-9 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {lockers.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-12">Keine Treffer.</p>
        )}
        {lockers.map((l) => {
          const t = l.current?.ticket ?? null;
          const manualName = !t && l.current?.renterName ? l.current.renterName : null;
          const open = l.current ? l.current.keysIssued - l.current.keysReturned : 0;
          const allBack = l.current ? open <= 0 : false;
          return (
            <button
              key={l.id}
              onClick={() => onPick(l.id)}
              className="w-full text-left rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-800 p-3 active:scale-[0.99] transition-all flex items-center gap-3"
            >
              <div className={cn(
                "h-12 w-14 rounded-lg flex flex-col items-center justify-center shrink-0 font-mono text-sm font-bold tabular-nums",
                l.current
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "bg-slate-700/40 text-slate-400 border border-slate-700"
              )}>
                <span className="text-xs leading-none opacity-70">Nr.</span>
                <span className="leading-tight">{l.number}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                  {l.name}
                  <span
                    className="text-[10px] inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-700/60 text-slate-400 tabular-nums"
                    title={l.lockType === "KEY"
                      ? `Schlüsselschloss · ${l.keyCount} Schlüssel`
                      : `Vorhängeschloss · ${l.keyCount} Stück`}
                  >
                    {l.lockType === "KEY" ? <Key className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                    {l.keyCount}×
                  </span>
                </p>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate">
                  {l.location && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" />
                      {l.location}
                    </span>
                  )}
                  {l.lockType === "KEY" && l.lockNumber && (
                    <span className="font-mono">Schloss {l.lockNumber}</span>
                  )}
                </div>
                {t ? (
                  <div className="mt-1 flex items-center gap-1.5 min-w-0">
                    <TicketIcon className="h-3 w-3 text-violet-400 shrink-0" />
                    <span className="text-xs text-slate-200 truncate">{ticketDisplayName(t)}</span>
                    {t.subscription && (
                      <span className="text-[10px] text-emerald-300 inline-flex items-center gap-0.5 shrink-0">
                        <CreditCard className="h-2.5 w-2.5" />
                        {t.subscription.name}
                      </span>
                    )}
                  </div>
                ) : manualName ? (
                  <div className="mt-1 flex items-center gap-1.5 min-w-0">
                    <User className="h-3 w-3 text-amber-400 shrink-0" />
                    <span className="text-xs text-slate-200 truncate">{manualName}</span>
                    <span className="text-[10px] text-amber-300/80 inline-flex items-center gap-0.5 shrink-0">
                      <User className="h-2.5 w-2.5" />
                      Manuell
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-500 italic">Frei</p>
                )}
                {l.openPast.length > 0 && (
                  <div className="mt-1 flex items-start gap-1 text-[10px] text-amber-300 leading-tight">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
                    <span className="min-w-0">
                      <span className="font-semibold">Offen:</span>{" "}
                      {l.openPast.slice(0, 2).map((r, i) => (
                        <span key={r.id}>
                          {i > 0 && ", "}
                          <span className="font-mono tabular-nums">{r.year}</span>{" "}
                          {rentalDisplayName(r)}{" "}
                          <span className="opacity-70">({r.keysIssued - r.keysReturned})</span>
                        </span>
                      ))}
                      {l.openPast.length > 2 && (
                        <span className="opacity-70"> +{l.openPast.length - 2}</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
              {l.current && l.current.keysIssued > 0 && (
                <span
                  className={cn(
                    "shrink-0 text-[11px] tabular-nums px-2 py-1 rounded-lg font-mono inline-flex items-center gap-1",
                    allBack
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  )}
                >
                  {l.lockType === "KEY" ? <Key className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {l.current.keysReturned}/{l.current.keysIssued}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({
  label, active, color, onClick,
}: {
  label: string;
  active: boolean;
  color: "indigo" | "emerald" | "slate" | "amber";
  onClick: () => void;
}) {
  const cls = active
    ? color === "emerald"
      ? "bg-emerald-600 text-white"
      : color === "slate"
        ? "bg-slate-600 text-white"
        : color === "amber"
          ? "bg-amber-600 text-white"
          : "bg-indigo-600 text-white"
    : color === "amber"
      ? "bg-amber-950/40 text-amber-300 hover:bg-amber-950/60 border border-amber-800/60"
      : "bg-slate-800/60 text-slate-400 hover:bg-slate-800";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("h-10 rounded-xl text-sm font-semibold transition-colors active:scale-95", cls)}
    >
      {label}
    </button>
  );
}

/* ───────── Detail ───────── */

function DetailView({
  token, year, locker, tickets, onSaved, onError, onPastUpdated,
}: {
  token: string;
  year: number;
  locker: LockerApi & { current: LockerRentalApi | null; openPast: LockerRentalApi[] };
  tickets: PickerTicket[];
  onSaved: (rental: LockerRentalApi | null) => void;
  onError: (msg: string) => void;
  onPastUpdated: (rental: LockerRentalApi) => void;
}) {
  const current = locker.current;
  const openPast = locker.openPast;
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(!current);
  const [search, setSearch] = useState("");

  // Lokale Werkbank für Ausgabe/Rücknahme – sync mit Server bei Speichern.
  const [keysIssued, setKeysIssued] = useState(current?.keysIssued ?? 0);
  const [keysReturned, setKeysReturned] = useState(current?.keysReturned ?? 0);
  const [issuedAt, setIssuedAt] = useState<string | null>(current?.issuedAt ?? null);
  const [returnedAt, setReturnedAt] = useState<string | null>(current?.returnedAt ?? null);
  // Mieter-Modus + Eingabe: bei keinem aktuellen Mieter starten wir im Ticket-Modus,
  // ansonsten im Modus, der zur aktuellen Vermietung passt.
  const [pickerMode, setPickerMode] = useState<"ticket" | "manual">(
    current?.renterName && !current.ticket ? "manual" : "ticket",
  );
  const [manualName, setManualName] = useState(current?.renterName ?? "");

  useEffect(() => {
    setKeysIssued(current?.keysIssued ?? 0);
    setKeysReturned(current?.keysReturned ?? 0);
    setIssuedAt(current?.issuedAt ?? null);
    setReturnedAt(current?.returnedAt ?? null);
    setPickerOpen(!current);
    setPickerMode(current?.renterName && !current.ticket ? "manual" : "ticket");
    setManualName(current?.renterName ?? "");
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!current && (
    keysIssued !== current.keysIssued ||
    keysReturned !== current.keysReturned ||
    issuedAt !== current.issuedAt ||
    returnedAt !== current.returnedAt
  );

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? tickets.filter((t) => {
          const hay = [
            ticketDisplayName(t),
            t.ticketTypeName ?? "",
            t.subscription?.name ?? "",
            t.name,
          ].join(" ").toLowerCase();
          return hay.includes(q);
        })
      : tickets;
    return list.slice(0, 200);
  }, [tickets, search]);

  async function persist(payload: Record<string, unknown> | null) {
    setBusy(true);
    onError("");
    try {
      const res = payload === null
        ? await fetch(`/api/checkin/public/${token}/lockers/${locker.id}/rental`, { method: "DELETE" })
        : await fetch(`/api/checkin/public/${token}/lockers/${locker.id}/rental`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        onError(typeof j?.error === "string" ? j.error : `Server-Fehler (${res.status})`);
        return false;
      }
      if (payload === null) {
        onSaved(null);
      } else {
        const j = await res.json();
        onSaved(j.rental as LockerRentalApi);
      }
      return true;
    } catch (err) {
      onError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function assignTicket(t: PickerTicket) {
    const ok = await persist({
      ticketId: t.id,
      // Beim Wechsel zu einem Ticket etwaigen manuellen Namen leeren.
      renterName: null,
      keysIssued: 0,
      keysReturned: 0,
      issuedAt: null,
      returnedAt: null,
    });
    if (ok) setPickerOpen(false);
  }

  /// Manueller Name als Mieter ohne Abo-Ticket-Verknuepfung.
  async function assignManual(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await persist({
      ticketId: null,
      renterName: trimmed,
      keysIssued: 0,
      keysReturned: 0,
      issuedAt: null,
      returnedAt: null,
    });
    if (ok) setPickerOpen(false);
  }

  /// Aktuellen Mieter beibehalten – egal ob Ticket oder manueller Name.
  function currentRenterPayload(): { ticketId: number | null; renterName: string | null } {
    return {
      ticketId: current?.ticketId ?? null,
      renterName: current?.renterName ?? null,
    };
  }

  async function saveKeyChanges() {
    if (!current) return;
    await persist({
      ...currentRenterPayload(),
      keysIssued,
      keysReturned,
      issuedAt: issuedAt,
      returnedAt: returnedAt,
    });
  }

  async function quickIssue() {
    if (!current) return;
    const target = Math.max(keyCount(locker), 1);
    setKeysIssued(target);
    setIssuedAt(todayIso());
    await persist({
      ...currentRenterPayload(),
      keysIssued: target,
      keysReturned,
      issuedAt: todayIso(),
      returnedAt,
    });
  }
  async function quickReturn() {
    if (!current) return;
    setKeysReturned(keysIssued);
    setReturnedAt(todayIso());
    await persist({
      ...currentRenterPayload(),
      keysIssued,
      keysReturned: keysIssued,
      issuedAt,
      returnedAt: todayIso(),
    });
  }

  async function release() {
    if (!confirm(`Vermietung ${year} für Schließfach #${locker.number} wirklich aufheben?`)) return;
    await persist(null);
    setPickerOpen(true);
  }

  /// Quick-Action: alle ausstehenden Schlüssel einer Alt-Vermietung als
  /// zurückgegeben markieren (setzt keysReturned = keysIssued, returnedAt = jetzt).
  async function markPastReturned(rental: LockerRentalApi) {
    setBusy(true);
    onError("");
    try {
      const res = await fetch(
        `/api/checkin/public/${token}/lockers/${locker.id}/rentals/${rental.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keysReturned: rental.keysIssued,
            returnedAt: todayIso(),
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        onError(typeof j?.error === "string" ? j.error : `Server-Fehler (${res.status})`);
        return;
      }
      const j = await res.json();
      onPastUpdated(j.rental as LockerRentalApi);
    } catch (err) {
      onError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      {/* Locker-Header */}
      <div className="rounded-2xl bg-slate-800/40 border border-slate-800 p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            "h-16 w-16 rounded-xl flex flex-col items-center justify-center shrink-0 font-mono text-base font-bold tabular-nums",
            current
              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              : "bg-slate-700/40 text-slate-400 border border-slate-700"
          )}>
            <span className="text-[10px] leading-none opacity-70">Nr.</span>
            <span>{locker.number}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-white">{locker.name}</p>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1">
                {locker.lockType === "KEY" ? <Key className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {locker.lockType === "KEY" ? "Schlüsselschloss" : "Vorhängeschloss"}
                <span>· {locker.keyCount}×</span>
              </span>
              {locker.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {locker.location}
                </span>
              )}
              {locker.lockType === "KEY" && locker.lockNumber && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <Hash className="h-3 w-3" />
                  Schloss {locker.lockNumber}
                </span>
              )}
            </div>
            {locker.notes && (
              <p className="mt-1 text-[11px] text-slate-500 truncate">{locker.notes}</p>
            )}
          </div>
        </div>
      </div>

      {/* Warnung: Alt-Vermietungen mit offenen Schlüsseln */}
      {openPast.length > 0 && (
        <div className="rounded-2xl border border-amber-700/60 bg-amber-950/20 p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-200 inline-flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            Schlüssel aus früheren Jahren noch offen
          </p>
          <ul className="space-y-1.5">
            {openPast.map((r) => {
              const open = r.keysIssued - r.keysReturned;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-amber-950/30 border border-amber-800/40 px-3 py-2"
                >
                  <div className="min-w-0 text-amber-100">
                    <p className="text-sm font-medium truncate">
                      <span className="font-mono tabular-nums text-amber-300">{r.year}</span>
                      <span className="mx-1.5 text-amber-400/60">·</span>
                      {rentalDisplayName(r)}
                    </p>
                    <p className="text-[11px] text-amber-200/80 inline-flex items-center gap-1">
                      {locker.lockType === "KEY"
                        ? <Key className="h-2.5 w-2.5" />
                        : <Lock className="h-2.5 w-2.5" />}
                      <span className="font-mono tabular-nums">{r.keysReturned}/{r.keysIssued}</span>
                      <span>· {open} offen</span>
                      {r.ticket?.subscription && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-emerald-300">
                          <CreditCard className="h-2.5 w-2.5" />
                          {r.ticket.subscription.name}
                        </span>
                      )}
                      {!r.ticket && r.renterName && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-amber-200/80">
                          <User className="h-2.5 w-2.5" />
                          Manuell
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => markPastReturned(r)}
                    disabled={busy}
                    className="shrink-0 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-200 px-2.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1 active:scale-95 disabled:opacity-50"
                    title="Alle als zurückgegeben markieren"
                  >
                    <ArrowLeftCircle className="h-3.5 w-3.5" />
                    Zurück
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Aktueller Mieter ODER Picker */}
      {current && !pickerOpen ? (
        <div className="rounded-2xl bg-slate-800/40 border border-slate-800 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {current.ticket?.profileImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.ticket.profileImage}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover ring-2 ring-emerald-500/30 shrink-0"
                />
              ) : current.ticket ? (
                <div className="h-12 w-12 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0">
                  <TicketIcon className="h-5 w-5" />
                </div>
              ) : (
                <div className="h-12 w-12 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0">
                  <User className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-base font-semibold text-white truncate">
                  {rentalDisplayName(current)}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                  {current.ticket?.subscription && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-300">
                      <CreditCard className="h-2.5 w-2.5" />
                      {current.ticket.subscription.name}
                    </span>
                  )}
                  {current.ticket?.ticketTypeName && (
                    <span>· {current.ticket.ticketTypeName}</span>
                  )}
                  {!current.ticket && current.renterName && (
                    <span className="inline-flex items-center gap-0.5 text-amber-300">
                      <User className="h-2.5 w-2.5" />
                      Manuell
                    </span>
                  )}
                  <span>· Vermietung {year}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setPickerOpen(true)}
              className="text-[11px] text-indigo-300 hover:text-indigo-200 underline shrink-0"
              disabled={busy}
            >
              Wechseln
            </button>
          </div>

          {/* Schlüssel-Tracking */}
          {locker.keyCount > 0 && (
            <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-300 inline-flex items-center gap-1.5">
                  {locker.lockType === "KEY"
                    ? <Key className="h-3.5 w-3.5 text-amber-400" />
                    : <Lock className="h-3.5 w-3.5 text-amber-400" />}
                  {itemLabel(locker.lockType, true)} <span className="text-slate-500 font-normal">(Soll: {locker.keyCount})</span>
                </p>
                {(() => {
                  const open = keysIssued - keysReturned;
                  if (keysIssued === 0) return <span className="text-[10px] text-slate-500">Nicht ausgegeben</span>;
                  return (
                    <span className={cn(
                      "text-[11px] font-mono px-2 py-0.5 rounded inline-flex items-center gap-1",
                      open <= 0
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-amber-500/15 text-amber-300"
                    )}>
                      {keysReturned}/{keysIssued}
                      {open <= 0 && <Check className="h-3 w-3" />}
                    </span>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={quickIssue}
                  disabled={busy}
                  className="rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 px-3 py-3 text-sm font-semibold flex flex-col items-center gap-1 active:scale-95 disabled:opacity-50"
                >
                  <ArrowRightCircle className="h-5 w-5" />
                  Ausgeben
                </button>
                <button
                  onClick={quickReturn}
                  disabled={busy || keysIssued === 0 || keysReturned >= keysIssued}
                  className="rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 px-3 py-3 text-sm font-semibold flex flex-col items-center gap-1 active:scale-95 disabled:opacity-40"
                >
                  <ArrowLeftCircle className="h-5 w-5" />
                  Zurücknehmen
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500">
                <KeyField
                  label="Ausgegeben"
                  count={keysIssued}
                  setCount={(v) => {
                    setKeysIssued(v);
                    if (keysReturned > v) setKeysReturned(v);
                  }}
                  date={issuedAt}
                  setDate={setIssuedAt}
                  max={20}
                />
                <KeyField
                  label="Zurückgegeben"
                  count={keysReturned}
                  setCount={(v) => setKeysReturned(Math.min(keysIssued, v))}
                  date={returnedAt}
                  setDate={setReturnedAt}
                  max={keysIssued}
                />
              </div>

              {dirty && (
                <button
                  onClick={saveKeyChanges}
                  disabled={busy}
                  className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Manuelle Änderungen speichern
                </button>
              )}
            </div>
          )}

          <button
            onClick={release}
            disabled={busy}
            className="w-full rounded-xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-rose-300 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Vermietung {year} aufheben
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-800/40 border border-slate-800 p-4 space-y-3">
          <p className="text-xs text-slate-400">
            {current
              ? <>Aktueller Mieter: <strong className="text-slate-200">{rentalDisplayName(current)}</strong>. Wähle einen anderen Mieter oder brich ab.</>
              : <>Wähle einen Mieter für <strong>{year}</strong> – per Abo-Ticket oder als manuell eingegebener Name.</>}
          </p>

          {/* Modus-Switch zwischen Abo-Ticket und manuellem Namen. */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setPickerMode("ticket")}
              className={cn(
                "rounded-xl py-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors active:scale-95",
                pickerMode === "ticket"
                  ? "bg-violet-600 text-white"
                  : "bg-slate-900/60 text-slate-400 hover:bg-slate-900 border border-slate-700/50",
              )}
            >
              <TicketIcon className="h-3.5 w-3.5" />
              Abo-Ticket
            </button>
            <button
              type="button"
              onClick={() => setPickerMode("manual")}
              className={cn(
                "rounded-xl py-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors active:scale-95",
                pickerMode === "manual"
                  ? "bg-amber-600 text-white"
                  : "bg-slate-900/60 text-slate-400 hover:bg-slate-900 border border-slate-700/50",
              )}
            >
              <User className="h-3.5 w-3.5" />
              Manueller Name
            </button>
          </div>

          {pickerMode === "manual" ? (
            <div className="space-y-2">
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="z. B. Familie Mustermann"
                autoFocus
                className="w-full bg-slate-900/60 border border-slate-700/50 text-white rounded-xl px-3 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
              <button
                type="button"
                onClick={() => assignManual(manualName)}
                disabled={busy || !manualName.trim()}
                className="w-full rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700/60 disabled:text-slate-500 text-white py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-95"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Mieter speichern
              </button>
              <p className="text-[10px] text-slate-500 leading-snug">
                Manuelle Mieter sind nicht mit einem Abo-Ticket verknüpft – Schlüssel-Tracking
                und Historie bleiben aber erhalten.
              </p>
            </div>
          ) : (
          <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mieter, Abo, Tickettyp suchen…"
              className="w-full bg-slate-900/60 border border-slate-700/50 text-white rounded-xl pl-9 pr-9 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-[40vh] overflow-y-auto monitor-scrollbar -mx-1 px-1">
            {filteredTickets.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-6">Keine passenden Tickets.</p>
            )}
            {filteredTickets.map((t) => {
              const isCur = current?.ticketId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => assignTicket(t)}
                  disabled={busy || isCur}
                  className={cn(
                    "w-full text-left rounded-xl border p-2.5 flex items-center gap-2.5 transition-colors",
                    isCur
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 cursor-default"
                      : "bg-slate-900/40 border-slate-800 hover:bg-slate-800 active:scale-[0.99] text-white"
                  )}
                >
                  {t.profileImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.profileImage} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-slate-700 shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0">
                      <TicketIcon className="h-4 w-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ticketDisplayName(t)}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 truncate">
                      {t.subscription && (
                        <span className="inline-flex items-center gap-0.5 text-emerald-300">
                          <CreditCard className="h-2.5 w-2.5" />
                          {t.subscription.name}
                        </span>
                      )}
                      {t.ticketTypeName && <span>· {t.ticketTypeName}</span>}
                    </div>
                  </div>
                  {isCur && <span className="text-[10px] shrink-0">aktuell</span>}
                </button>
              );
            })}
          </div>
          </>
          )}
          {current && (
            <button
              onClick={() => setPickerOpen(false)}
              disabled={busy}
              className="w-full rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 text-sm active:scale-95"
            >
              Abbrechen
            </button>
          )}
        </div>
      )}

      {busy && (
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Speichere…
        </div>
      )}
    </div>
  );
}

function KeyField({
  label, count, setCount, date, setDate, max,
}: {
  label: string;
  count: number;
  setCount: (v: number) => void;
  date: string | null;
  setDate: (d: string | null) => void;
  max: number;
}) {
  const dateInputValue = date ? toDateInput(date) : "";
  return (
    <div className="space-y-1">
      <span className="block">{label}</span>
      <div className="flex gap-1">
        <input
          type="number"
          min={0}
          max={max}
          value={count}
          onChange={(e) => setCount(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
          className="w-12 bg-slate-900 border border-slate-700 text-white rounded-lg px-1.5 py-1.5 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          type="date"
          value={dateInputValue}
          onChange={(e) => setDate(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className="flex-1 min-w-0 bg-slate-900 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
    </div>
  );
}

function toDateInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function keyCount(l: LockerApi): number {
  return l.keyCount;
}
