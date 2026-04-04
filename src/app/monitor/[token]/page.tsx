"use client";

import { useEffect, useRef, useState, useMemo, useCallback, use } from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, ScanLine, Users, Ticket, Sun, Moon, ChevronLeft, LogIn, Pause, Loader2, Camera, Search } from "lucide-react";
import { cn, fmtTime } from "@/lib/utils";
import { isSameBerlinDay } from "@/lib/berlin-day";
import { monitorTicketTypeLine } from "@/lib/monitor-ticket-subtitle";

function endOfDayMs(dateStr: string): number {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

interface Device {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
  lastUpdate: string | null;
  task: number;
}

interface Scan {
  id: number;
  code: string;
  note?: string | null;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  scanTime: string;
  device: { id: number; name: string };
  ticket: {
    id?: number;
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    birthDate?: string | null;
    ticketTypeName?: string | null;
    validityType?: string;
    validityDurationMinutes?: number | null;
    firstScanAt?: string | null;
    endDate?: string | null;
    subscriptionId?: number | null;
    serviceId?: number | null;
    status?: string;
    profileImage?: string | null;
    subscription?: { name: string } | null;
    service?: { name: string } | null;
  } | null;
}

interface TicketInfo {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  ticketTypeName: string | null;
  status: string;
  validityType: string;
  validityDurationMinutes: number | null;
  firstScanAt: string | null;
  startDate: string | null;
  endDate: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  subscriptionId: number | null;
  source: string | null;
  service?: { name: string } | null;
  subscription?: { name: string } | null;
  accessArea?: { name: string } | null;
  profileImage?: string | null;
}

interface ScanGroup {
  groupKey: string;
  ticketId: number | null;
  ticketName: string;
  personName: string;
  birthDate?: string | null;
  ticketTypeName: string;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  scans: Scan[];
  latestScanTime: string;
  validityType?: string;
  validityDurationMinutes?: number | null;
  firstScanAt?: string | null;
  endDate?: string | null;
  subscriptionId?: number | null;
  subscriptionName?: string | null;
  profileImage?: string | null;
  noteAge?: number;
}

interface Props {
  params: Promise<{ token: string }>;
}

export default function PublicMonitorPage({ params }: Props) {
  const { token } = use(params);
  const [monitorName, setMonitorName] = useState<string>("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [tickets, setTickets] = useState<TicketInfo[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(true);
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<TicketInfo | null>(null);
  const [allPaused, setAllPaused] = useState(false);
  const [pauseToggling, setPauseToggling] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [mobileTab, setMobileTab] = useState<"tickets" | "scans">("tickets");
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanIdRef = useRef(0);
  const pollTickRef = useRef(0);
  const isFirstLoad = useRef(true);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playDenyTone = useCallback(() => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.linearRampToValueAtTime(300, t + 0.18);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch { /* audio not available */ }
  }, []);

  async function handleTicketScan(ticketId: number) {
    if (scanningId) return;
    setScanningId(ticketId);
    try {
      const res = await fetch(`/api/monitor/public/${token}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      await res.json();
    } catch { /* ignore */ }
    setTimeout(() => setScanningId(null), 800);
  }

  async function handlePauseAll() {
    if (pauseToggling) return;
    setPauseToggling(true);
    try {
      const action = allPaused ? "resume" : "pause";
      const res = await fetch(`/api/monitor/public/${token}/pause-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) setAllPaused(!allPaused);
    } catch { /* ignore */ }
    setPauseToggling(false);
  }

  function handleTicketClick(ticket: TicketInfo) {
    if (window.innerWidth < 1024) {
      setSelectedTicket(ticket);
    } else {
      handleTicketScan(ticket.id);
    }
  }

  useEffect(() => {
    let cancelled = false;
    lastScanIdRef.current = 0;
    pollTickRef.current = 0;

    const applyTickets = (raw: TicketInfo[]) => {
      const now = Date.now();
      const valid = raw.filter((t) => {
        if (t.validityType === "DURATION" && t.firstScanAt && t.validityDurationMinutes) {
          const expiresAt = new Date(t.firstScanAt).getTime() + t.validityDurationMinutes * 60_000;
          if (now > expiresAt) return false;
        }
        return true;
      });
      const sorted = valid.sort((a, b) => {
        const order = (t: TicketInfo) =>
          t.status === "PAUSED" ? 3
          : t.source === "EMP_CONTROL" ? 2
          : t.subscriptionId != null ? 1
          : 0;
        return order(a) - order(b);
      });
      setTickets(sorted);
      const hasActive = sorted.some((t) => t.status === "VALID" || t.status === "REDEEMED");
      const hasPaused = sorted.some((t) => t.status === "PAUSED");
      setAllPaused(hasPaused && !hasActive);
    };

    async function doPoll() {
      if (cancelled || document.hidden) return;
      const tick = pollTickRef.current;
      pollTickRef.current += 1;
      const isFullPoll = tick === 0 || tick % 10 === 0;
      const includeTickets = isFullPoll;
      const scansOnly = !isFullPoll;
      const url = `/api/monitor/public/${encodeURIComponent(token)}?poll=1&since=${lastScanIdRef.current}&tickets=${includeTickets ? 1 : 0}${scansOnly ? "&scansOnly=1" : ""}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 410) setError("Bitte Seite neu laden (F5).");
          else setError("Verbindungsfehler");
          setConnected(false);
          return;
        }
        const data = (await res.json()) as {
          name: string;
          devices: Device[];
          scans: Scan[];
          tickets: TicketInfo[] | null;
          lastScanId: number;
        };
        if (cancelled) return;
        if (!scansOnly) {
          setMonitorName(data.name);
          setDevices(data.devices);
        }
        if (data.scans?.length) {
          const incoming = data.scans;
          setScans((prev) => {
            const existing = new Set(prev.map((s) => s.id));
            const fresh = incoming.filter((s) => !existing.has(s.id));
            if (!isFirstLoad.current && fresh.length > 0) {
              setNewIds(new Set(fresh.map((s) => s.id)));
              setTimeout(() => setNewIds(new Set()), 1500);
              if (fresh.some((s) => s.result === "DENIED")) playDenyTone();
            }
            isFirstLoad.current = false;
            return [...fresh, ...prev].slice(0, 50);
          });
        }
        if (typeof data.lastScanId === "number") {
          lastScanIdRef.current = data.lastScanId;
        }
        if (data.tickets) {
          applyTickets(data.tickets);
        }
        setConnected(true);
        setError("");
      } catch {
        if (!cancelled) {
          setError("Verbindungsfehler");
          setConnected(false);
        }
      }
    }

    doPoll();
    pollTimerRef.current = setInterval(doPoll, 3000);

    const handleVisibility = () => {
      if (document.hidden) {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setConnected(false);
      } else {
        pollTickRef.current = 0;
        void doPoll();
        if (!pollTimerRef.current) {
          pollTimerRef.current = setInterval(doPoll, 3000);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [token]);

  /** Nach Check-in: Profilbild aus nächstem Ticket-Poll ins geöffnete Overlay übernehmen */
  useEffect(() => {
    setSelectedTicket((prev) => {
      if (!prev) return prev;
      const fresh = tickets.find((t) => t.id === prev.id);
      if (!fresh) return prev;
      if (prev.profileImage === fresh.profileImage) return prev;
      return { ...prev, profileImage: fresh.profileImage };
    });
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    const q = ticketSearch.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) => {
      const hay = [
        t.name,
        t.firstName ?? "",
        t.lastName ?? "",
        t.ticketTypeName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tickets, ticketSearch]);

  const groupedScans = useMemo(() => {
    function parseNote(note?: string | null): { name?: string; picture?: string; age?: number } {
      if (!note) return {};
      try {
        const parsed = JSON.parse(note);
        if (typeof parsed === "object" && parsed !== null) return parsed;
      } catch { /* plain text note */ }
      return { name: note };
    }

    const groups: ScanGroup[] = [];
    for (const scan of scans) {
      const lastGroup = groups[groups.length - 1];
      const ticketId = scan.ticket?.id ?? null;
      const key = ticketId != null ? `t:${ticketId}` : `c:${scan.code}`;
      const noteData = parseNote(scan.note);

      if (lastGroup && lastGroup.groupKey === key && lastGroup.result === scan.result) {
        lastGroup.scans.push(scan);
        const img = scan.ticket?.profileImage || noteData.picture;
        if (img && !lastGroup.profileImage) lastGroup.profileImage = img;
      } else {
        groups.push({
          groupKey: key,
          ticketId,
          ticketName: scan.ticket?.name || noteData.name || scan.code.replace(/^[#%]+/, ""),
          personName: [scan.ticket?.firstName, scan.ticket?.lastName].filter(Boolean).join(" ") || noteData.name || "",
          birthDate: scan.ticket?.birthDate,
          ticketTypeName: scan.ticket?.ticketTypeName || "",
          result: scan.result,
          scans: [scan],
          latestScanTime: scan.scanTime,
          validityType: scan.ticket?.validityType,
          validityDurationMinutes: scan.ticket?.validityDurationMinutes,
          firstScanAt: scan.ticket?.firstScanAt,
          endDate: scan.ticket?.endDate,
          subscriptionId: scan.ticket?.subscriptionId,
          subscriptionName: scan.ticket?.subscription?.name || null,
          profileImage: scan.ticket?.profileImage || noteData.picture || undefined,
          noteAge: noteData.age,
        });
      }
    }
    return groups;
  }, [scans]);

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const styles = dark ? {
    page: "bg-slate-950 text-white",
    header: "border-slate-800 bg-slate-900",
    headerTitle: "text-white",
    headerSub: "text-slate-300",
    deviceDot: "bg-emerald-400 shadow-[0_0_10px_3px_rgba(52,211,153,0.6)]",
    deviceDotOff: "bg-red-500",
    deviceText: "text-slate-200",
    liveBadge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    connectBadge: "bg-slate-800 text-slate-300",
    sectionLabel: "text-slate-300",
    emptyBg: "border-slate-700 bg-slate-900 text-slate-400",
    scanGranted: "bg-emerald-950 border-emerald-700/50",
    scanDenied: "bg-rose-950 border-rose-700/50",
    scanProtected: "bg-amber-950 border-amber-700/50",
    scanName: "text-white",
    scanSub: "text-slate-300",
    scanTime: "text-slate-300",
    scanCountBg: "bg-white/10 text-white",
    imgRing: "ring-slate-700",
    clockBg: "bg-indigo-950 border-indigo-700/50",
    clockText: "text-white",
    clockSub: "text-indigo-300",
    ticketBg: "border-slate-700/60 bg-slate-900",
    ticketName: "text-white",
    ticketSub: "text-slate-300",
    ticketAvatarBg: "bg-slate-800",
    ticketAvatarIcon: "text-slate-400",
    ticketCountBorder: "border-slate-600 text-slate-300",
    ringOffset: "ring-offset-slate-950",
    modeBtnBg: "bg-slate-800 hover:bg-slate-700 text-slate-200",
  } : {
    page: "bg-white text-slate-950",
    header: "border-slate-300 bg-slate-50",
    headerTitle: "text-slate-950",
    headerSub: "text-slate-600",
    deviceDot: "bg-emerald-600 shadow-[0_0_10px_3px_rgba(16,185,129,0.5)]",
    deviceDotOff: "bg-red-500",
    deviceText: "text-slate-700",
    liveBadge: "bg-emerald-100 text-emerald-800 border-emerald-300",
    connectBadge: "bg-slate-200 text-slate-600",
    sectionLabel: "text-slate-600",
    emptyBg: "border-slate-300 bg-slate-100 text-slate-500",
    scanGranted: "bg-emerald-50 border-emerald-300",
    scanDenied: "bg-rose-50 border-rose-300",
    scanProtected: "bg-amber-50 border-amber-300",
    scanName: "text-slate-950",
    scanSub: "text-slate-600",
    scanTime: "text-slate-600",
    scanCountBg: "bg-slate-200 text-slate-800",
    imgRing: "ring-slate-300",
    clockBg: "bg-indigo-50 border-indigo-300",
    clockText: "text-slate-950",
    clockSub: "text-indigo-700",
    ticketBg: "border-slate-300 bg-slate-50",
    ticketName: "text-slate-950",
    ticketSub: "text-slate-600",
    ticketAvatarBg: "bg-slate-200",
    ticketAvatarIcon: "text-slate-500",
    ticketCountBorder: "border-slate-400 text-slate-600",
    ringOffset: "ring-offset-white",
    modeBtnBg: "bg-slate-200 hover:bg-slate-300 text-slate-700",
  };

  const resultConfig = {
    GRANTED: {
      icon: CheckCircle2,
      label: "Erlaubt",
      text: dark ? "text-emerald-400" : "text-emerald-700",
      badge: dark ? "bg-emerald-500/25 text-emerald-200 font-bold" : "bg-emerald-200 text-emerald-900 font-bold",
      ring: "ring-emerald-400",
      bg: styles.scanGranted,
    },
    DENIED: {
      icon: XCircle,
      label: "Abgelehnt",
      text: dark ? "text-rose-400" : "text-rose-700",
      badge: dark ? "bg-rose-500/25 text-rose-200 font-bold" : "bg-rose-200 text-rose-900 font-bold",
      ring: "ring-rose-400",
      bg: styles.scanDenied,
    },
    PROTECTED: {
      icon: Clock,
      label: "Geschützt",
      text: dark ? "text-amber-400" : "text-amber-700",
      badge: dark ? "bg-amber-500/25 text-amber-200 font-bold" : "bg-amber-200 text-amber-900 font-bold",
      ring: "ring-amber-400",
      bg: styles.scanProtected,
    },
  } as const;

  if (error) {
    return (
      <div className={cn("min-h-screen flex items-center justify-center", styles.page)}>
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen flex flex-col transition-colors duration-300", styles.page)}>
      {/* Header */}
      <header className={cn("border-b px-3 py-2 sm:px-6 sm:py-3.5 flex items-center justify-between transition-colors duration-300", styles.header)} style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <img src="/logo-dark.png" alt="EMP Access" className="h-7 w-7 sm:h-9 sm:w-9 shrink-0" />
          <div className="min-w-0">
            <h1 className={cn("text-sm sm:text-lg font-bold tracking-tight truncate", styles.headerTitle)}>{monitorName || "Live Monitor"}</h1>
            <p className={cn("text-[10px] sm:text-[11px] hidden sm:block", styles.headerSub)}>EMP Access — Echtzeit-Zugangsmonitor</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {devices.map((device) => {
            const online = device.lastUpdate ? new Date(device.lastUpdate) > fiveMinAgo : false;
            return (
              <div key={device.id} className="flex items-center gap-1 sm:gap-1.5">
                <div className={cn("h-2 w-2 rounded-full transition-all", online ? styles.deviceDot : styles.deviceDotOff)} />
                <span className={cn("text-[10px] sm:text-xs font-medium hidden sm:inline", styles.deviceText)}>{device.name}</span>
              </div>
            );
          })}
          <div className={cn("flex lg:hidden rounded-lg overflow-hidden border", dark ? "border-slate-700" : "border-slate-300")}>
            <button
              onClick={() => setMobileTab("scans")}
              className={cn(
                "px-2 py-1 text-[10px] font-bold transition-colors flex items-center gap-1",
                mobileTab === "scans"
                  ? dark ? "bg-indigo-600 text-white" : "bg-indigo-500 text-white"
                  : dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500",
              )}
            >
              <ScanLine className="h-3 w-3" />
              Scans
            </button>
            <button
              onClick={() => setMobileTab("tickets")}
              className={cn(
                "px-2 py-1 text-[10px] font-bold transition-colors flex items-center gap-1",
                mobileTab === "tickets"
                  ? dark ? "bg-indigo-600 text-white" : "bg-indigo-500 text-white"
                  : dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500",
              )}
            >
              <Ticket className="h-3 w-3" />
              Tickets
            </button>
          </div>
          <button
            onClick={() => setDark((d) => !d)}
            className={cn("p-1.5 sm:p-2 rounded-lg transition-colors", styles.modeBtnBg)}
          >
            {dark ? <Sun className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Moon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          </button>
          {connected ? (
            <Badge className={cn("gap-1 sm:gap-1.5 font-medium text-[10px] sm:text-xs px-1.5 sm:px-2.5", styles.liveBadge)}>
              <span className={cn("h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full animate-pulse", dark ? "bg-emerald-400" : "bg-emerald-500")} />
              Live
            </Badge>
          ) : (
            <Badge className={cn("gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2.5", styles.connectBadge)}>
              <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-slate-400 animate-pulse" />
              Verbinde…
            </Badge>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 p-3 sm:p-5" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 h-full">
          {/* Scan Feed */}
          <div className={cn("flex-col lg:col-span-2", mobileTab === "scans" ? "flex" : "hidden lg:flex")}>
            <div className="flex items-center gap-2 mb-3">
              <ScanLine className={cn("h-5 w-5", styles.sectionLabel)} />
              <h2 className={cn("text-sm font-bold uppercase tracking-widest", styles.sectionLabel)}>Letzte Scans</h2>
            </div>
            {scans.length === 0 && (
              <div className={cn("rounded-2xl border p-12 text-center text-sm", styles.emptyBg)}>
                Warte auf Scans…
              </div>
            )}
            <div className="max-h-[calc(100vh-9rem)] overflow-y-auto pr-1 monitor-scrollbar">
              {/* Top 2 hero scans */}
              {groupedScans.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mb-3" style={{ minHeight: "calc(50vh - 5rem)" }}>
                  {groupedScans.slice(0, 2).map((group) => {
                    const rc = resultConfig[group.result];
                    const Icon = rc.icon;
                    const isNew = group.scans.some((s) => newIds.has(s.id));
                    const scanCount = group.scans.length;
                    const endMs = group.endDate ? endOfDayMs(group.endDate) : null;
                    const daysLeft = endMs != null ? Math.ceil((endMs - Date.now()) / 86_400_000) : null;
                    const aboExpiring = group.subscriptionId != null && daysLeft != null && daysLeft >= 0 && daysLeft <= 7;
                    const aboExpired = group.subscriptionId != null && daysLeft != null && daysLeft < 0;
                    return (
                      <div
                        key={group.scans[0].id}
                        className={cn(
                          "flex flex-col rounded-3xl border-2 overflow-hidden transition-all duration-200",
                          rc.bg,
                          isNew && `animate-scan-flash ring-3 ring-offset-2 ${styles.ringOffset}`,
                          isNew && rc.ring,
                        )}
                      >
                        <div className="flex flex-col items-center justify-center flex-1 px-5 pt-5 pb-3 gap-3">
                          <div className={cn("h-24 w-24 sm:h-28 sm:w-28 rounded-3xl flex items-center justify-center shrink-0 overflow-hidden shadow-lg", dark ? "bg-white/10" : "bg-slate-200")}>
                            {group.profileImage ? (
                              <img src={group.profileImage} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <Icon className={cn("h-12 w-12 sm:h-14 sm:w-14", rc.text)} />
                            )}
                          </div>
                          <div className="text-center min-w-0 w-full">
                            <p className={cn("font-extrabold text-2xl sm:text-3xl leading-tight truncate", styles.scanName)}>
                              {group.personName || group.ticketName}
                            </p>
                            {(() => { const a = calcAge(group.birthDate) ?? group.noteAge; return a != null ? <p className={cn("text-lg font-medium mt-0.5", dark ? "text-slate-400" : "text-slate-500")}>Alter: {a}</p> : null; })()}
                            {(group.ticketTypeName || (!group.ticketId && group.personName)) && (
                              <p className={cn("text-base sm:text-lg font-semibold mt-1 truncate", styles.scanSub)}>
                                {group.ticketTypeName || "Wakesys"}
                              </p>
                            )}
                            {(group.subscriptionName || group.endDate) && (
                              <p className={cn("text-sm sm:text-base mt-0.5 truncate", styles.scanSub)}>
                                {group.subscriptionName}
                                {group.subscriptionId && group.endDate && (
                                  <>{group.subscriptionName ? " · " : ""}bis {new Date(group.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}</>
                                )}
                              </p>
                            )}
                            {aboExpired && (
                              <span className={cn("inline-block mt-1.5 text-sm font-bold px-3 py-1 rounded-lg", dark ? "bg-rose-500/25 text-rose-200" : "bg-rose-200 text-rose-900")}>Abo abgelaufen</span>
                            )}
                            {aboExpiring && (
                              <span className={cn("inline-block mt-1.5 text-sm font-bold px-3 py-1 rounded-lg", dark ? "bg-amber-500/25 text-amber-200" : "bg-amber-200 text-amber-900")}>
                                Abo läuft ab {daysLeft === 0 ? "heute" : daysLeft === 1 ? "morgen" : `in ${daysLeft} Tagen`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-1 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            {group.result === "GRANTED" && !group.ticketId && (
                              <span className={cn("text-xs font-bold px-2.5 py-1 rounded-lg", dark ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-amber-100 text-amber-700 border border-amber-200")}>RFID Merge</span>
                            )}
                            {group.validityType === "DURATION" && group.validityDurationMinutes && group.firstScanAt && (
                              <DurationCountdown firstScanAt={group.firstScanAt} durationMinutes={group.validityDurationMinutes} dark={dark} size="lg" />
                            )}
                            {scanCount > 1 && (
                              <span className={cn("text-base font-mono font-bold px-3.5 py-1.5 rounded-xl tabular-nums", styles.scanCountBg)}>&times;{scanCount}</span>
                            )}
                          </div>
                          <span className={cn("text-lg tabular-nums font-mono font-bold", styles.scanTime)}>{fmtTime(group.latestScanTime)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Remaining scans */}
              <div className="space-y-1.5">
              {groupedScans.slice(2).map((group) => {
                const rc = resultConfig[group.result];
                const Icon = rc.icon;
                const isNew = group.scans.some((s) => newIds.has(s.id));
                const scanCount = group.scans.length;
                const endMs = group.endDate ? endOfDayMs(group.endDate) : null;
                const daysLeft = endMs != null ? Math.ceil((endMs - Date.now()) / 86_400_000) : null;
                const aboExpiring = group.subscriptionId != null && daysLeft != null && daysLeft >= 0 && daysLeft <= 7;
                const aboExpired = group.subscriptionId != null && daysLeft != null && daysLeft < 0;

                return (
                  <div
                    key={group.scans[0].id}
                    className={cn(
                      "flex items-center justify-between rounded-2xl border overflow-hidden transition-all duration-200",
                      "px-4 py-3",
                      rc.bg,
                      isNew && `animate-scan-flash ring-2 ring-offset-1 ${styles.ringOffset}`,
                      isNew && rc.ring,
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn("h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden", dark ? "bg-white/10" : "bg-slate-200")}>
                        {group.profileImage ? (
                          <img src={group.profileImage} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Icon className={cn("h-6 w-6", rc.text)} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className={cn("font-bold text-[15px] leading-tight truncate", styles.scanName)}>
                          {group.personName || group.ticketName}
                          {(() => { const a = calcAge(group.birthDate) ?? group.noteAge; return a != null ? <span className={cn("ml-1 text-xs font-normal", dark ? "text-slate-500" : "text-slate-400")}>({a})</span> : null; })()}
                        </p>
                        <p className={cn("text-sm truncate mt-0.5", styles.scanSub)}>
                          {(() => {
                            const parts: string[] = [];
                            if (group.ticketTypeName) parts.push(group.ticketTypeName);
                            if (group.subscriptionName && group.subscriptionName !== group.ticketTypeName) parts.push(group.subscriptionName);
                            if (group.subscriptionId && group.endDate) parts.push(`bis ${new Date(group.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}`);
                            if (parts.length === 0 && !group.ticketId && group.personName) parts.push("Wakesys");
                            return parts.join(" · ");
                          })()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {aboExpired && (
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", dark ? "bg-rose-500/20 text-rose-200 border border-rose-500/30" : "bg-rose-100 text-rose-700 border border-rose-200")}>Abo abgelaufen</span>
                      )}
                      {aboExpiring && (
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", dark ? "bg-amber-500/20 text-amber-200 border border-amber-500/30" : "bg-amber-100 text-amber-700 border border-amber-200")}>
                          {daysLeft === 0 ? "Abo läuft heute ab" : daysLeft === 1 ? "Abo läuft morgen ab" : `Abo läuft in ${daysLeft}d ab`}
                        </span>
                      )}
                      {group.result === "GRANTED" && !group.ticketId && (
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", dark ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-amber-100 text-amber-700 border border-amber-200")}>RFID Merge</span>
                      )}
                      {group.validityType === "DURATION" && group.validityDurationMinutes && group.firstScanAt && (
                        <DurationCountdown firstScanAt={group.firstScanAt} durationMinutes={group.validityDurationMinutes} dark={dark} />
                      )}
                      {scanCount > 1 && (
                        <span className={cn("text-xs font-mono font-bold px-2.5 py-1 rounded-lg tabular-nums", styles.scanCountBg)}>×{scanCount}</span>
                      )}
                      <span className={cn("text-sm tabular-nums font-mono font-semibold", styles.scanTime)}>{fmtTime(group.latestScanTime)}</span>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          </div>

          {/* Right Side */}
          <div className={cn("flex-col gap-4", mobileTab === "tickets" ? "flex" : "hidden lg:flex")}>
            <LiveClock dark={dark} styles={styles} allPaused={allPaused} pauseToggling={pauseToggling} onClick={handlePauseAll} />

            {/* Suche nur Mobil: direkt unter Uhr/Datum */}
            <div className="lg:hidden">
              <label className="sr-only" htmlFor="monitor-ticket-search">Tickets durchsuchen</label>
              <div
                className={cn(
                  "flex items-center gap-2 rounded-2xl border px-3 py-2.5",
                  dark ? "border-slate-700 bg-slate-900/80" : "border-slate-300 bg-white",
                )}
              >
                <Search className={cn("h-4 w-4 shrink-0", dark ? "text-slate-500" : "text-slate-400")} aria-hidden />
                <input
                  id="monitor-ticket-search"
                  type="search"
                  enterKeyHint="search"
                  value={ticketSearch}
                  onChange={(e) => setTicketSearch(e.target.value)}
                  placeholder="Tickets durchsuchen…"
                  className={cn(
                    "min-w-0 flex-1 bg-transparent text-sm outline-none",
                    dark ? "text-white placeholder:text-slate-500" : "text-slate-900 placeholder:text-slate-400",
                  )}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Ticket className={cn("h-5 w-5", styles.sectionLabel)} />
              <h2 className={cn("text-sm font-bold uppercase tracking-widest", styles.sectionLabel)}>Gültige Tickets</h2>
              <span className={cn("text-xs font-mono font-bold border rounded-lg px-2 py-0.5 ml-auto", styles.ticketCountBorder)}>
                {ticketSearch.trim() ? `${filteredTickets.length}/${tickets.length}` : tickets.length}
              </span>
            </div>

            <div className="space-y-1.5 max-h-[calc(100vh-26rem)] lg:max-h-[calc(100vh-18rem)] overflow-y-auto pr-1 monitor-scrollbar flex-1">
              {tickets.length === 0 && (
                <p className={cn("text-sm text-center py-6", styles.sectionLabel)}>Keine aktiven Tickets</p>
              )}
              {tickets.length > 0 && filteredTickets.length === 0 && (
                <p className={cn("text-sm text-center py-6", styles.sectionLabel)}>
                  Keine Treffer für „{ticketSearch.trim()}“
                </p>
              )}
              {filteredTickets.map((ticket) => {
                const endStr = ticket.endDate
                  ? new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })
                  : null;
                const isScanning = scanningId === ticket.id;

                const now = Date.now();
                const endMs = ticket.endDate ? endOfDayMs(ticket.endDate) : null;
                const isExpired = endMs != null && endMs < now;
                const isWarning = endMs != null && !isExpired && (endMs - now) < 15 * 60_000;

                let durationExpired = false;
                let durationWarning = false;
                if (ticket.validityType === "DURATION" && ticket.validityDurationMinutes && ticket.firstScanAt) {
                  const expiresAt = new Date(ticket.firstScanAt).getTime() + ticket.validityDurationMinutes * 60_000;
                  durationExpired = expiresAt < now;
                  durationWarning = !durationExpired && (expiresAt - now) < 15 * 60_000;
                }

                const checkedIn = ticket.subscriptionId != null
                  ? scans.some((s) => s.ticket?.id === ticket.id && s.result === "GRANTED" && isSameBerlinDay(s.scanTime))
                  : scans.some((s) => s.ticket?.id === ticket.id && s.result === "GRANTED");
                const isPaused = ticket.status === "PAUSED";

                const cardBg = isScanning
                  ? dark ? "bg-emerald-950 border-emerald-500/50 ring-1 ring-emerald-500/30" : "bg-emerald-50 border-emerald-400 ring-1 ring-emerald-400/30"
                  : isPaused
                    ? dark ? "bg-orange-950/40 border-orange-700/40 opacity-70" : "bg-orange-50/80 border-orange-300 opacity-70"
                    : isExpired || durationExpired
                      ? dark ? "bg-rose-950/60 border-rose-700/50" : "bg-rose-50 border-rose-300"
                      : isWarning || durationWarning
                        ? dark ? "bg-amber-950/60 border-amber-700/50" : "bg-amber-50 border-amber-300"
                        : checkedIn
                          ? dark ? "bg-emerald-950/40 border-emerald-700/40" : "bg-emerald-50/80 border-emerald-300"
                          : styles.ticketBg;

                const badgeStyle = isPaused
                  ? dark ? "bg-orange-500/25 text-orange-200 border-orange-500/30" : "bg-orange-200 text-orange-900 border-orange-400"
                  : isExpired || durationExpired
                    ? dark ? "bg-rose-500/25 text-rose-200 border-rose-500/30" : "bg-rose-200 text-rose-900 border-rose-400"
                    : isWarning || durationWarning
                      ? dark ? "bg-amber-500/25 text-amber-200 border-amber-500/30" : "bg-amber-200 text-amber-900 border-amber-400"
                      : checkedIn
                        ? dark ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/30" : "bg-emerald-200 text-emerald-900 border-emerald-400"
                        : ticket.status === "VALID"
                          ? dark ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/30" : "bg-emerald-200 text-emerald-900 border-emerald-400"
                          : dark ? "bg-sky-500/25 text-sky-200 border-sky-500/30" : "bg-sky-200 text-sky-900 border-sky-400";

                const badgeLabel = isPaused
                  ? "Pausiert"
                  : isExpired || durationExpired
                    ? "Abgelaufen"
                    : isWarning || durationWarning
                      ? "Läuft ab"
                      : checkedIn
                        ? "Eingecheckt"
                        : ticket.status === "VALID" ? "Gültig" : "Eingelöst";

                const typeLine = monitorTicketTypeLine(ticket);
                const subParts = [typeLine, endStr ? `bis ${endStr}` : null].filter(Boolean) as string[];

                return (
                  <div
                    key={ticket.id}
                    onClick={() => handleTicketClick(ticket)}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-all duration-150 cursor-pointer select-none active:scale-[0.98]",
                      cardBg,
                      !isScanning && (dark ? "hover:bg-slate-800" : "hover:bg-slate-100"),
                    )}
                  >
                    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden", styles.ticketAvatarBg)}>
                      {ticket.profileImage ? (
                        <img src={ticket.profileImage} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Users className={cn("h-4 w-4", styles.ticketAvatarIcon)} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-bold truncate", styles.ticketName)}>
                        {[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || ticket.name}
                        {(() => { const a = calcAge(ticket.birthDate); return a != null ? <span className={cn("ml-1.5 text-xs font-normal", dark ? "text-slate-500" : "text-slate-400")}>({a})</span> : null; })()}
                      </p>
                      <p className={cn("text-xs font-medium truncate", styles.ticketSub)}>
                        {subParts.length > 0
                          ? subParts.join(" · ")
                          : <span className={dark ? "text-slate-500" : "text-slate-400"}>Ticket</span>}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      <Badge className={cn("text-[11px] px-2 py-0.5 font-bold", badgeStyle)}>
                        {badgeLabel}
                      </Badge>
                      {ticket.validityType === "DURATION" && ticket.validityDurationMinutes && ticket.firstScanAt && (
                        isPaused ? (
                          <span className={cn(
                            "text-xs font-mono px-2.5 py-1 rounded-lg tabular-nums font-bold",
                            dark ? "bg-orange-500/25 text-orange-200" : "bg-orange-200 text-orange-900"
                          )}>
                            ⏸
                          </span>
                        ) : (
                          <DurationCountdown
                            firstScanAt={ticket.firstScanAt}
                            durationMinutes={ticket.validityDurationMinutes}
                            dark={dark}
                          />
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Ticket Detail Overlay */}
      {selectedTicket && (
        <TicketDetailOverlay
          ticket={selectedTicket}
          scans={scans}
          dark={dark}
          styles={styles}
          scanningId={scanningId}
          onScan={() => handleTicketScan(selectedTicket.id)}
          onClose={() => setSelectedTicket(null)}
          token={token}
          onPaused={() => setSelectedTicket(null)}
        />
      )}
    </div>
  );
}

function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function DurationCountdown({ firstScanAt, durationMinutes, dark, size }: { firstScanAt: string; durationMinutes: number; dark: boolean; size?: "lg" }) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const expiresAt = new Date(firstScanAt).getTime() + durationMinutes * 60_000;
    const tick = () => {
      const diff = expiresAt - Date.now();
      if (diff <= 0) {
        setRemaining("abgelaufen");
        setExpired(true);
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setRemaining(h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`);
      setExpired(false);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [firstScanAt, durationMinutes]);

  const isLg = size === "lg";

  return (
    <span className={cn(
      "font-mono tabular-nums font-bold rounded-xl flex items-center gap-1.5",
      isLg ? "text-xl sm:text-2xl px-4 py-2" : "text-xs px-2.5 py-1 rounded-lg",
      expired
        ? dark ? "bg-rose-500/25 text-rose-200" : "bg-rose-200 text-rose-900"
        : dark ? "bg-violet-500/25 text-violet-200" : "bg-violet-200 text-violet-900"
    )}>
      {isLg && <Clock className={cn("h-5 w-5 sm:h-6 sm:w-6", expired ? "text-rose-300" : "text-violet-300")} />}
      {remaining}
    </span>
  );
}

function TicketDetailOverlay({
  ticket,
  scans,
  dark,
  styles,
  scanningId,
  onScan,
  onClose,
  token,
  onPaused,
}: {
  ticket: TicketInfo;
  scans: Scan[];
  dark: boolean;
  styles: Record<string, string>;
  scanningId: number | null;
  onScan: () => void;
  onClose: () => void;
  token: string;
  onPaused: () => void;
}) {
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseDuration, setPauseDuration] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseLoading, setPauseLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(() => ticket.profileImage ?? null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    setCurrentImage(ticket.profileImage ?? null);
    setImageLoading(true);
    fetch(`/api/monitor/public/${encodeURIComponent(token)}/photo?ticketId=${ticket.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCurrentImage(d.profileImage ?? null))
      .catch(() => {})
      .finally(() => setImageLoading(false));
  }, [token, ticket.id, ticket.profileImage]);

  const handleCapture = useCallback(async (dataUrl: string) => {
    setCameraOpen(false);
    setPhotoSaving(true);
    try {
      const res = await fetch(`/api/monitor/public/${token}/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, profileImage: dataUrl }),
      });
      if (res.ok) setCurrentImage(dataUrl);
    } catch { /* ignore */ }
    setPhotoSaving(false);
  }, [token, ticket.id]);

  const ticketScans = useMemo(
    () => scans.filter((s) => s.ticket?.id === ticket.id).slice(0, 20),
    [scans, ticket.id]
  );

  const name = [ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || ticket.name;
  const typeLine = monitorTicketTypeLine(ticket);
  const endStr = ticket.endDate
    ? new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : null;
  const headerSubParts = [typeLine, endStr ? `bis ${endStr}` : null].filter(Boolean) as string[];
  const startStr = ticket.startDate
    ? new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : null;
  const isScanning = scanningId === ticket.id;

  const handlePause = async () => {
    if (!pauseDuration) return;
    setPauseLoading(true);
    try {
      const res = await fetch(`/api/monitor/public/${token}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, duration: pauseDuration, reason: pauseReason }),
      });
      if (res.ok) onPaused();
    } finally {
      setPauseLoading(false);
    }
  };

  const durationOptions = [
    { value: "1h", label: "1 Stunde" },
    { value: "1d", label: "1 Tag" },
    { value: "1w", label: "1 Woche" },
    { value: "1m", label: "1 Monat" },
  ];

  return (
    <div className={cn("fixed inset-0 z-50 flex flex-col", styles.page)}>
      <header className={cn("border-b px-4 py-3 flex items-center gap-3", styles.header)}>
        <button onClick={onClose} className={cn("p-2 -ml-2 rounded-xl", styles.modeBtnBg)}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className={cn("font-bold truncate", styles.headerTitle)}>{name}</h2>
          <p className={cn("text-xs", styles.headerSub)}>
            {headerSubParts.length > 0 ? headerSubParts.join(" · ") : "Ticket"}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 monitor-scrollbar">
        {/* Ticket Info */}
        <div className={cn("rounded-2xl border p-4 flex items-center gap-4", styles.ticketBg)}>
          {currentImage ? (
            <img src={currentImage} alt="" className={cn("h-16 w-16 rounded-2xl object-cover shrink-0 ring-1", styles.imgRing)} />
          ) : (
            <div className={cn("h-16 w-16 rounded-2xl flex items-center justify-center shrink-0", styles.ticketAvatarBg)}>
              <Users className={cn("h-6 w-6", styles.ticketAvatarIcon)} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className={cn("text-lg font-bold", styles.ticketName)}>
              {name}
              {(() => { const a = calcAge(ticket.birthDate); return a != null ? <span className={cn("ml-1.5 text-sm font-normal", dark ? "text-slate-500" : "text-slate-400")}>({a} J.)</span> : null; })()}
            </p>
            <p className={cn("text-sm", styles.ticketSub)}>
              {typeLine ?? "Ticket"}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge className={cn(
                "text-xs px-2 py-0.5 font-bold",
                ticket.status === "PAUSED"
                  ? dark ? "bg-orange-500/25 text-orange-200 border-orange-500/30" : "bg-orange-200 text-orange-900 border-orange-400"
                  : ticket.status === "VALID"
                    ? dark ? "bg-emerald-500/25 text-emerald-200 border-emerald-500/30" : "bg-emerald-200 text-emerald-900 border-emerald-400"
                    : dark ? "bg-sky-500/25 text-sky-200 border-sky-500/30" : "bg-sky-200 text-sky-900 border-sky-400"
              )}>
                {ticket.status === "PAUSED" ? "Pausiert" : ticket.status === "VALID" ? "Gültig" : "Eingelöst"}
              </Badge>
              {startStr && endStr && (
                <span className={cn("text-xs", styles.ticketSub)}>{startStr} – {endStr}</span>
              )}
            </div>
          </div>
        </div>

        {/* Checkin Button */}
        <button
          onClick={onScan}
          disabled={isScanning}
          className={cn(
            "w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]",
            isScanning
              ? dark ? "bg-emerald-800 text-emerald-200" : "bg-emerald-200 text-emerald-900"
              : dark ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white",
          )}
        >
          <LogIn className="h-5 w-5" />
          {isScanning ? "Eingecheckt!" : "Einchecken"}
        </button>

        {/* Pause Button */}
        {!pauseOpen ? (
          <button
            onClick={() => setPauseOpen(true)}
            className={cn(
              "w-full py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]",
              dark ? "bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30" : "bg-orange-100 hover:bg-orange-200 text-orange-800 border border-orange-300",
            )}
          >
            <Pause className="h-4 w-4" />
            Pausieren
          </button>
        ) : (
          <div className={cn("rounded-2xl border p-4 space-y-3", dark ? "border-orange-500/30 bg-orange-950/20" : "border-orange-300 bg-orange-50")}>
            <div className="flex items-center gap-2">
              <Pause className={cn("h-4 w-4", dark ? "text-orange-400" : "text-orange-600")} />
              <p className={cn("text-sm font-bold", dark ? "text-orange-300" : "text-orange-800")}>Ticket pausieren</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {durationOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPauseDuration(pauseDuration === opt.value ? null : opt.value)}
                  className={cn(
                    "py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95",
                    pauseDuration === opt.value
                      ? dark ? "bg-orange-600 text-white" : "bg-orange-600 text-white"
                      : dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              placeholder="Begründung (optional)"
              className={cn(
                "w-full rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50",
                dark ? "bg-slate-800 border border-slate-700 text-white placeholder:text-slate-500" : "bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400",
              )}
            />

            <div className="flex gap-2">
              <button
                onClick={handlePause}
                disabled={!pauseDuration || pauseLoading}
                className={cn(
                  "flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50",
                  dark ? "bg-orange-600 hover:bg-orange-500 text-white" : "bg-orange-600 hover:bg-orange-500 text-white",
                )}
              >
                {pauseLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                Pausieren
              </button>
              <button
                onClick={() => { setPauseOpen(false); setPauseDuration(null); setPauseReason(""); }}
                className={cn(
                  "py-3 px-5 rounded-xl font-semibold text-sm transition-all active:scale-95",
                  dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700",
                )}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {/* Photo Button */}
        <button
          onClick={() => setCameraOpen(true)}
          disabled={photoSaving}
          className={cn(
            "w-full py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]",
            dark ? "bg-slate-800 hover:bg-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700",
          )}
        >
          {photoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          Foto {currentImage ? "ändern" : "aufnehmen"}
        </button>

        {/* Scan History */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ScanLine className={cn("h-4 w-4", styles.sectionLabel)} />
            <h3 className={cn("text-xs font-bold uppercase tracking-widest", styles.sectionLabel)}>Scan-Verlauf</h3>
            <span className={cn("text-xs font-mono font-bold border rounded-lg px-1.5 py-0.5 ml-auto", styles.ticketCountBorder)}>{ticketScans.length}</span>
          </div>
          {ticketScans.length === 0 ? (
            <p className={cn("text-sm text-center py-6", styles.sectionLabel)}>Noch keine Scans</p>
          ) : (
            <div className="space-y-1.5">
              {ticketScans.map((scan) => {
                const isGranted = scan.result === "GRANTED";
                return (
                  <div
                    key={scan.id}
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-3 py-2.5",
                      isGranted ? styles.scanGranted : styles.scanDenied,
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {isGranted ? (
                        <CheckCircle2 className={cn("h-5 w-5 shrink-0", dark ? "text-emerald-400" : "text-emerald-600")} />
                      ) : (
                        <XCircle className={cn("h-5 w-5 shrink-0", dark ? "text-rose-400" : "text-rose-600")} />
                      )}
                      <div>
                        <p className={cn("text-sm font-semibold", styles.scanName)}>
                          {isGranted ? "Erlaubt" : "Abgelehnt"}
                        </p>
                        <p className={cn("text-xs", styles.scanSub)}>
                          {scan.device?.name ?? "Monitor"}
                        </p>
                      </div>
                    </div>
                    <span className={cn("text-sm tabular-nums font-mono font-semibold", styles.scanTime)}>
                      {fmtTime(scan.scanTime)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {cameraOpen && (
        <CameraCapture
          dark={dark}
          onCapture={handleCapture}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

function CameraCapture({ dark, onCapture, onClose }: { dark: boolean; onCapture: (dataUrl: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 720 }, height: { ideal: 720 } } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const snap = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 512, 512);
    setPreview(canvas.toDataURL("image/jpeg", 0.8));
    streamRef.current?.getTracks().forEach((t) => t.stop());
  };

  const retake = () => {
    setPreview(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 720 }, height: { ideal: 720 } } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      })
      .catch(() => {});
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95">
      <canvas ref={canvasRef} className="hidden" />
      {!preview ? (
        <>
          <div className="relative w-full max-w-[320px] aspect-square rounded-3xl overflow-hidden bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-white/60 animate-spin" />
              </div>
            )}
          </div>
          <div className="flex gap-4 mt-6">
            <button
              onClick={snap}
              disabled={!ready}
              className="h-16 w-16 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40"
            >
              <div className="h-14 w-14 rounded-full border-[3px] border-black/20" />
            </button>
          </div>
          <button
            onClick={() => { streamRef.current?.getTracks().forEach((t) => t.stop()); onClose(); }}
            className="mt-4 text-white/70 text-sm font-semibold hover:text-white transition-colors"
          >
            Abbrechen
          </button>
        </>
      ) : (
        <>
          <div className="relative w-full max-w-[320px] aspect-square rounded-3xl overflow-hidden">
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
          </div>
          <div className="flex gap-4 mt-6">
            <button
              onClick={retake}
              className={cn(
                "py-3 px-6 rounded-2xl font-semibold text-sm transition-all active:scale-95",
                "bg-white/10 text-white hover:bg-white/20",
              )}
            >
              Nochmal
            </button>
            <button
              onClick={() => onCapture(preview)}
              className={cn(
                "py-3 px-6 rounded-2xl font-bold text-sm transition-all active:scale-95",
                "bg-indigo-600 text-white hover:bg-indigo-500",
              )}
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Verwenden
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LiveClock({ dark, styles, allPaused, pauseToggling, onClick }: { dark: boolean; styles: Record<string, string>; allPaused: boolean; pauseToggling: boolean; onClick: () => void }) {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString("de-DE"));
      setDate(new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <button
      onClick={onClick}
      disabled={pauseToggling}
      className={cn(
        "rounded-2xl border px-5 py-4 text-center transition-all duration-500 cursor-pointer active:scale-[0.97] w-full",
        allPaused
          ? dark ? "bg-rose-950 border-rose-600/60 ring-2 ring-rose-500/30" : "bg-rose-100 border-rose-400 ring-2 ring-rose-400/30"
          : styles.clockBg,
        pauseToggling && "opacity-60",
      )}
    >
      {allPaused && (
        <div className="flex items-center justify-center gap-2 mb-1">
          <Pause className={cn("h-4 w-4", dark ? "text-rose-400" : "text-rose-600")} />
          <span className={cn("text-xs font-bold uppercase tracking-widest", dark ? "text-rose-400" : "text-rose-600")}>Pausiert</span>
        </div>
      )}
      <p className={cn(
        "text-4xl font-mono font-black tracking-tight tabular-nums",
        allPaused ? (dark ? "text-rose-200" : "text-rose-900") : styles.clockText,
      )}>{time}</p>
      <p className={cn(
        "text-sm mt-1 font-bold",
        allPaused ? (dark ? "text-rose-400" : "text-rose-600") : styles.clockSub,
      )}>{date}</p>
    </button>
  );
}
