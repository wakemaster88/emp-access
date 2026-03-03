"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ScanLine,
  Users,
  Ticket,
  CreditCard,
  Camera,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  X,
  Package,
  Fingerprint,
  Image as ImageIcon,
  CalendarDays,
  Printer,
} from "lucide-react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { cn } from "@/lib/utils";

interface TicketExtra {
  name: string;
  quantity: number;
}

interface CheckinTicket {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  status: string;
  validityType: string;
  slotStart: string | null;
  slotEnd: string | null;
  validityDurationMinutes: number | null;
  firstScanAt: string | null;
  startDate: string | null;
  endDate: string | null;
  profileImage: string | null;
  rfidCode: string | null;
  barcode: string | null;
  qrCode: string | null;
  uuid: string | null;
  extras: TicketExtra[] | null;
  source: string | null;
  subscriptionId: number | null;
  serviceId: number | null;
  accessAreaId: number | null;
  checkedIn: boolean;
  accessArea?: { id: number; name: string } | null;
  subscription?: { id: number; name: string; requiresPhoto?: boolean; requiresRfid?: boolean } | null;
  service?: { id: number; name: string; requiresPhoto?: boolean; requiresRfid?: boolean; allowManualCheckin?: boolean } | null;
  _count?: { scans: number };
}

interface SubData {
  id: number;
  name: string;
  requiresPhoto: boolean;
  requiresRfid: boolean;
  tickets: CheckinTicket[];
}

interface ScanEntry {
  id: number;
  code: string;
  result: string;
  scanTime: string;
  ticketId: number | null;
  device: { id: number; name: string } | null;
}

interface CheckinData {
  monitorName: string;
  accountName: string;
  date: string;
  tickets: CheckinTicket[];
  subscriptions: SubData[];
  services: { id: number; name: string }[];
  areas: { id: number; name: string }[];
  recentScans: ScanEntry[];
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function personName(t: { firstName: string | null; lastName: string | null; name: string }): string {
  return [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
}

export default function CheckinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<CheckinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [date, setDate] = useState(toDateStr(new Date()));
  const [selectedTicket, setSelectedTicket] = useState<CheckinTicket | null>(null);
  const [scanMode, setScanMode] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [scanResult, setScanResult] = useState<{ found: boolean; ticket?: CheckinTicket; message?: string } | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanBubble, setScanBubble] = useState("");
  const [checkingIn, setCheckingIn] = useState<number | null>(null);
  const [updatingTicket, setUpdatingTicket] = useState<number | null>(null);
  const [rfidInput, setRfidInput] = useState("");
  const [editMode, setEditMode] = useState<"photo" | "rfid" | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanBufferRef = useRef("");
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownScanIdsRef = useRef<Set<number>>(new Set());
  const [scanHighlights, setScanHighlights] = useState<Map<number, string>>(new Map());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/checkin/public/${token}?date=${date}`);
      if (!res.ok) {
        setError("Check-in Monitor nicht gefunden");
        return;
      }
      const json: CheckinData = await res.json();

      const newScans = json.recentScans.filter((s) => !knownScanIdsRef.current.has(s.id));
      if (knownScanIdsRef.current.size > 0 && newScans.length > 0) {
        const highlights = new Map<number, string>();
        for (const s of newScans) {
          if (s.ticketId) highlights.set(s.ticketId, s.result);
        }
        if (highlights.size > 0) {
          setScanHighlights((prev) => {
            const next = new Map(prev);
            for (const [k, v] of highlights) next.set(k, v);
            return next;
          });
          setTimeout(() => {
            setScanHighlights((prev) => {
              const next = new Map(prev);
              for (const k of highlights.keys()) next.delete(k);
              return next;
            });
          }, 4000);
        }
      }
      for (const s of json.recentScans) knownScanIdsRef.current.add(s.id);

      setData(json);
      setError("");
    } catch {
      setError("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  }, [token, date]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    pollRef.current = setInterval(fetchData, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  const handleScanRef = useRef<((code: string) => void) | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Enter") {
        const code = scanBufferRef.current.trim();
        scanBufferRef.current = "";
        if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
        if (code.length >= 3) {
          setScanBubble("");
          handleScanRef.current?.(code);
        }
        return;
      }

      if (e.key.length === 1) {
        scanBufferRef.current += e.key;
        setScanBubble(scanBufferRef.current);
        if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
        scanTimerRef.current = setTimeout(() => {
          scanBufferRef.current = "";
          setScanBubble("");
        }, 500);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleCheckin = useCallback(async (ticketId: number) => {
    setCheckingIn(ticketId);
    try {
      const res = await fetch(`/api/checkin/public/${token}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      const json = await res.json();
      if (json.success) {
        await fetchData();
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket((prev) => prev ? { ...prev, checkedIn: true, status: "REDEEMED" } : null);
        }
      }
    } finally {
      setCheckingIn(null);
    }
  }, [token, fetchData, selectedTicket]);

  const handleScan = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setScanLoading(true);
    try {
      const res = await fetch(`/api/checkin/public/${token}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      setScanResult(json);
      if (json.found && json.ticket) {
        setSelectedTicket(json.ticket);
        setScanMode(false);
      }
    } finally {
      setScanLoading(false);
      setScanInput("");
    }
  }, [token]);

  useEffect(() => { handleScanRef.current = handleScan; }, [handleScan]);

  const [rfidConflict, setRfidConflict] = useState<{
    ticketId: number;
    rfidCode: string;
    existingOwner: string;
    existingType: string | null;
  } | null>(null);

  const handleUpdateTicket = useCallback(async (ticketId: number, update: { profileImage?: string; rfidCode?: string }, force?: boolean) => {
    setUpdatingTicket(ticketId);
    try {
      const res = await fetch(`/api/checkin/public/${token}/update`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, ...update, force }),
      });
      const json = await res.json();

      if (res.status === 409 && json.conflict && update.rfidCode) {
        setRfidConflict({
          ticketId,
          rfidCode: update.rfidCode,
          existingOwner: json.existingOwner,
          existingType: json.existingType,
        });
        setUpdatingTicket(null);
        return;
      }

      setRfidConflict(null);
      await fetchData();
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket((prev) => prev ? { ...prev, ...update } : null);
      }
    } finally {
      setUpdatingTicket(null);
      setEditMode(null);
    }
  }, [token, fetchData, selectedTicket]);

  const handleCameraCapture = useCallback((dataUrl: string) => {
    if (!selectedTicket) return;
    setCameraOpen(false);
    setEditMode("photo");
    handleUpdateTicket(selectedTicket.id, { profileImage: dataUrl });
  }, [selectedTicket, handleUpdateTicket]);

  const dayTickets = data?.tickets ?? [];
  const subscriptions = data?.subscriptions ?? [];

  const { upcoming, checkedInTickets, pendingTickets } = useMemo(() => {
    const now = new Date();
    const berlinStr = now.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    const [ch, cm] = berlinStr.split(":").map(Number);
    const nowMin = ch * 60 + cm;

    const upcoming: CheckinTicket[] = [];
    const checked: CheckinTicket[] = [];
    const pending: CheckinTicket[] = [];

    for (const t of dayTickets.filter((t) => !t.subscriptionId)) {
      if (t.checkedIn || t.status === "REDEEMED") {
        checked.push(t);
        continue;
      }
      if (t.slotStart) {
        const [sh, sm] = t.slotStart.split(":").map(Number);
        const slotMin = sh * 60 + sm;
        if (slotMin >= nowMin && slotMin <= nowMin + 60) {
          upcoming.push(t);
          continue;
        }
      }
      pending.push(t);
    }

    upcoming.sort((a, b) => (a.slotStart ?? "").localeCompare(b.slotStart ?? ""));
    return { upcoming, checkedInTickets: checked, pendingTickets: pending };
  }, [dayTickets]);

  const serviceGroups = useMemo(() => {
    const groups = new Map<string, CheckinTicket[]>();
    for (const t of pendingTickets) {
      const key = t.service?.name ?? t.subscription?.name ?? t.ticketTypeName ?? "Sonstige";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return groups;
  }, [pendingTickets]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <p className="text-rose-400 text-lg">{error}</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3 flex items-center justify-between safe-top">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="EMP Access" className="h-9 w-9 shrink-0" />
          <div>
            <h1 className="text-lg font-bold tracking-tight">{data?.monitorName ?? "Check-in"}</h1>
            <p className="text-[11px] text-slate-400">EMP Access — Check-in Monitor</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {scanBubble && (
            <div className="bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 px-3 py-1.5 rounded-xl text-xs font-mono animate-pulse flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5" />
              {scanBubble}
            </div>
          )}
          <button
            onClick={() => setScanMode(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <ScanLine className="h-5 w-5" />
            Scannen
          </button>
          <LiveClock />
        </div>
      </header>

      {/* Day selector */}
      <DaySelector date={date} onChange={setDate} />

      {/* Stats bar */}
      <div className="px-4 py-2 flex gap-3 border-b border-slate-800/50">
        <StatPill icon={Users} label="Gesamt" value={dayTickets.filter((t) => !t.subscriptionId).length} />
        <StatPill icon={CheckCircle2} label="Eingecheckt" value={checkedInTickets.length} color="emerald" />
        <StatPill icon={Clock} label="Ausstehend" value={pendingTickets.length + upcoming.length} color="amber" />
        <StatPill icon={CreditCard} label="Abos" value={subscriptions.reduce((a, s) => a + s.tickets.length, 0)} color="violet" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-safe">
        {/* Upcoming */}
        {upcoming.length > 0 && (
          <Section title="Nächste Gäste" icon={Clock} count={upcoming.length} color="amber">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {upcoming.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  onTap={() => setSelectedTicket(t)}
                  onCheckin={t.service?.allowManualCheckin !== false ? () => handleCheckin(t.id) : undefined}
                  checkingIn={checkingIn === t.id}
                  highlight={scanHighlights.get(t.id)}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Tickets by service */}
        <Section title="Tickets" icon={Ticket} count={pendingTickets.length} color="indigo">
          {pendingTickets.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">Keine ausstehenden Tickets</p>
          ) : (
            <div className="space-y-3">
              {[...serviceGroups.entries()].map(([groupName, tickets]) => (
                <div key={groupName}>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-1">{groupName}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {tickets.map((t) => (
                      <TicketCard
                        key={t.id}
                        ticket={t}
                        onTap={() => setSelectedTicket(t)}
                        onCheckin={t.service?.allowManualCheckin !== false ? () => handleCheckin(t.id) : undefined}
                        checkingIn={checkingIn === t.id}
                        highlight={scanHighlights.get(t.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Checked in */}
        {checkedInTickets.length > 0 && (
          <Section title="Eingecheckt" icon={CheckCircle2} count={checkedInTickets.length} color="emerald">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {checkedInTickets.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  onTap={() => setSelectedTicket(t)}
                  checked
                  highlight={scanHighlights.get(t.id)}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Subscriptions */}
        {subscriptions.some((s) => s.tickets.length > 0) && (
          <Section title="Abonnements" icon={CreditCard} count={subscriptions.reduce((a, s) => a + s.tickets.length, 0)} color="violet">
            <div className="space-y-3">
              {subscriptions.filter((s) => s.tickets.length > 0).map((sub) => (
                <div key={sub.id}>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-1">{sub.name}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {sub.tickets.map((t) => (
                      <TicketCard
                        key={t.id}
                        ticket={{ ...t, subscription: { id: sub.id, name: sub.name, requiresPhoto: sub.requiresPhoto, requiresRfid: sub.requiresRfid } }}
                        onTap={() => setSelectedTicket({ ...t, subscription: { id: sub.id, name: sub.name, requiresPhoto: sub.requiresPhoto, requiresRfid: sub.requiresRfid } })}
                        isSub
                        highlight={scanHighlights.get(t.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Ticket detail overlay */}
      {selectedTicket && !cameraOpen && (
        <TicketOverlay
          ticket={selectedTicket}
          onClose={() => { setSelectedTicket(null); setEditMode(null); setRfidInput(""); }}
          onCheckin={() => handleCheckin(selectedTicket.id)}
          checkingIn={checkingIn === selectedTicket.id}
          editMode={editMode}
          setEditMode={setEditMode}
          rfidInput={rfidInput}
          setRfidInput={setRfidInput}
          onSaveRfid={(code?: string) => handleUpdateTicket(selectedTicket.id, { rfidCode: code ?? rfidInput })}
          onOpenCamera={() => setCameraOpen(true)}
          updatingTicket={updatingTicket === selectedTicket.id}
          accountName={data?.accountName ?? ""}
          rfidConflict={rfidConflict?.ticketId === selectedTicket.id ? rfidConflict : null}
          onForceRfid={() => { if (rfidConflict) { handleUpdateTicket(rfidConflict.ticketId, { rfidCode: rfidConflict.rfidCode }, true); } }}
          onCancelRfid={() => setRfidConflict(null)}
          ticketScans={(data?.recentScans ?? []).filter((s) => s.ticketId === selectedTicket.id)}
        />
      )}

      {cameraOpen && (
        <CameraOverlay
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* Scan overlay */}
      {scanMode && (
        <ScanOverlay
          scanInput={scanInput}
          setScanInput={setScanInput}
          onScan={handleScan}
          scanLoading={scanLoading}
          scanResult={scanResult}
          onClose={() => { setScanMode(false); setScanResult(null); setScanInput(""); }}
          inputRef={scanInputRef}
        />
      )}
    </div>
  );
}

/* ──── Sub-components ──── */

function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-sm font-mono font-bold text-slate-300 tabular-nums bg-slate-800 px-3 py-2 rounded-xl">{time}</span>;
}

function DaySelector({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(date);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const days = useMemo(() => {
    const result: { date: string; label: string; isToday: boolean }[] = [];
    const today = new Date();
    for (let i = -2; i <= 4; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const ds = toDateStr(d);
      result.push({
        date: ds,
        label: d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }),
        isToday: i === 0,
      });
    }
    return result;
  }, []);

  const calDays = useMemo(() => {
    const { year, month } = calMonth;
    const first = new Date(year, month, 1);
    const startDay = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rows: (Date | null)[][] = [];
    let row: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) row.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      row.push(new Date(year, month, d));
      if (row.length === 7) { rows.push(row); row = []; }
    }
    if (row.length > 0) {
      while (row.length < 7) row.push(null);
      rows.push(row);
    }
    return rows;
  }, [calMonth]);

  const todayStr = toDateStr(new Date());
  const selectedDate = new Date(date);
  const monthLabel = new Date(calMonth.year, calMonth.month).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  return (
    <>
      <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-800 overflow-x-auto">
        <button onClick={() => { const d = new Date(date); d.setDate(d.getDate() - 1); onChange(toDateStr(d)); }} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 shrink-0">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex gap-1.5 flex-1 justify-center">
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => onChange(d.date)}
              className={cn(
                "px-3 py-2 rounded-xl text-xs font-semibold transition-all min-w-[4.5rem] active:scale-95",
                d.date === date
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : d.isToday
                  ? "bg-slate-800 text-indigo-400 ring-1 ring-indigo-500/30"
                  : "bg-slate-800/50 text-slate-400 hover:bg-slate-800"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setCalMonth({ year: selectedDate.getFullYear(), month: selectedDate.getMonth() }); setCalOpen(true); }}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 shrink-0"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <button onClick={() => { const d = new Date(date); d.setDate(d.getDate() + 1); onChange(toDateStr(d)); }} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 shrink-0">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {calOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center" onClick={() => setCalOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-3xl p-5 w-[340px] shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setCalMonth((p) => { const m = p.month - 1; return m < 0 ? { year: p.year - 1, month: 11 } : { ...p, month: m }; })} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-sm font-bold text-white capitalize">{monthLabel}</span>
              <button onClick={() => setCalMonth((p) => { const m = p.month + 1; return m > 11 ? { year: p.year + 1, month: 0 } : { ...p, month: m }; })} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((wd) => (
                <div key={wd} className="text-center text-[11px] font-bold text-slate-500 py-1">{wd}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calDays.flat().map((d, i) => {
                if (!d) return <div key={`e${i}`} />;
                const ds = toDateStr(d);
                const isSelected = ds === date;
                const isToday = ds === todayStr;
                return (
                  <button
                    key={ds}
                    onClick={() => { onChange(ds); setCalOpen(false); }}
                    className={cn(
                      "w-10 h-10 rounded-xl text-sm font-semibold transition-all active:scale-90",
                      isSelected
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                        : isToday
                        ? "bg-slate-800 text-indigo-400 ring-1 ring-indigo-500/30"
                        : "text-slate-300 hover:bg-slate-800"
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex justify-between">
              <button
                onClick={() => { onChange(todayStr); setCalOpen(false); }}
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 px-3 py-2 rounded-xl hover:bg-slate-800 transition-colors"
              >
                Heute
              </button>
              <button
                onClick={() => setCalOpen(false)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-300 px-3 py-2 rounded-xl hover:bg-slate-800 transition-colors"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatPill({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color?: string }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
    indigo: "text-indigo-400",
  };
  return (
    <div className="flex items-center gap-2 bg-slate-800/50 rounded-xl px-3 py-1.5">
      <Icon className={cn("h-4 w-4", colors[color ?? "indigo"] ?? "text-slate-400")} />
      <span className="text-xs text-slate-400">{label}</span>
      <span className={cn("text-sm font-bold tabular-nums", colors[color ?? "indigo"] ?? "text-white")}>{value}</span>
    </div>
  );
}

function Section({ title, icon: Icon, count, color, children }: { title: string; icon: React.ComponentType<{ className?: string }>; count: number; color: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
    indigo: "text-indigo-400",
  };
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4", colors[color])} />
        <h2 className={cn("text-sm font-bold uppercase tracking-wider", colors[color])}>{title}</h2>
        <span className="text-xs font-mono font-bold text-slate-500 border border-slate-700 rounded-lg px-2 py-0.5 ml-auto">{count}</span>
      </div>
      {children}
    </div>
  );
}

function TicketCard({
  ticket,
  onTap,
  onCheckin,
  checkingIn,
  checked,
  isSub,
  highlight,
}: {
  ticket: CheckinTicket;
  onTap: () => void;
  onCheckin?: () => void;
  checkingIn?: boolean;
  checked?: boolean;
  isSub?: boolean;
  highlight?: string;
}) {
  const extras = (ticket.extras ?? []) as TicketExtra[];
  const needsPhoto = (ticket.service?.requiresPhoto || ticket.subscription?.requiresPhoto) && !ticket.profileImage;
  const needsRfid = (ticket.service?.requiresRfid || ticket.subscription?.requiresRfid) && !ticket.rfidCode;

  return (
    <div
      onClick={onTap}
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3 transition-all duration-700 active:scale-[0.98] cursor-pointer",
        highlight === "GRANTED"
          ? "border-emerald-500 bg-emerald-900/50 ring-2 ring-emerald-500/40"
          : highlight === "DENIED"
          ? "border-rose-500 bg-rose-900/50 ring-2 ring-rose-500/40"
          : checked
          ? "border-emerald-700/40 bg-emerald-950/30"
          : "border-slate-700/60 bg-slate-900 hover:border-slate-600"
      )}
    >
      {ticket.profileImage ? (
        <img src={ticket.profileImage} alt="" className="h-12 w-12 rounded-xl object-cover shrink-0 ring-1 ring-slate-700" />
      ) : (
        <div className="h-12 w-12 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
          <Users className="h-5 w-5 text-slate-500" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold truncate">{personName(ticket)}</p>
        <p className="text-xs text-slate-400 truncate">
          {ticket.slotStart && ticket.slotEnd ? `${ticket.slotStart}–${ticket.slotEnd}` : ""}
          {ticket.slotStart && ticket.ticketTypeName ? " · " : ""}
          {ticket.ticketTypeName ?? ""}
        </p>
        {isSub && ticket.startDate && ticket.endDate && (
          <p className="text-[11px] text-slate-500 mt-0.5">
            {new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
            {" – "}
            {new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
            {new Date(ticket.endDate) < new Date() && (
              <span className="text-rose-400 font-semibold ml-1">abgelaufen</span>
            )}
          </p>
        )}
        {isSub && ticket.startDate && !ticket.endDate && (
          <p className="text-[11px] text-slate-500 mt-0.5">
            ab {new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
          </p>
        )}
        {extras.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {extras.map((ex, i) => (
              <span key={i} className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-md font-medium">
                {ex.quantity > 1 ? `${ex.quantity}× ` : ""}{ex.name}
              </span>
            ))}
          </div>
        )}
        {(needsPhoto || needsRfid) && (
          <div className="flex gap-1 mt-1">
            {needsPhoto && <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded-md font-medium">Foto fehlt</span>}
            {needsRfid && <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded-md font-medium">RFID fehlt</span>}
          </div>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        {checked ? (
          <Badge className="bg-emerald-500/25 text-emerald-200 text-[11px] px-2 py-0.5 font-bold">Eingecheckt</Badge>
        ) : isSub ? (
          <Badge className="bg-violet-500/25 text-violet-200 text-[11px] px-2 py-0.5 font-bold">Abo</Badge>
        ) : onCheckin ? (
          <button
            onClick={(e) => { e.stopPropagation(); onCheckin(); }}
            disabled={checkingIn}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-colors active:scale-95 disabled:opacity-50"
          >
            {checkingIn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Einchecken"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

async function printTicket(ticket: CheckinTicket, accountName: string) {
  const code = ticket.barcode || ticket.qrCode || ticket.uuid || String(ticket.id);
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(code, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch { /* ignore */ }

  const name = personName(ticket);
  const type = ticket.ticketTypeName ?? ticket.service?.name ?? ticket.subscription?.name ?? "";
  const time = ticket.slotStart && ticket.slotEnd ? `${ticket.slotStart} – ${ticket.slotEnd} Uhr` : "";
  const area = ticket.accessArea?.name ?? "";
  const dateStr = ticket.startDate
    ? new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";
  const validity = ticket.startDate
    ? ticket.endDate
      ? `${dateStr} – ${new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}`
      : dateStr
    : "";
  const extras = ((ticket.extras ?? []) as TicketExtra[])
    .map((ex) => (ex.quantity > 1 ? `${ex.quantity}x ${ex.name}` : ex.name));

  const pw = 72;
  const margin = 4;
  const contentW = pw - margin * 2;
  const doc = new jsPDF({ unit: "mm", format: [pw, 200] });

  let y = 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(accountName, pw / 2, y, { align: "center" });
  y += 5;

  doc.setDrawColor(0);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const nameLines = doc.splitTextToSize(name, contentW);
  doc.text(nameLines, margin, y);
  y += nameLines.length * 4.5;

  doc.setFontSize(9);
  if (type) {
    doc.setFont("helvetica", "bold");
    const typeLines = doc.splitTextToSize(type, contentW);
    doc.text(typeLines, margin, y);
    y += typeLines.length * 3.5;
  }

  doc.setFont("helvetica", "normal");
  if (time) { doc.text(time, margin, y); y += 3.5; }
  if (area) { doc.text(`Bereich: ${area}`, margin, y); y += 3.5; }
  if (validity) { doc.text(`Gültig: ${validity}`, margin, y); y += 3.5; }

  if (extras.length > 0) {
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Extras:", margin, y);
    y += 3;
    doc.setFont("helvetica", "normal");
    for (const ex of extras) {
      const exLines = doc.splitTextToSize(`• ${ex}`, contentW);
      doc.text(exLines, margin, y);
      y += exLines.length * 3;
    }
  }

  y += 2;
  doc.line(margin, y, pw - margin, y);
  y += 3;

  if (qrDataUrl) {
    const qrSize = 38;
    const qrX = (pw - qrSize) / 2;
    doc.addImage(qrDataUrl, "PNG", qrX, y, qrSize, qrSize);
    y += qrSize + 2;
  }

  doc.setFont("courier", "normal");
  doc.setFontSize(7);
  doc.text(code, pw / 2, y, { align: "center" });
  y += 4;

  doc.line(margin, y, pw - margin, y);
  y += 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  doc.text(now, pw / 2, y, { align: "center" });
  y += 8;

  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);

  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 5000);
  };
}

function TicketOverlay({
  ticket,
  onClose,
  onCheckin,
  checkingIn,
  editMode,
  setEditMode,
  rfidInput,
  setRfidInput,
  onSaveRfid,
  onOpenCamera,
  updatingTicket,
  accountName,
  rfidConflict,
  onForceRfid,
  onCancelRfid,
  ticketScans,
}: {
  ticket: CheckinTicket;
  onClose: () => void;
  onCheckin: () => void;
  checkingIn: boolean;
  editMode: "photo" | "rfid" | null;
  setEditMode: (m: "photo" | "rfid" | null) => void;
  rfidInput: string;
  setRfidInput: (v: string) => void;
  onSaveRfid: (code?: string) => void;
  onOpenCamera: () => void;
  updatingTicket: boolean;
  accountName: string;
  rfidConflict: { rfidCode: string; existingOwner: string; existingType: string | null } | null;
  onForceRfid: () => void;
  onCancelRfid: () => void;
  ticketScans: ScanEntry[];
}) {
  const extras = (ticket.extras ?? []) as TicketExtra[];
  const isChecked = ticket.checkedIn || ticket.status === "REDEEMED";
  const isSub = !!ticket.subscriptionId;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center safe-bottom" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-start gap-4">
          {ticket.profileImage ? (
            <img src={ticket.profileImage} alt="" className="h-16 w-16 rounded-2xl object-cover ring-2 ring-slate-700" />
          ) : (
            <div className="h-16 w-16 rounded-2xl bg-slate-800 flex items-center justify-center">
              <Users className="h-7 w-7 text-slate-500" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold truncate">{personName(ticket)}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{ticket.ticketTypeName ?? ticket.service?.name ?? ticket.subscription?.name ?? ""}</p>
            {ticket.slotStart && ticket.slotEnd && (
              <p className="text-sm text-slate-500 mt-0.5">{ticket.slotStart} – {ticket.slotEnd} Uhr</p>
            )}
            <div className="flex gap-1.5 mt-2">
              <Badge className={cn(
                "text-xs px-2 py-0.5 font-bold",
                isChecked ? "bg-emerald-500/25 text-emerald-200" : "bg-sky-500/25 text-sky-200"
              )}>
                {isChecked ? "Eingecheckt" : "Ausstehend"}
              </Badge>
              {isSub && <Badge className="bg-violet-500/25 text-violet-200 text-xs px-2 py-0.5 font-bold">Abo</Badge>}
              {ticket.source && <Badge className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5">{ticket.source}</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Extras */}
        {extras.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-800">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              <Package className="h-3.5 w-3.5 inline mr-1.5" />Zusatzbuchungen
            </p>
            <div className="flex flex-wrap gap-2">
              {extras.map((ex, i) => (
                <span key={i} className="text-sm bg-amber-500/15 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-xl font-medium">
                  {ex.quantity > 1 ? `${ex.quantity}× ` : ""}{ex.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="px-5 py-3 border-b border-slate-800 space-y-2">
          <InfoRow label="RFID" value={ticket.rfidCode ?? "–"} icon={Fingerprint} />
          {ticket.accessArea && <InfoRow label="Bereich" value={ticket.accessArea.name} icon={Users} />}
          {ticket.barcode && <InfoRow label="Barcode" value={ticket.barcode} icon={ScanLine} />}
          {ticket.startDate && (
            <InfoRow
              label="Gültig"
              value={
                ticket.endDate
                  ? `${new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })} – ${new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}${new Date(ticket.endDate) < new Date() ? " (abgelaufen)" : ""}`
                  : `ab ${new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}`
              }
              icon={Clock}
            />
          )}
        </div>

        {/* Scan history */}
        {ticketScans.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-800">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              <ScanLine className="h-3.5 w-3.5 inline mr-1.5" />Scanverlauf
            </p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {ticketScans.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  {s.result === "GRANTED" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  )}
                  <span className={s.result === "GRANTED" ? "text-emerald-300 font-semibold" : "text-rose-300 font-semibold"}>
                    {s.result === "GRANTED" ? "Zugang" : "Abgelehnt"}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400">
                    {new Date(s.scanTime).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-500 truncate">{s.device?.name ?? "Manuell"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="p-5 space-y-3">
          {/* Check-in button */}
          {!isChecked && !isSub && ticket.service?.allowManualCheckin !== false && (
            <button
              onClick={onCheckin}
              disabled={checkingIn}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-lg font-bold py-4 rounded-2xl transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {checkingIn ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-6 w-6" />
                  Einchecken
                </>
              )}
            </button>
          )}

          {/* Photo / RFID buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onOpenCamera}
              disabled={updatingTicket}
              className="bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
            >
              {updatingTicket && editMode === "photo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Foto {ticket.profileImage ? "ändern" : "aufnehmen"}
            </button>
            <button
              onClick={() => { setEditMode(editMode === "rfid" ? null : "rfid"); setRfidInput(ticket.rfidCode ?? ""); }}
              className="bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
            >
              <Fingerprint className="h-4 w-4" />
              RFID {ticket.rfidCode ? "ändern" : "setzen"}
            </button>
          </div>

          {/* RFID input */}
          {editMode === "rfid" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <RfidInput
                  value={rfidInput}
                  onChange={setRfidInput}
                  onSubmit={(code) => onSaveRfid(code)}
                  disabled={updatingTicket}
                />
                <button
                  onClick={() => onSaveRfid()}
                  disabled={!rfidInput.trim() || updatingTicket}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-3 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 active:scale-95"
                >
                  {updatingTicket ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
                </button>
              </div>
              {rfidConflict && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
                  <p className="text-sm text-amber-200">
                    <span className="font-bold">RFID bereits vergeben</span> an{" "}
                    <span className="font-semibold">{rfidConflict.existingOwner}</span>
                    {rfidConflict.existingType && <span className="text-amber-300/70"> ({rfidConflict.existingType})</span>}
                  </p>
                  <p className="text-xs text-amber-300/60">RFID vom bisherigen Besitzer entfernen und diesem Ticket zuweisen?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={onForceRfid}
                      className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors active:scale-95"
                    >
                      Überschreiben
                    </button>
                    <button
                      onClick={onCancelRfid}
                      className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors active:scale-95"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Print button */}
          <button
            onClick={() => printTicket(ticket, accountName)}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
          >
            <Printer className="h-4 w-4" />
            Ticket drucken
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanOverlay({
  scanInput,
  setScanInput,
  onScan,
  scanLoading,
  scanResult,
  onClose,
  inputRef,
}: {
  scanInput: string;
  setScanInput: (v: string) => void;
  onScan: (code: string) => void;
  scanLoading: boolean;
  scanResult: { found: boolean; ticket?: CheckinTicket; message?: string } | null;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [inputRef]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-indigo-400" />
            Code scannen
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onScan(scanInput)}
            placeholder="Barcode scannen oder Code eingeben"
            className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
            autoComplete="off"
          />
          <button
            onClick={() => onScan(scanInput)}
            disabled={scanLoading || !scanInput.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-3.5 rounded-xl font-semibold transition-colors disabled:opacity-50 active:scale-95"
          >
            {scanLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          </button>
        </div>

        {scanResult && !scanResult.found && (
          <div className="bg-rose-950 border border-rose-700/50 rounded-2xl p-4 flex items-center gap-3">
            <XCircle className="h-6 w-6 text-rose-400 shrink-0" />
            <p className="text-sm text-rose-200">{scanResult.message ?? "Nicht gefunden"}</p>
          </div>
        )}

        {scanResult?.found && scanResult.ticket && (
          <div className="bg-emerald-950 border border-emerald-700/50 rounded-2xl p-4 flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-200">{personName(scanResult.ticket)}</p>
              <p className="text-xs text-emerald-300/70">{scanResult.ticket.ticketTypeName ?? ""}</p>
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500 text-center">Barcode-Scanner-Eingabe wird automatisch erkannt</p>
      </div>
    </div>
  );
}

function CameraOverlay({ onCapture, onClose }: { onCapture: (dataUrl: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch {
        if (!cancelled) setError("Kamera-Zugriff nicht möglich");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const size = 300;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const min = Math.min(vw, vh);
    const sx = (vw - min) / 2;
    const sy = (vh - min) / 2;
    ctx.drawImage(video, sx, sy, min, min, 0, 0, size, size);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(canvas.toDataURL("image/jpeg", 0.8));
  };

  const handleClose = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-white text-lg font-bold">Foto aufnehmen</h2>
        <button onClick={handleClose} className="p-2 rounded-xl bg-slate-800 text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {error ? (
          <p className="text-red-400 text-center px-8">{error}</p>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-2 border-white/40 rounded-3xl" />
            </div>
          </>
        )}
      </div>

      {ready && !error && (
        <div className="p-6 flex justify-center">
          <button
            onClick={capture}
            className="w-20 h-20 rounded-full bg-white border-4 border-slate-300 active:scale-90 transition-transform flex items-center justify-center"
          >
            <Camera className="h-8 w-8 text-slate-900" />
          </button>
        </div>
      )}
    </div>
  );
}

function RfidInput({ value, onChange, onSubmit, disabled }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (code: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);

    bufferRef.current = val;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const code = bufferRef.current.trim();
      if (code.length >= 4) {
        onSubmit(code);
      }
      bufferRef.current = "";
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (timerRef.current) clearTimeout(timerRef.current);
      bufferRef.current = "";
      const code = value.trim();
      if (code) onSubmit(code);
    }
  };

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      placeholder="RFID scannen oder eingeben"
      className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      autoFocus
    />
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-slate-500 shrink-0" />
      <span className="text-xs text-slate-500 w-16">{label}</span>
      <span className="text-sm text-slate-200 font-mono truncate">{value}</span>
    </div>
  );
}
