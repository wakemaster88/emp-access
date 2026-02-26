"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Shield, Wifi, WifiOff, CheckCircle2, XCircle, Clock, ScanLine, Users, Ticket } from "lucide-react";
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
  ticketId: number | null;
  ticketName: string;
  personName: string;
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
      if (
        lastGroup &&
        ticketId != null &&
        lastGroup.ticketId === ticketId &&
        lastGroup.result === scan.result
      ) {
        lastGroup.scans.push(scan);
      } else {
        groups.push({
          ticketId,
          ticketName: scan.ticket?.name || scan.code,
          personName: [scan.ticket?.firstName, scan.ticket?.lastName].filter(Boolean).join(" ") || "",
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

  const resultStyle = {
    GRANTED: {
      bg: "bg-emerald-500/10 border-emerald-500/20",
      text: "text-emerald-400",
      badge: "bg-emerald-500/20 text-emerald-300",
      icon: CheckCircle2,
      label: "Erlaubt",
    },
    DENIED: {
      bg: "bg-rose-500/10 border-rose-500/20",
      text: "text-rose-400",
      badge: "bg-rose-500/20 text-rose-300",
      icon: XCircle,
      label: "Abgelehnt",
    },
    PROTECTED: {
      bg: "bg-amber-500/10 border-amber-500/20",
      text: "text-amber-400",
      badge: "bg-amber-500/20 text-amber-300",
      icon: Clock,
      label: "Geschützt",
    },
  } as const;

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">{monitorName || "Live Monitor"}</h1>
            <p className="text-xs text-slate-400">EMP Access — Echtzeit-Zugangsmonitor</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {devices.map((device) => {
            const online = device.lastUpdate ? new Date(device.lastUpdate) > fiveMinAgo : false;
            return (
              <div key={device.id} className="flex items-center gap-1.5">
                <div className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  online ? "bg-emerald-400 shadow-[0_0_6px_1px_rgba(52,211,153,0.4)]" : "bg-slate-600"
                )} />
                <span className="text-xs text-slate-400">{device.name}</span>
              </div>
            );
          })}
          {connected ? (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 gap-1.5 ml-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </Badge>
          ) : (
            <Badge className="bg-slate-700 text-slate-400 gap-1.5 ml-2">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
              Verbinde…
            </Badge>
          )}
        </div>
      </header>

      <div className="flex-1 p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
          {/* Scan Feed */}
          <div className="lg:col-span-2 space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <ScanLine className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Letzte Scans</h2>
            </div>
            {scans.length === 0 && (
              <div className="rounded-xl border border-slate-800 p-10 text-center text-slate-500">
                Warte auf Scans…
              </div>
            )}
            <div className="space-y-2 max-h-[calc(100vh-10rem)] overflow-y-auto pr-1">
              {groupedScans.map((group) => {
                const style = resultStyle[group.result];
                const Icon = style.icon;
                const isNew = group.scans.some((s) => newIds.has(s.id));
                const scanCount = group.scans.length;

                return (
                  <div
                    key={group.scans[0].id}
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-4 py-3 transition-all",
                      style.bg,
                      isNew && "animate-scan-flash ring-2 ring-offset-1 ring-offset-slate-950",
                      isNew && group.result === "GRANTED" && "ring-emerald-400",
                      isNew && group.result === "DENIED" && "ring-rose-400",
                      isNew && group.result === "PROTECTED" && "ring-amber-400",
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {group.profileImage ? (
                        <img src={group.profileImage} alt="" className="h-14 w-14 rounded-full object-cover shrink-0 ring-2 ring-slate-700" />
                      ) : (
                        <Icon className={cn("h-5 w-5 shrink-0", style.text)} />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-slate-100 text-sm truncate">
                          {group.personName || group.ticketName}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {group.personName ? `${group.ticketName} · ` : ""}{group.scans[0].device.name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {group.validityType === "DURATION" && group.validityDurationMinutes && group.firstScanAt && (
                        <DurationCountdown
                          firstScanAt={group.firstScanAt}
                          durationMinutes={group.validityDurationMinutes}
                        />
                      )}
                      {scanCount > 1 && (
                        <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-300 tabular-nums">
                          ×{scanCount}
                        </span>
                      )}
                      <span className={cn("text-xs px-2 py-0.5 rounded-full", style.badge)}>
                        {style.label}
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {fmtTime(group.latestScanTime)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Side: Tickets + Clock */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Ticket className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Gültige Tickets</h2>
              <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-500 ml-auto">{tickets.length}</Badge>
            </div>

            <div className="space-y-1.5 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
              {tickets.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">Keine aktiven Tickets</p>
              )}
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5"
                >
                  {ticket.profileImage ? (
                    <img src={ticket.profileImage} alt="" className="h-10 w-10 rounded-full object-cover shrink-0 ring-1 ring-slate-700" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
                      <Users className="h-4 w-4 text-slate-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || ticket.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {ticket.ticketTypeName || ticket.name}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-0.5">
                    <Badge className={cn(
                      "text-[10px] px-1.5 py-0",
                      ticket.status === "VALID"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : "bg-sky-500/20 text-sky-400 border-sky-500/30"
                    )}>
                      {ticket.status === "VALID" ? "Gültig" : "Eingelöst"}
                    </Badge>
                    {ticket.validityType === "DURATION" && ticket.validityDurationMinutes && ticket.firstScanAt && (
                      <DurationCountdown
                        firstScanAt={ticket.firstScanAt}
                        durationMinutes={ticket.validityDurationMinutes}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <LiveClock />
          </div>
        </div>
      </div>
    </div>
  );
}

function DurationCountdown({ firstScanAt, durationMinutes }: { firstScanAt: string; durationMinutes: number }) {
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
      "text-xs font-mono px-2 py-0.5 rounded-full tabular-nums",
      expired
        ? "bg-rose-500/20 text-rose-300"
        : "bg-violet-500/20 text-violet-300"
    )}>
      {remaining}
    </span>
  );
}

function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("de-DE"));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-center">
      <p className="text-3xl font-mono font-bold text-slate-200">{time}</p>
      <p className="text-xs text-slate-500 mt-1">{new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}</p>
    </div>
  );
}
