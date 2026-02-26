"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2, XCircle, Clock, ScanLine, Users, Ticket, Sun, Moon } from "lucide-react";
import { cn, fmtTime } from "@/lib/utils";

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
  result: "GRANTED" | "DENIED" | "PROTECTED";
  scanTime: string;
  device: { id: number; name: string };
  ticket: {
    id?: number;
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    ticketTypeName?: string | null;
    validityType?: string;
    validityDurationMinutes?: number | null;
    firstScanAt?: string | null;
    profileImage?: string | null;
  } | null;
}

interface TicketInfo {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  status: string;
  profileImage: string | null;
  validityType: string;
  validityDurationMinutes: number | null;
  firstScanAt: string | null;
  startDate: string | null;
  endDate: string | null;
  slotStart: string | null;
  slotEnd: string | null;
}

interface ScanGroup {
  groupKey: string;
  ticketId: number | null;
  ticketName: string;
  personName: string;
  ticketTypeName: string;
  profileImage: string | null;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  scans: Scan[];
  latestScanTime: string;
  validityType?: string;
  validityDurationMinutes?: number | null;
  firstScanAt?: string | null;
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
  const esRef = useRef<EventSource | null>(null);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`/api/monitor/public/${token}`);
      esRef.current = es;

      es.onopen = () => { setConnected(true); setError(""); };
      es.onerror = () => {
        setConnected(false);
        es.close();
        setTimeout(connect, 3000);
      };

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "meta") {
          setMonitorName(msg.data.name);
          setDevices(msg.data.devices);
        } else if (msg.type === "scans") {
          const incoming = msg.data as Scan[];
          setScans((prev) => {
            const existing = new Set(prev.map((s) => s.id));
            const fresh = incoming.filter((s) => !existing.has(s.id));
            if (!isFirstLoad.current && fresh.length > 0) {
              setNewIds(new Set(fresh.map((s) => s.id)));
              setTimeout(() => setNewIds(new Set()), 1500);
            }
            isFirstLoad.current = false;
            return [...fresh, ...prev].slice(0, 50);
          });
        } else if (msg.type === "tickets") {
          setTickets(msg.data);
        } else if (msg.type === "devices") {
          setDevices(msg.data);
        }
      };
    }

    connect();
    return () => { esRef.current?.close(); };
  }, [token]);

  const groupedScans = useMemo(() => {
    const groups: ScanGroup[] = [];
    for (const scan of scans) {
      const lastGroup = groups[groups.length - 1];
      const ticketId = scan.ticket?.id ?? null;
      const key = ticketId != null ? `t:${ticketId}` : `c:${scan.code}`;

      if (lastGroup && lastGroup.groupKey === key && lastGroup.result === scan.result) {
        lastGroup.scans.push(scan);
      } else {
        groups.push({
          groupKey: key,
          ticketId,
          ticketName: scan.ticket?.name || scan.code,
          personName: [scan.ticket?.firstName, scan.ticket?.lastName].filter(Boolean).join(" ") || "",
          ticketTypeName: scan.ticket?.ticketTypeName || "",
          profileImage: scan.ticket?.profileImage ?? null,
          result: scan.result,
          scans: [scan],
          latestScanTime: scan.scanTime,
          validityType: scan.ticket?.validityType,
          validityDurationMinutes: scan.ticket?.validityDurationMinutes,
          firstScanAt: scan.ticket?.firstScanAt,
        });
      }
    }
    return groups;
  }, [scans]);

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const styles = dark ? {
    page: "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100",
    header: "border-slate-800/60 bg-slate-900/50 backdrop-blur-xl",
    headerTitle: "text-white",
    headerSub: "text-slate-400",
    deviceDot: "bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.5)]",
    deviceDotOff: "bg-slate-600",
    deviceText: "text-slate-400",
    liveBadge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    connectBadge: "bg-slate-800 text-slate-400",
    sectionLabel: "text-slate-500",
    emptyBg: "border-slate-800/50 bg-slate-900/30 text-slate-600",
    scanGranted: "bg-emerald-500/8 border-emerald-500/15 hover:bg-emerald-500/12",
    scanDenied: "bg-rose-500/8 border-rose-500/15 hover:bg-rose-500/12",
    scanProtected: "bg-amber-500/8 border-amber-500/15 hover:bg-amber-500/12",
    scanName: "text-slate-50",
    scanSub: "text-slate-400",
    scanTime: "text-slate-500",
    scanCountBg: "bg-white/5 text-slate-300",
    imgRing: "ring-slate-700/60",
    clockBg: "bg-gradient-to-br from-indigo-600/20 via-violet-600/15 to-purple-600/10 border-indigo-500/20",
    clockText: "text-white",
    clockSub: "text-indigo-300/60",
    ticketBg: "border-slate-800/50 bg-slate-900/40 hover:bg-slate-800/50",
    ticketName: "text-slate-100",
    ticketSub: "text-slate-500",
    ticketAvatarBg: "bg-slate-800/80",
    ticketAvatarIcon: "text-slate-600",
    ticketCountBorder: "border-slate-700/50 text-slate-500",
    ringOffset: "ring-offset-slate-950",
    modeBtnBg: "bg-slate-800/60 hover:bg-slate-700/60 text-slate-400",
  } : {
    page: "bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900",
    header: "border-slate-200/80 bg-white/70 backdrop-blur-xl",
    headerTitle: "text-slate-900",
    headerSub: "text-slate-500",
    deviceDot: "bg-emerald-500 shadow-[0_0_8px_2px_rgba(16,185,129,0.4)]",
    deviceDotOff: "bg-slate-300",
    deviceText: "text-slate-500",
    liveBadge: "bg-emerald-50 text-emerald-600 border-emerald-200",
    connectBadge: "bg-slate-100 text-slate-400",
    sectionLabel: "text-slate-400",
    emptyBg: "border-slate-200 bg-slate-50 text-slate-400",
    scanGranted: "bg-emerald-50/80 border-emerald-200/60 hover:bg-emerald-50",
    scanDenied: "bg-rose-50/80 border-rose-200/60 hover:bg-rose-50",
    scanProtected: "bg-amber-50/80 border-amber-200/60 hover:bg-amber-50",
    scanName: "text-slate-900",
    scanSub: "text-slate-500",
    scanTime: "text-slate-400",
    scanCountBg: "bg-slate-200/60 text-slate-600",
    imgRing: "ring-slate-200",
    clockBg: "bg-gradient-to-br from-indigo-500/10 via-violet-500/8 to-purple-500/5 border-indigo-200/60",
    clockText: "text-slate-900",
    clockSub: "text-indigo-400/70",
    ticketBg: "border-slate-200/80 bg-white/60 hover:bg-white",
    ticketName: "text-slate-900",
    ticketSub: "text-slate-400",
    ticketAvatarBg: "bg-slate-100",
    ticketAvatarIcon: "text-slate-400",
    ticketCountBorder: "border-slate-200 text-slate-400",
    ringOffset: "ring-offset-white",
    modeBtnBg: "bg-slate-100 hover:bg-slate-200 text-slate-500",
  };

  const resultConfig = {
    GRANTED: {
      icon: CheckCircle2,
      label: "Erlaubt",
      text: dark ? "text-emerald-400" : "text-emerald-600",
      badge: dark ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-100 text-emerald-700",
      ring: "ring-emerald-400",
      bg: styles.scanGranted,
    },
    DENIED: {
      icon: XCircle,
      label: "Abgelehnt",
      text: dark ? "text-rose-400" : "text-rose-600",
      badge: dark ? "bg-rose-500/20 text-rose-300" : "bg-rose-100 text-rose-700",
      ring: "ring-rose-400",
      bg: styles.scanDenied,
    },
    PROTECTED: {
      icon: Clock,
      label: "Geschützt",
      text: dark ? "text-amber-400" : "text-amber-600",
      badge: dark ? "bg-amber-500/20 text-amber-300" : "bg-amber-100 text-amber-700",
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
      <header className={cn("border-b px-6 py-3.5 flex items-center justify-between transition-colors duration-300", styles.header)}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className={cn("text-lg font-bold tracking-tight", styles.headerTitle)}>{monitorName || "Live Monitor"}</h1>
            <p className={cn("text-[11px]", styles.headerSub)}>EMP Access — Echtzeit-Zugangsmonitor</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {devices.map((device) => {
            const online = device.lastUpdate ? new Date(device.lastUpdate) > fiveMinAgo : false;
            return (
              <div key={device.id} className="flex items-center gap-1.5">
                <div className={cn("h-2 w-2 rounded-full transition-all", online ? styles.deviceDot : styles.deviceDotOff)} />
                <span className={cn("text-xs font-medium", styles.deviceText)}>{device.name}</span>
              </div>
            );
          })}
          <button
            onClick={() => setDark((d) => !d)}
            className={cn("p-2 rounded-lg transition-colors", styles.modeBtnBg)}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {connected ? (
            <Badge className={cn("gap-1.5 font-medium", styles.liveBadge)}>
              <span className={cn("h-2 w-2 rounded-full animate-pulse", dark ? "bg-emerald-400" : "bg-emerald-500")} />
              Live
            </Badge>
          ) : (
            <Badge className={cn("gap-1.5", styles.connectBadge)}>
              <span className="h-2 w-2 rounded-full bg-slate-400 animate-pulse" />
              Verbinde…
            </Badge>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 h-full">
          {/* Scan Feed */}
          <div className="lg:col-span-2 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <ScanLine className={cn("h-4 w-4", styles.sectionLabel)} />
              <h2 className={cn("text-xs font-semibold uppercase tracking-widest", styles.sectionLabel)}>Letzte Scans</h2>
            </div>
            {scans.length === 0 && (
              <div className={cn("rounded-2xl border p-12 text-center text-sm", styles.emptyBg)}>
                Warte auf Scans…
              </div>
            )}
            <div className="space-y-1.5 max-h-[calc(100vh-9rem)] overflow-y-auto pr-1 monitor-scrollbar">
              {groupedScans.map((group) => {
                const rc = resultConfig[group.result];
                const Icon = rc.icon;
                const isNew = group.scans.some((s) => newIds.has(s.id));
                const scanCount = group.scans.length;

                return (
                  <div
                    key={group.scans[0].id}
                    className={cn(
                      "flex items-center justify-between rounded-2xl border px-4 py-3 transition-all duration-200",
                      rc.bg,
                      isNew && `animate-scan-flash ring-2 ring-offset-1 ${styles.ringOffset}`,
                      isNew && rc.ring,
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {group.profileImage ? (
                        <img src={group.profileImage} alt="" className={cn("h-12 w-12 rounded-2xl object-cover shrink-0 ring-2", styles.imgRing)} />
                      ) : (
                        <div className={cn("h-10 w-10 rounded-2xl flex items-center justify-center shrink-0", dark ? "bg-white/5" : "bg-slate-100")}>
                          <Icon className={cn("h-5 w-5", rc.text)} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className={cn("font-semibold text-sm truncate", styles.scanName)}>
                          {group.personName || group.ticketName}
                        </p>
                        <p className={cn("text-xs truncate", styles.scanSub)}>
                          {group.ticketTypeName ? `${group.ticketTypeName} · ` : ""}{group.scans[0].device.name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {group.validityType === "DURATION" && group.validityDurationMinutes && group.firstScanAt && (
                        <DurationCountdown
                          firstScanAt={group.firstScanAt}
                          durationMinutes={group.validityDurationMinutes}
                          dark={dark}
                        />
                      )}
                      {scanCount > 1 && (
                        <span className={cn("text-[11px] font-mono font-medium px-2 py-0.5 rounded-lg tabular-nums", styles.scanCountBg)}>
                          ×{scanCount}
                        </span>
                      )}
                      <span className={cn("text-[11px] font-medium px-2.5 py-1 rounded-lg", rc.badge)}>
                        {rc.label}
                      </span>
                      <span className={cn("text-xs tabular-nums font-mono", styles.scanTime)}>
                        {fmtTime(group.latestScanTime)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Side */}
          <div className="flex flex-col gap-4">
            <LiveClock dark={dark} styles={styles} />

            <div className="flex items-center gap-2">
              <Ticket className={cn("h-4 w-4", styles.sectionLabel)} />
              <h2 className={cn("text-xs font-semibold uppercase tracking-widest", styles.sectionLabel)}>Gültige Tickets</h2>
              <span className={cn("text-[10px] font-mono border rounded-md px-1.5 py-0.5 ml-auto", styles.ticketCountBorder)}>{tickets.length}</span>
            </div>

            <div className="space-y-1.5 max-h-[calc(100vh-18rem)] overflow-y-auto pr-1 monitor-scrollbar flex-1">
              {tickets.length === 0 && (
                <p className={cn("text-sm text-center py-6", styles.sectionLabel)}>Keine aktiven Tickets</p>
              )}
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className={cn("flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors duration-150", styles.ticketBg)}
                >
                  {ticket.profileImage ? (
                    <img src={ticket.profileImage} alt="" className={cn("h-10 w-10 rounded-xl object-cover shrink-0 ring-1", styles.imgRing)} />
                  ) : (
                    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", styles.ticketAvatarBg)}>
                      <Users className={cn("h-4 w-4", styles.ticketAvatarIcon)} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold truncate", styles.ticketName)}>
                      {[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || ticket.name}
                    </p>
                    <p className={cn("text-xs truncate", styles.ticketSub)}>
                      {ticket.ticketTypeName || ticket.name}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-0.5">
                    <Badge className={cn(
                      "text-[10px] px-1.5 py-0 font-medium",
                      ticket.status === "VALID"
                        ? dark ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : dark ? "bg-sky-500/15 text-sky-400 border-sky-500/25" : "bg-sky-50 text-sky-700 border-sky-200"
                    )}>
                      {ticket.status === "VALID" ? "Gültig" : "Eingelöst"}
                    </Badge>
                    {ticket.validityType === "DURATION" && ticket.validityDurationMinutes && ticket.firstScanAt && (
                      <DurationCountdown
                        firstScanAt={ticket.firstScanAt}
                        durationMinutes={ticket.validityDurationMinutes}
                        dark={dark}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DurationCountdown({ firstScanAt, durationMinutes, dark }: { firstScanAt: string; durationMinutes: number; dark: boolean }) {
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

  return (
    <span className={cn(
      "text-xs font-mono px-2 py-0.5 rounded-lg tabular-nums font-medium",
      expired
        ? dark ? "bg-rose-500/20 text-rose-300" : "bg-rose-100 text-rose-600"
        : dark ? "bg-violet-500/20 text-violet-300" : "bg-violet-100 text-violet-600"
    )}>
      {remaining}
    </span>
  );
}

function LiveClock({ dark, styles }: { dark: boolean; styles: Record<string, string> }) {
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
    <div className={cn("rounded-2xl border px-5 py-4 text-center transition-colors duration-300", styles.clockBg)}>
      <p className={cn("text-4xl font-mono font-bold tracking-tight tabular-nums", styles.clockText)}>{time}</p>
      <p className={cn("text-xs mt-1 font-medium", styles.clockSub)}>{date}</p>
    </div>
  );
}
