"use client";

/** Poll-Takt des oeffentlichen Scan-Monitors (5 s statt 3 s: 17.000 statt 29.000 Aufrufe am Tag). */
const PUBLIC_MONITOR_POLL_MS = 5000;

import { useEffect, useRef, useState, useMemo, useCallback, use } from "react";
import { useWakeLock } from "@/hooks/use-wake-lock";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { Segmented } from "@/components/ui/segmented";
import { StatusDot } from "@/components/ui/status-dot";
import { CheckCircle2, XCircle, Clock, ScanLine, Users, Ticket, Sun, Moon, ChevronLeft, ChevronDown, LogIn, Pause, Loader2, Camera, Search, Megaphone, X, Power, PowerOff, AlertTriangle, Check, Volume2, VolumeX, Trophy } from "lucide-react";
import { cn, fmtTime } from "@/lib/utils";
import { isSameBerlinDay, berlinYmd } from "@/lib/berlin-day";
import { monitorTicketTypeLine, monitorSlotLabel, slotLabelStartMinutes, isMonitorFocusTicket } from "@/lib/monitor-ticket-subtitle";
import { isLatchingSwitchDevice, visibleDeviceControls } from "@/lib/device-controls";
import { parseScanDisplayNote, scanDenyReasonLabel } from "@/lib/scan-deny-reason";

function endOfDayMs(dateStr: string): number {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Ergebnis eines Scans als volle Fläche in der Zustandsfarbe (docs/design-regeln.md,
 * Abschnitte 15 und 20): erlaubt = success, abgelehnt = destructive, geschützt =
 * warning. Die Tokens haben je einen Wert für Hell und Dunkel; welcher gilt,
 * entscheidet die Klasse `dark` an der Wurzel des Monitors.
 * Deckender Grund (`bg-background`) unter dem Verlauf: Sonst scheint das blau-violette
 * Ambient durch und färbt Grün ins Türkis, Rot ins Violett. `bg-linear-to-*` statt
 * `bg-gradient-to-*`: tailwind-merge hält Letzteres für eine Hintergrundfarbe und
 * würfe `bg-background` in `cn()` sonst weg.
 */
const RESULT_SURFACE = {
  GRANTED: "border-success/55 bg-background bg-linear-to-br from-success/32 to-success/16",
  DENIED: "border-destructive/55 bg-background bg-linear-to-br from-destructive/32 to-destructive/16",
  PROTECTED: "border-warning/60 bg-background bg-linear-to-br from-warning/32 to-warning/16",
} as const;

/** Leichtere Tönung für Zeilen in einer Karte (ältere Scans, Scan-Verlauf eines Tickets). */
const RESULT_TILE = {
  GRANTED: "border-success/45 bg-linear-to-br from-success/22 to-transparent",
  DENIED: "border-destructive/45 bg-linear-to-br from-destructive/22 to-transparent",
  PROTECTED: "border-warning/50 bg-linear-to-br from-warning/22 to-transparent",
} as const;

/** Symbol, Beschriftung und Farbe je Ergebnis – eine Quelle für Karten, Feed und Scan-Verlauf (Abschnitt 3). */
const RESULT_CONFIG = {
  GRANTED: {
    icon: CheckCircle2,
    label: "Erlaubt",
    text: "text-success",
    ring: "ring-success",
    ringInset: "inset-ring-success",
    bg: RESULT_SURFACE.GRANTED,
    tile: RESULT_TILE.GRANTED,
  },
  DENIED: {
    icon: XCircle,
    label: "Abgelehnt",
    text: "text-destructive",
    ring: "ring-destructive",
    ringInset: "inset-ring-destructive",
    bg: RESULT_SURFACE.DENIED,
    tile: RESULT_TILE.DENIED,
  },
  PROTECTED: {
    icon: Clock,
    label: "Geschützt",
    text: "text-warning",
    ring: "ring-warning",
    ringInset: "inset-ring-warning",
    bg: RESULT_SURFACE.PROTECTED,
    tile: RESULT_TILE.PROTECTED,
  },
} as const;

/** Leichte Tönung für Ticket-Zeilen (Kachel in der Karte): Verlauf und Rand in der Zustandsfarbe. */
const ROW_TINT = {
  success: "border-success/35 bg-linear-to-br from-success/14 to-success/[0.03]",
  warning: "border-warning/40 bg-linear-to-br from-warning/16 to-warning/[0.03]",
  danger: "border-destructive/40 bg-linear-to-br from-destructive/14 to-destructive/[0.03]",
} as const;

interface Device {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
  lastUpdate: string | null;
  task: number;
}

interface ControlDevice {
  id: number;
  name: string;
  type: string;
  category: string | null;
  isActive: boolean;
  output: boolean | null;
  controls: { action: string; label: string; role: "primary" | "secondary" | "danger" }[];
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
  /** ANNY-UUID `anny:CID:SVC:BID` – zum Extrahieren der Customer-ID fuer
   *  Multi-Area-Buchungs-Gruppierung. NULL bei nicht-ANNY-Tickets. */
  uuid: string | null;
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
  serviceId: number | null;
  /** Anzahl ServiceAreas am verknuepften Service. >=2 ⇒ ANNY liefert pro
   *  Person mehrere bookings (Multi-Area), die im Monitor zu einer
   *  Karte zusammengefasst werden. */
  serviceAreaCount: number;
  source: string | null;
  service?: { name: string } | null;
  subscription?: { name: string } | null;
  accessArea?: { name: string } | null;
  /** Flag aus dem Poll – Bild wird bei Bedarf lazy via /photo-Endpoint geladen. */
  hasPhoto?: boolean;
}

/** Logische Gruppe von TicketInfos, die zur selben echten Person+Buchung
 *  gehoeren. Bei Single-Tickets enthaelt members genau ein Element.
 *  Bei Multi-Area-ANNY-Buchungen (z.B. Aquapark Tageskarte = Aquapark
 *  + Strandbad) werden N Tickets desselben Customers im selben Service
 *  und am selben Tag zu einer Karte zusammengefasst. */
interface TicketGroup {
  /** Das "fuehrende" Ticket. Wird fuer Anzeige (Name, Foto, Status …)
   *  verwendet. Bevorzugt das erste VALID, sonst das erste der Gruppe. */
  representative: TicketInfo;
  members: TicketInfo[];
  /** Anzahl echter Personen in der Gruppe (members.length / serviceAreaCount,
   *  oder members.length bei Single-Tickets). */
  personCount: number;
  /** Wie viele dieser Personen sind heute schon eingecheckt (per REDEEMED
   *  Status berechnet, NICHT per Scan-Count - das wuerde bei nur 1 von 2
   *  gescannten Areas einer Person falsch zaehlen). */
  redeemedPersonCount: number;
}

interface Announcement {
  id: number;
  message: string;
  sourceLabel: string | null;
  createdAt: string;
}

type ScanLeaderBoard = {
  day: { ticketIds: number[]; count: number } | null;
  week: { ticketIds: number[]; count: number } | null;
  month: { ticketIds: number[]; count: number } | null;
  year: { ticketIds: number[]; count: number } | null;
};

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
  denyReason?: string | null;
}

interface Props {
  params: Promise<{ token: string }>;
}

export default function PublicMonitorPage({ params }: Props) {
  const { token } = use(params);
  // Bildschirm wach halten, solange die Seite sichtbar ist.
  useWakeLock(true);
  const [monitorName, setMonitorName] = useState<string>("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [controlDevices, setControlDevices] = useState<ControlDevice[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [tickets, setTickets] = useState<TicketInfo[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<number>>(new Set());
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(true);
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<TicketInfo | null>(null);
  const [allPaused, setAllPaused] = useState(false);
  const [pauseToggling, setPauseToggling] = useState(false);
  // Confirm-Dialog vor Massenpause: zeigt die exakte Trefferzahl,
  // die ein Klick auf "Alle pausieren" tatsaechlich anfassen wuerde
  // (verhindert versehentliche Mass-Pause wie am 2026-05-27).
  const [pauseConfirm, setPauseConfirm] = useState<
    | { count: number; isGlobal: boolean }
    | null
  >(null);
  const [pausePreviewLoading, setPausePreviewLoading] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [focusNow, setFocusNow] = useState(() => Date.now());
  const [scanLeaders, setScanLeaders] = useState<ScanLeaderBoard | null>(null);
  const [mobileTab, setMobileTab] = useState<"tickets" | "scans">("tickets");
  const [devicesOpen, setDevicesOpen] = useState(false);
  const devicesRef = useRef<HTMLDivElement | null>(null);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const [controlFlash, setControlFlash] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanIdRef = useRef(0);
  const pollTickRef = useRef(0);
  const isFirstLoad = useRef(true);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const unlockAudio = useCallback(() => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    } catch { /* audio not available */ }
  }, []);

  const playDenyTone = useCallback(() => {
    if (!soundEnabledRef.current) return;
    try {
      unlockAudio();
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const beep = (start: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(880, start);
        osc.frequency.setValueAtTime(420, start + 0.14);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.28);
      };
      const t = ctx.currentTime;
      beep(t);
      beep(t + 0.32);
    } catch { /* audio not available */ }
  }, [unlockAudio]);

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

  async function handleDismissAnnouncement(id: number) {
    if (dismissingIds.has(id)) return;
    setDismissingIds((prev) => new Set(prev).add(id));
    // Optimistic remove - sieht direkt aus, dass der Banner weg ist; das
    // naechste Poll-Result bestaetigt den Server-State.
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch(`/api/monitor/public/${token}/announcements/${id}/dismiss`, {
        method: "POST",
      });
    } catch { /* ignore */ }
    setDismissingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function handleControlAction(deviceId: number, action: string) {
    const device = controlDevices.find((d) => d.id === deviceId);
    const latching = device != null && isLatchingSwitchDevice(device);
    const key = latching ? `${deviceId}:latch` : `${deviceId}:${action}`;
    if (controlBusy) return;
    setControlBusy(key);
    setControlError(null);
    try {
      const res = await fetch(`/api/monitor/public/${token}/devices/${deviceId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (latching) {
          setControlDevices((prev) =>
            prev.map((d) => (d.id === deviceId ? { ...d, output: action === "open" } : d)),
          );
        }
        setControlFlash(key);
        setTimeout(() => setControlFlash((cur) => (cur === key ? null : cur)), 1800);
      } else {
        setControlError(typeof data.error === "string" ? data.error : "Steuerung fehlgeschlagen");
        setTimeout(() => setControlError(null), 3500);
      }
    } catch {
      setControlError("Netzwerkfehler");
      setTimeout(() => setControlError(null), 3500);
    } finally {
      setControlBusy(null);
    }
  }

  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener("pointerdown", unlock);
    return () => document.removeEventListener("pointerdown", unlock);
  }, [unlockAudio]);

  useEffect(() => {
    const t = setInterval(() => setFocusNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  async function handlePauseAll() {
    if (pauseToggling || pausePreviewLoading || pauseConfirm) return;
    if (allPaused) {
      // Entpausen passiert immer ohne Rueckfrage - die Aktion macht keinen
      // Schaden, im Gegenteil: sie macht eine versehentliche Pause rueckgaengig.
      setPauseToggling(true);
      try {
        const res = await fetch(`/api/monitor/public/${token}/pause-all`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resume" }),
        });
        if (res.ok) setAllPaused(false);
      } catch { /* ignore */ }
      setPauseToggling(false);
      return;
    }

    setPausePreviewLoading(true);
    try {
      const res = await fetch(`/api/monitor/public/${token}/pause-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { count: number; scopeIsGlobal: boolean };
        setPauseConfirm({ count: data.count, isGlobal: !!data.scopeIsGlobal });
      }
    } catch { /* ignore */ }
    setPausePreviewLoading(false);
  }

  async function confirmPauseAll() {
    if (!pauseConfirm || pauseToggling) return;
    setPauseToggling(true);
    try {
      const res = await fetch(`/api/monitor/public/${token}/pause-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      if (res.ok) setAllPaused(true);
    } catch { /* ignore */ }
    setPauseToggling(false);
    setPauseConfirm(null);
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
          controlDevices?: ControlDevice[];
          scans: Scan[];
          tickets: TicketInfo[] | null;
          lastScanId: number;
          announcements: Announcement[] | null;
          scanLeaders?: ScanLeaderBoard | null;
        };
        if (cancelled) return;
        if (!scansOnly) {
          setMonitorName(data.name);
          setDevices(data.devices);
          if (Array.isArray(data.controlDevices)) setControlDevices(data.controlDevices);
        }
        if (data.announcements !== null && data.announcements !== undefined) {
          setAnnouncements(data.announcements);
        }
        if (data.scans?.length) {
          const incoming = data.scans.filter((s) => isSameBerlinDay(s.scanTime));
          let shouldBeep = false;
          setScans((prev) => {
            const todayPrev = prev.filter((s) => isSameBerlinDay(s.scanTime));
            const existing = new Set(todayPrev.map((s) => s.id));
            const fresh = incoming.filter((s) => !existing.has(s.id));
            const skipSound = isFirstLoad.current;
            if (!skipSound && fresh.length > 0) {
              setNewIds(new Set(fresh.map((s) => s.id)));
              setTimeout(() => setNewIds(new Set()), 1500);
              if (fresh.some((s) => s.result === "DENIED" || s.result === "PROTECTED")) {
                shouldBeep = true;
              }
            }
            isFirstLoad.current = false;
            return [...fresh, ...todayPrev].slice(0, 50);
          });
          if (shouldBeep) playDenyTone();
        } else {
          isFirstLoad.current = false;
        }
        if (typeof data.lastScanId === "number") {
          lastScanIdRef.current = data.lastScanId;
        }
        if (data.tickets) {
          applyTickets(data.tickets);
        }
        if (data.scanLeaders) {
          setScanLeaders(data.scanLeaders);
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
    pollTimerRef.current = setInterval(doPoll, PUBLIC_MONITOR_POLL_MS);

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
          pollTimerRef.current = setInterval(doPoll, PUBLIC_MONITOR_POLL_MS);
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

  useEffect(() => {
    let currentDay = berlinYmd(new Date());
    const id = setInterval(() => {
      const nowDay = berlinYmd(new Date());
      if (nowDay !== currentDay) {
        currentDay = nowDay;
        setScans([]);
        setScanLeaders(null);
        lastScanIdRef.current = 0;
        pollTickRef.current = 0;
        isFirstLoad.current = true;
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!devicesOpen) return;
    const handler = (e: MouseEvent) => {
      if (!devicesRef.current?.contains(e.target as Node)) setDevicesOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [devicesOpen]);

  /** Nach Check-in: hasPhoto-Flag aus nächstem Ticket-Poll ins geöffnete Overlay übernehmen.
   *  Das eigentliche Bild wird vom Overlay selbst via /photo-Endpoint nachgeladen. */
  useEffect(() => {
    setSelectedTicket((prev) => {
      if (!prev) return prev;
      const fresh = tickets.find((t) => t.id === prev.id);
      if (!fresh) return prev;
      if (prev.hasPhoto === fresh.hasPhoto) return prev;
      return { ...prev, hasPhoto: fresh.hasPhoto };
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
        t.service?.name ?? "",
        t.subscription?.name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tickets, ticketSearch]);

  const grantedTicketIds = useMemo(() => {
    const ids = new Set<number>();
    const cutoff = focusNow - 15 * 60_000;
    for (const s of scans) {
      if (s.result !== "GRANTED" || s.ticket?.id == null) continue;
      if (new Date(s.scanTime).getTime() >= cutoff) ids.add(s.ticket.id);
    }
    return ids;
  }, [scans, focusNow]);

  const listedTickets = useMemo(() => {
    if (ticketSearch.trim()) return filteredTickets;
    const now = new Date(focusNow);
    return filteredTickets.filter((t) =>
      isMonitorFocusTicket(t, { now, grantedTicketIds }),
    );
  }, [filteredTickets, ticketSearch, focusNow, grantedTicketIds]);

  /** Multi-Area-ANNY-Buchungen (1 Person -> N booking.ids) zu einer Karte
   *  zusammenfassen. Bedingungen alle drei muessen passen:
   *    - Ticket ist ANNY-Quelle (uuid startsWith "anny:")
   *    - serviceAreaCount >= 2
   *    - Gruppen-Mitglieder > 1 UND glatt durch serviceAreaCount teilbar
   *  Sonst bleibt das Ticket eine Einzelgruppe (= altes Verhalten). */
  const groupedTickets = useMemo<TicketGroup[]>(() => {
    type DraftGroup = { members: TicketInfo[]; serviceAreaCount: number };
    const draftByKey = new Map<string, DraftGroup>();
    const passthrough: TicketInfo[] = [];

    for (const t of listedTickets) {
      const customerId = t.uuid?.startsWith("anny:") ? t.uuid.split(":")[1] : null;
      const groupable = customerId && t.serviceId != null && t.serviceAreaCount >= 2 && t.startDate;
      if (!groupable) {
        passthrough.push(t);
        continue;
      }
      const day = t.startDate ? t.startDate.slice(0, 10) : "";
      const key = `${customerId}|svc=${t.serviceId}|day=${day}`;
      const existing = draftByKey.get(key);
      if (existing) {
        existing.members.push(t);
      } else {
        draftByKey.set(key, { members: [t], serviceAreaCount: t.serviceAreaCount });
      }
    }

    const result: TicketGroup[] = passthrough.map((t) => ({
      representative: t,
      members: [t],
      personCount: 1,
      redeemedPersonCount: t.status === "REDEEMED" ? 1 : 0,
    }));

    for (const draft of draftByKey.values()) {
      const isCleanMultiArea =
        draft.members.length > 1 &&
        draft.members.length % draft.serviceAreaCount === 0;
      if (!isCleanMultiArea) {
        // Datenanomalie (z.B. fehlender Strandbad-Sync) - lieber als Einzel-
        // karten zeigen, sonst geht ein Ticket "verloren".
        for (const m of draft.members) {
          result.push({
            representative: m,
            members: [m],
            personCount: 1,
            redeemedPersonCount: m.status === "REDEEMED" ? 1 : 0,
          });
        }
        continue;
      }
      const personCount = draft.members.length / draft.serviceAreaCount;
      // Ein Ticket gilt als "schon mal gescannt", wenn entweder REDEEMED
      // (DEFAULT-Tageskarten ohne Re-Entry) oder firstScanAt != null
      // (Multi-Scan-Tageskarten wie Aquapark mit allowReentry=true, die
      // VALID bleiben). Beides hier zusammenfassen.
      const usedTickets = draft.members.filter(
        (m) => m.status === "REDEEMED" || m.firstScanAt != null,
      ).length;
      // ceil statt floor: sobald 1 Resource-Ticket einer Person eingelost ist,
      // gilt sie als eingecheckt (auch wenn die zweite Area noch offen ist).
      const redeemedPersonCount = Math.min(personCount, Math.ceil(usedTickets / draft.serviceAreaCount));
      // Repraesentant: bevorzugt VALID + noch nicht gescannt (firstScanAt=null),
      // sonst egal welches. Bei Re-Entry-Tickets (Aquapark allowReentry=true)
      // bleibt der Status VALID auch nach Scan, deshalb firstScanAt mitpruefen.
      const rep = draft.members.find((m) => m.status === "VALID" && m.firstScanAt == null)
        ?? draft.members.find((m) => m.status === "VALID")
        ?? draft.members[0];
      result.push({
        representative: rep,
        members: draft.members,
        personCount,
        redeemedPersonCount,
      });
    }

    // Stabile Sortierung: Pausierte ganz unten, sonst nach Name.
    return result.sort((a, b) => {
      const order = (g: TicketGroup) =>
        g.representative.status === "PAUSED" ? 3
        : g.representative.source === "EMP_CONTROL" ? 2
        : g.representative.subscriptionId != null ? 1
        : 0;
      const d = order(a) - order(b);
      if (d !== 0) return d;
      return a.representative.name.localeCompare(b.representative.name);
    });
  }, [listedTickets]);

  /**
   * Ticketliste fuer die Anzeige: wenn mind. eine Gruppe eine feste
   * Slot-Uhrzeit hat, wird nach Slots gruppiert (Abschnittsueberschriften je
   * Uhrzeit, "Ohne feste Uhrzeit" fuer den Rest). Sonst flache Liste wie bisher.
   */
  type TicketListItem =
    | { kind: "header"; key: string; label: string }
    | { kind: "group"; key: string; group: TicketGroup };
  const ticketListItems = useMemo<TicketListItem[]>(() => {
    const groupKey = (g: TicketGroup) =>
      g.personCount > 1 ? `g:${g.members.map((m) => m.id).join(",")}` : `t:${g.representative.id}`;

    const withSlot: { label: string; startMin: number; group: TicketGroup }[] = [];
    const withoutSlot: TicketGroup[] = [];
    for (const g of groupedTickets) {
      const label = monitorSlotLabel(g.representative);
      if (label) withSlot.push({ label, startMin: slotLabelStartMinutes(label), group: g });
      else withoutSlot.push(g);
    }

    if (withSlot.length === 0) {
      return groupedTickets.map((g) => ({ kind: "group" as const, key: groupKey(g), group: g }));
    }

    withSlot.sort((a, b) =>
      a.startMin - b.startMin
      || a.label.localeCompare(b.label)
      || a.group.representative.name.localeCompare(b.group.representative.name),
    );

    const items: TicketListItem[] = [];
    let currentLabel: string | null = null;
    for (const w of withSlot) {
      if (w.label !== currentLabel) {
        items.push({ kind: "header", key: `h:${w.label}`, label: `${w.label} Uhr` });
        currentLabel = w.label;
      }
      items.push({ kind: "group", key: groupKey(w.group), group: w.group });
    }
    if (withoutSlot.length > 0) {
      items.push({ kind: "header", key: "h:none", label: "Ohne feste Uhrzeit" });
      for (const g of withoutSlot) items.push({ kind: "group", key: groupKey(g), group: g });
    }
    return items;
  }, [groupedTickets]);

  const groupedScans = useMemo(() => {
    const groups: ScanGroup[] = [];
    for (const scan of scans) {
      const lastGroup = groups[groups.length - 1];
      const ticketId = scan.ticket?.id ?? null;
      const key = ticketId != null ? `t:${ticketId}` : `c:${scan.code}`;
      const noteData = parseScanDisplayNote(scan.note);
      const denyReason = scan.result !== "GRANTED" ? scanDenyReasonLabel(scan.note) : null;

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
          denyReason,
        });
      }
    }
    return groups;
  }, [scans]);

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Hell/Dunkel des Monitors: `dark` bzw. `light` an der Wurzel stellt alle Tokens
  // darunter auf ihre dunklen bzw. hellen Werte (docs/design-regeln.md, Abschnitt 10),
  // unabhängig vom Schema des Dashboards in diesem Browser; `scheme-*` zeichnet auch
  // Suchfeld und Bildlaufleisten passend. Der Monitor startet dunkel (Abschnitt 20).
  const themeClass = dark ? "dark scheme-dark" : "light scheme-light";
  const toggleTheme = () => setDark((d) => !d);

  if (error) {
    return (
      <div className={cn("min-h-[100dvh] flex items-center justify-center p-4 page-ambient text-foreground", themeClass)}>
        <Notice tone="danger" title={<span className="sm:text-xl">{error}</span>} className="w-full max-w-md sm:max-w-xl sm:p-6" />
      </div>
    );
  }

  return (
    <div className={cn("min-h-[100dvh] lg:h-[100dvh] flex flex-col page-ambient text-foreground transition-colors duration-300 kiosk-surface", themeClass)}>
      {/* Kopfbalken als Glasleiste wie im Dashboard (docs/design-regeln.md, Abschnitt 13): Titel mit
          Live-Zustand links, Tasten rechts. Reicht die Breite nicht (Handy, viele Steuergeräte),
          rutschen die Tasten in eine zweite Zeile. z-30 hält das Geräte-Menü über den Karten.
          Die Safe-Area oben trägt das Layout; der Kopf paddet nur sich selbst. */}
      <header
        className="relative z-30 glass-bar border-b border-border px-4 py-2 sm:px-6 sm:py-3 flex flex-wrap items-center gap-x-3 gap-y-2 transition-colors duration-300"
      >
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-2 sm:gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="EMP Access" className="h-7 w-7 sm:h-9 sm:w-9 shrink-0 dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.png" alt="EMP Access" className="hidden h-7 w-7 sm:h-9 sm:w-9 shrink-0 dark:block" />
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight truncate">{monitorName || "Live Monitor"}</h1>
            <p className="text-[11px] text-muted-foreground hidden sm:block">EMP Access — Echtzeit-Zugangsmonitor</p>
          </div>
          {connected ? (
            <Badge variant="success" className="gap-1.5">
              <StatusDot tone="success" pulse size="xs" />
              Live
            </Badge>
          ) : (
            <Badge variant="neutral" className="gap-1.5">
              <Loader2 className="animate-spin" />
              Verbinde…
            </Badge>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          {controlDevices.flatMap((device) => {
            const showDeviceName = controlDevices.length > 1;

            if (isLatchingSwitchDevice(device)) {
              const isOn = device.output === true;
              const key = `${device.id}:latch`;
              const busy = controlBusy === key;
              const flashed = controlFlash === key;
              // Aus/Ein als Glas-Kapsel wie `Segmented`; „Ein“ trägt die Zustandsfarbe (an = grün).
              // In der Kapsel (4 px Rand) 56 px hoch, auf dem Handy 44 px (docs/design-regeln.md,
              // Abschnitte 20 und 23); ::after verlängert die Trefferfläche bis zum Kapselrand.
              const segment = "press relative min-w-11 sm:min-w-14 h-9 sm:h-12 px-3 sm:px-4 rounded-full text-sm sm:text-base font-semibold disabled:opacity-50 after:absolute after:inset-x-0 after:-inset-y-1";
              const idle = "text-muted-foreground hover:text-foreground";
              return [(
                <div
                  key={key}
                  className="flex items-center gap-1.5 sm:gap-2"
                  title={isOn ? `${device.name}: ein – klicken auf Aus zum Ausschalten` : `${device.name}: aus – klicken auf Ein zum Einschalten`}
                >
                  {showDeviceName && (
                    <span className="text-xs sm:text-sm font-semibold whitespace-nowrap">
                      {device.name}
                    </span>
                  )}
                  <div className="glass-strip inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={controlBusy !== null}
                      onClick={() => { if (isOn) void handleControlAction(device.id, "reset"); }}
                      className={cn(
                        segment,
                        flashed && !isOn
                          ? "bg-success text-success-foreground"
                          : !isOn
                            ? "glass-pill-active text-foreground"
                            : idle,
                      )}
                    >
                      {busy && isOn ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Aus"}
                    </button>
                    <button
                      type="button"
                      disabled={controlBusy !== null}
                      onClick={() => { if (!isOn) void handleControlAction(device.id, "open"); }}
                      className={cn(segment, isOn ? "bg-success text-success-foreground" : idle)}
                    >
                      {busy && !isOn ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Ein"}
                    </button>
                  </div>
                </div>
              )];
            }

            return visibleDeviceControls(device, device.output).map((ctrl) => {
              const key = `${device.id}:${ctrl.action}`;
              const busy = controlBusy === key;
              const flashed = controlFlash === key;
              const Icon = ctrl.role === "danger"
                ? AlertTriangle
                : ctrl.action === "reset" || ctrl.action === "deactivate" || ctrl.action === "close"
                  ? PowerOff
                  : Power;
              return (
                <Button
                  key={key}
                  type="button"
                  disabled={controlBusy !== null}
                  onClick={() => void handleControlAction(device.id, ctrl.action)}
                  title={showDeviceName ? `${device.name}: ${ctrl.label}` : `${device.name} ${ctrl.label}`}
                  variant={
                    flashed
                      ? "default"
                      : ctrl.role === "danger"
                        ? "destructive"
                        : ctrl.action === "reset" || ctrl.action === "deactivate" || ctrl.action === "close"
                          ? "secondary"
                          : "outline"
                  }
                  className={cn(
                    "h-11 gap-2 px-3 text-sm font-semibold sm:h-14 sm:px-4 sm:text-base",
                    // Bestätigung nach erfolgreichem Befehl: kurz grün.
                    flashed && "bg-success text-success-foreground shadow-none hover:bg-success/90",
                  )}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : flashed ? (
                    <Check className="h-4 w-4 shrink-0" />
                  ) : (
                    <Icon className="h-4 w-4 shrink-0" />
                  )}
                  <span>{showDeviceName ? `${device.name} · ${ctrl.label}` : ctrl.label}</span>
                </Button>
              );
            });
          })}
          {devices.length > 0 && (() => {
            const onlineCount = devices.filter((d) => d.lastUpdate && new Date(d.lastUpdate) > fiveMinAgo).length;
            const summaryTone = onlineCount === devices.length
              ? "success"
              : onlineCount === 0
                ? "danger"
                : "warning";
            return (
              <div className="relative" ref={devicesRef}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDevicesOpen((v) => !v)}
                  className="h-11 gap-2 rounded-full px-3 sm:h-14 sm:px-4"
                  aria-haspopup="menu"
                  aria-expanded={devicesOpen}
                >
                  <StatusDot tone={summaryTone} />
                  <span className="text-sm font-semibold tabular-nums">
                    {onlineCount}/{devices.length}
                  </span>
                  <ChevronDown className={cn("size-3 transition-transform", devicesOpen && "rotate-180")} />
                </Button>
                {devicesOpen && (
                  // Menü-Optik (glass-surface), aber deckend: Der Kopfbalken zeichnet selbst weich
                  // und ist damit die Grenze für den Weichzeichner des Menüs – unterhalb des Kopfes
                  // schiene der Inhalt sonst ungeweicht durch. `!`, weil glass-surface den
                  // Hintergrund als Kurzform setzt und sonst gewänne.
                  <div
                    role="menu"
                    className="glass-surface bg-popover! absolute right-0 top-full mt-1.5 min-w-[200px] rounded-tile z-30 p-1.5"
                  >
                    {devices.map((device) => {
                      const online = device.lastUpdate ? new Date(device.lastUpdate) > fiveMinAgo : false;
                      return (
                        <div key={device.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5">
                          <StatusDot tone={online ? "success" : "danger"} />
                          <span className="text-[13px] font-medium truncate">{device.name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              const next = !soundEnabledRef.current;
              soundEnabledRef.current = next;
              setSoundEnabled(next);
              if (next) unlockAudio();
            }}
            className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
            title={soundEnabled ? "Warnton bei ungültigem Scan an" : "Warnton aus"}
          >
            {soundEnabled
              ? <Volume2 className="size-5" />
              : <VolumeX className="size-5 opacity-60" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
            aria-label="Farbschema"
          >
            {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </Button>
        </div>
      </header>

      {/* Hinweis-Banner vom Shop-Monitor. Bleibt sichtbar bis manuell per X
          geschlossen - dann account-weit weg, auf allen Monitoren. */}
      {(controlError || announcements.length > 0) && (
        <div className="px-4 sm:px-6 pt-4 space-y-2">
          {/* Fehlgeschlagener Gerätebefehl: Ursache als Störungs-Hinweis (docs/design-regeln.md,
              Abschnitt 19), nicht als rote Färbung aller Tasten. */}
          {controlError && <Notice tone="danger" compact role="alert" title={controlError} />}
          {announcements.map((a) => (
            // Hinweis-Kachel in der Hinweisfarbe; das X sitzt oben rechts, auch auf dem Handy.
            <div key={a.id} className="relative">
              <Notice
                tone="warning"
                icon={Megaphone}
                className="pr-14 sm:pr-18"
                title={<span className="whitespace-pre-wrap break-words sm:text-base">{a.message}</span>}
              >
                <span className="font-medium tabular-nums">
                  {a.sourceLabel ? `${a.sourceLabel} · ` : ""}
                  {fmtTime(a.createdAt)}
                </span>
              </Notice>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDismissAnnouncement(a.id)}
                disabled={dismissingIds.has(a.id)}
                title="Hinweis schliessen"
                className="absolute right-2 top-2 size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
              >
                {dismissingIds.has(a.id) ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <X className="size-5" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 p-4 sm:p-6 lg:flex lg:min-h-0 lg:flex-col" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        {/* Handy und Tablet: Umschalter zwischen Scans und Tickets; ab lg stehen beide nebeneinander. */}
        <Segmented
          value={mobileTab}
          onValueChange={setMobileTab}
          aria-label="Ansicht"
          stretch
          // 48 px je Taste + 4 px Kapselrand = 56 px; ::after verlängert die Trefferfläche bis zum Rand.
          className="mb-4 lg:hidden [&>button]:relative [&>button]:h-12 [&>button]:text-base [&>button]:after:absolute [&>button]:after:inset-x-0 [&>button]:after:-inset-y-1"
          options={[
            { value: "scans", label: <><ScanLine className="size-5" />Scans</> },
            { value: "tickets", label: <><Ticket className="size-5" />Tickets</> },
          ]}
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-[minmax(0,1fr)] lg:flex-1 lg:min-h-0 gap-4 sm:gap-5 h-full">
          {/* Scan Feed */}
          <div className={cn("flex-col lg:col-span-2 lg:min-h-0", mobileTab === "scans" ? "flex" : "hidden lg:flex")}>
            <SectionHeading title="Letzte Scans" icon={ScanLine} className="mb-3" />
            {scans.length === 0 && (
              <Card>
                <EmptyState icon={ScanLine} title="Warte auf Scans…" />
              </Card>
            )}
            <div className="max-h-[calc(100dvh-12rem)] sm:max-h-[calc(100dvh-13.5rem)] lg:max-h-none lg:min-h-0 overflow-y-auto pr-1 monitor-scrollbar">
              {/* Top 2 hero scans: eigene Karten, ganz in der Ergebnisfarbe (docs/design-regeln.md, Abschnitt 20) */}
              {groupedScans.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3" style={{ minHeight: "calc(50vh - 5rem)" }}>
                  {groupedScans.slice(0, 2).map((group) => {
                    const rc = RESULT_CONFIG[group.result];
                    const Icon = rc.icon;
                    const isNew = group.scans.some((s) => newIds.has(s.id));
                    const scanCount = group.scans.length;
                    const endMs = group.endDate ? endOfDayMs(group.endDate) : null;
                    const aboExpired = group.subscriptionId != null && endMs != null && Date.now() > endMs;
                    const daysLeft = endMs != null ? Math.ceil((endMs - Date.now()) / 86_400_000) : null;
                    const aboExpiring = !aboExpired && group.subscriptionId != null && daysLeft != null && daysLeft >= 0 && daysLeft <= 7;
                    return (
                      <div
                        key={group.scans[0].id}
                        className={cn(
                          "glass-card flex flex-col border-2 overflow-hidden transition-all duration-200",
                          rc.bg,
                          // Markierung neuer Scans innen: Ein Ring außen würde vom Bildlauf-Rahmen abgeschnitten.
                          isNew && "animate-scan-flash inset-ring-4",
                          isNew && rc.ringInset,
                        )}
                      >
                        <div className="flex flex-col items-center justify-center flex-1 px-5 pt-5 pb-3 gap-3">
                          <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-tile flex items-center justify-center shrink-0 overflow-hidden bg-glass-tile ring-1 ring-inset ring-glass-border">
                            {group.profileImage ? (
                              <img src={group.profileImage} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <Icon className={cn("h-12 w-12 sm:h-14 sm:w-14", rc.text)} />
                            )}
                          </div>
                          <div className="text-center min-w-0 w-full">
                            <p className="font-extrabold text-2xl sm:text-3xl leading-tight truncate">
                              {group.personName || group.ticketName}
                            </p>
                            {(() => { const a = calcAge(group.birthDate) ?? group.noteAge; return a != null ? <p className="text-lg font-medium mt-0.5 text-muted-foreground tabular-nums">Alter: {a}</p> : null; })()}
                            {(group.ticketTypeName || (!group.ticketId && group.personName)) && (
                              <p className="text-base sm:text-lg font-semibold mt-1 truncate text-muted-foreground">
                                {group.ticketTypeName || "Wakesys"}
                              </p>
                            )}
                            {(group.subscriptionName || group.endDate) && (
                              <p className="text-sm sm:text-base mt-0.5 truncate text-muted-foreground tabular-nums">
                                {group.subscriptionName}
                                {group.subscriptionId && group.endDate && (
                                  <>{group.subscriptionName ? " · " : ""}bis {new Date(group.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}</>
                                )}
                              </p>
                            )}
                            {/* Pillen auf der getönten Karte: Tönung trägt den Zustand, die Schrift steht
                                in foreground – Zustandsfarbe auf Zustandsfläche bliebe unter 4,5:1. */}
                            {aboExpired && (
                              <Badge variant="danger" className="mt-1.5 px-3 py-1 text-sm font-bold text-foreground">Abo abgelaufen</Badge>
                            )}
                            {aboExpiring && (
                              <Badge variant="warning" className="mt-1.5 px-3 py-1 text-sm font-bold text-foreground">
                                Abo läuft ab {daysLeft === 0 ? "heute" : daysLeft === 1 ? "morgen" : `in ${daysLeft} Tagen`}
                              </Badge>
                            )}
                            {/* Grund in Schriftfarbe: Die Zustandsfarbe trägt die ganze Karte;
                                als Text auf der Tönung bliebe sie im Hellen unter 4,5:1. */}
                            {group.result !== "GRANTED" && (
                              <p className="text-base sm:text-xl font-bold mt-2 leading-snug">
                                {group.denyReason || rc.label}
                              </p>
                            )}
                            {group.result === "GRANTED" && (
                              <ScanLeaderBadges ticketId={group.ticketId} board={scanLeaders} size="lg" />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-1 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            {group.result === "GRANTED" && !group.ticketId && (
                              <Badge variant="warning" className="px-2.5 py-1 font-bold text-foreground">RFID Merge</Badge>
                            )}
                            {group.validityType === "DURATION" && group.validityDurationMinutes && group.firstScanAt && (
                              <DurationCountdown firstScanAt={group.firstScanAt} durationMinutes={group.validityDurationMinutes} size="lg" />
                            )}
                            {scanCount > 1 && (
                              <Badge variant="secondary" className="px-3.5 py-1.5 text-base font-mono font-bold tabular-nums">&times;{scanCount}</Badge>
                            )}
                          </div>
                          <ScanAgeTimer scanTime={group.latestScanTime} size="lg" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Remaining scans: eine Karte mit Zeilen statt einer Karte je Scan (docs/design-regeln.md, Abschnitt 22) */}
              {groupedScans.length > 2 && (
              <Card className="gap-1.5 p-2 sm:p-2.5">
              {groupedScans.slice(2).map((group) => {
                const rc = RESULT_CONFIG[group.result];
                const Icon = rc.icon;
                const isNew = group.scans.some((s) => newIds.has(s.id));
                const scanCount = group.scans.length;
                const endMs = group.endDate ? endOfDayMs(group.endDate) : null;
                const aboExpired = group.subscriptionId != null && endMs != null && Date.now() > endMs;
                const daysLeft = endMs != null ? Math.ceil((endMs - Date.now()) / 86_400_000) : null;
                const aboExpiring = !aboExpired && group.subscriptionId != null && daysLeft != null && daysLeft >= 0 && daysLeft <= 7;

                return (
                  <div
                    key={group.scans[0].id}
                    className={cn(
                      "glass-tile flex flex-wrap items-center justify-between gap-x-3 gap-y-2 overflow-hidden transition-all duration-200",
                      "px-4 py-3",
                      rc.tile,
                      isNew && "animate-scan-flash ring-2 ring-offset-1 ring-offset-background",
                      isNew && rc.ring,
                    )}
                  >
                    <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
                      <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden bg-glass-tile ring-1 ring-inset ring-glass-border">
                        {group.profileImage ? (
                          <img src={group.profileImage} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Icon className={cn("h-6 w-6", rc.text)} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-[15px] leading-tight truncate">
                          {group.personName || group.ticketName}
                          {(() => { const a = calcAge(group.birthDate) ?? group.noteAge; return a != null ? <span className="ml-1 text-xs font-normal text-muted-foreground">({a})</span> : null; })()}
                        </p>
                        <p className={cn("text-sm truncate mt-0.5", group.result !== "GRANTED" && group.denyReason ? "text-foreground" : "text-muted-foreground")}>
                          {(() => {
                            const parts: string[] = [];
                            if (group.result !== "GRANTED" && group.denyReason) parts.push(group.denyReason);
                            if (group.ticketTypeName) parts.push(group.ticketTypeName);
                            if (group.subscriptionName && group.subscriptionName !== group.ticketTypeName) parts.push(group.subscriptionName);
                            if (group.subscriptionId && group.endDate) parts.push(`bis ${new Date(group.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}`);
                            if (parts.length === 0 && !group.ticketId && group.personName) parts.push("Wakesys");
                            return parts.join(" · ");
                          })()}
                        </p>
                      </div>
                    </div>
                    {/* Wie auf den Karten: getönte Pille, Schrift in foreground (Kontrast 4,5:1). */}
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                      {aboExpired && (
                        <Badge variant="danger" className="font-bold text-foreground">Abo abgelaufen</Badge>
                      )}
                      {aboExpiring && (
                        <Badge variant="warning" className="font-bold text-foreground">
                          {daysLeft === 0 ? "Abo läuft heute ab" : daysLeft === 1 ? "Abo läuft morgen ab" : `Abo läuft in ${daysLeft}d ab`}
                        </Badge>
                      )}
                      {group.result === "GRANTED" && !group.ticketId && (
                        <Badge variant="warning" className="font-bold text-foreground">RFID Merge</Badge>
                      )}
                      {group.result === "GRANTED" && (
                        <ScanLeaderBadges ticketId={group.ticketId} board={scanLeaders} />
                      )}
                      {group.validityType === "DURATION" && group.validityDurationMinutes && group.firstScanAt && (
                        <DurationCountdown firstScanAt={group.firstScanAt} durationMinutes={group.validityDurationMinutes} />
                      )}
                      {scanCount > 1 && (
                        <Badge variant="secondary" className="px-2.5 py-1 font-mono font-bold tabular-nums">×{scanCount}</Badge>
                      )}
                      <ScanAgeTimer scanTime={group.latestScanTime} />
                    </div>
                  </div>
                );
              })}
              </Card>
              )}
            </div>
          </div>

          {/* Right Side */}
          <div className={cn("flex-col gap-4 lg:min-h-0", mobileTab === "tickets" ? "flex" : "hidden lg:flex")}>
            <LiveClock allPaused={allPaused} pauseToggling={pauseToggling || pausePreviewLoading} onClick={handlePauseAll} />

            {/* Tickets als eine Karte: Suche, Überschrift mit Zähler, Liste mit Kachel-Zeilen. */}
            <Card className="gap-3 lg:min-h-0">
              <CardContent>
                <label className="sr-only" htmlFor="monitor-ticket-search">Tickets durchsuchen</label>
                <div className="relative">
                  {/* z-10: Das Glasfeld würde das Symbol sonst überdecken. */}
                  <Search className="pointer-events-none absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="monitor-ticket-search"
                    type="search"
                    enterKeyHint="search"
                    value={ticketSearch}
                    onChange={(e) => setTicketSearch(e.target.value)}
                    placeholder="Name, Abo oder Bändchen…"
                    className="h-14 pl-12 md:text-base"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              </CardContent>

              <CardContent>
                <SectionHeading
                  title={ticketSearch.trim() ? "Suche" : "Aktuell"}
                  icon={Ticket}
                  aside={
                    <Badge variant="secondary" className="font-mono tabular-nums">
                      {ticketSearch.trim()
                        ? `${filteredTickets.length}/${tickets.length}`
                        : listedTickets.length}
                    </Badge>
                  }
                />
                {!ticketSearch.trim() && tickets.length > listedTickets.length && (
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {listedTickets.length === 0
                      ? `${tickets.length} gültig – Suche nach Name oder Bändchen`
                      : `Laufende Zeit, heutige Termine, letzte Scans · ${tickets.length} gültig insgesamt`}
                  </p>
                )}
              </CardContent>

            <div className="mx-2 sm:mx-2.5 space-y-1.5 max-h-[calc(100dvh-26rem)] sm:max-h-[calc(100dvh-27.5rem)] lg:max-h-none lg:min-h-0 overflow-y-auto pr-1 monitor-scrollbar">
              {tickets.length === 0 && (
                <EmptyState compact icon={Ticket} title="Keine aktiven Tickets" />
              )}
              {tickets.length > 0 && filteredTickets.length === 0 && (
                <EmptyState compact icon={Search} title={`Keine Treffer für „${ticketSearch.trim()}“`} />
              )}
              {tickets.length > 0 && filteredTickets.length > 0 && listedTickets.length === 0 && !ticketSearch.trim() && (
                <EmptyState
                  compact
                  icon={Clock}
                  title="Gerade niemand mit laufender Zeit oder heutigem Termin."
                  description="Suche oben nach Name oder Bändchen."
                />
              )}
              {ticketListItems.map((item) => {
                if (item.kind === "header") {
                  return (
                    <div
                      key={item.key}
                      className="text-label px-1 pt-2 pb-1 tabular-nums"
                    >
                      {item.label}
                    </div>
                  );
                }
                const group = item.group;
                const ticket = group.representative;
                const isGroup = group.personCount > 1;
                const memberIds = group.members.map((m) => m.id);
                const endStr = ticket.endDate
                  ? new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })
                  : null;
                const isScanning = scanningId != null && memberIds.includes(scanningId);

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

                // Bei Gruppen zaehlt "eingecheckt" sobald mind. 1 Person der
                // Gruppe einen GRANTED Scan oder ein REDEEMED Ticket hat.
                const checkedIn = isGroup
                  ? group.redeemedPersonCount > 0
                    || scans.some((s) => s.ticket?.id != null && memberIds.includes(s.ticket.id) && s.result === "GRANTED")
                  : (ticket.subscriptionId != null
                    ? scans.some((s) => s.ticket?.id === ticket.id && s.result === "GRANTED" && isSameBerlinDay(s.scanTime))
                    : scans.some((s) => s.ticket?.id === ticket.id && s.result === "GRANTED"));
                const isPaused = ticket.status === "PAUSED";
                const allRedeemed = isGroup && group.redeemedPersonCount >= group.personCount;

                // Zustand als Tönung der Kachel (docs/design-regeln.md, Abschnitt 3):
                // Pause und „läuft ab“ = warning, abgelaufen = destructive, eingecheckt = success.
                // Pausiert: Text bleibt lesbar, gedimmt werden nur Bild und IconChip (Abschnitt 17).
                const cardBg = isScanning
                  ? "border-success/60 bg-linear-to-br from-success/28 to-success/[0.08]"
                  : isPaused
                    ? ROW_TINT.warning
                    : isExpired || durationExpired
                      ? ROW_TINT.danger
                      : isWarning || durationWarning
                        ? ROW_TINT.warning
                        : checkedIn
                          ? ROW_TINT.success
                          : "";

                const badgeStyle = isPaused
                  ? "warning"
                  : isExpired || durationExpired
                    ? "danger"
                    : isWarning || durationWarning
                      ? "warning"
                      : checkedIn
                        ? "success"
                        : ticket.status === "VALID"
                          ? "success"
                          : "info";

                const badgeLabel = isPaused
                  ? "Pausiert"
                  : isExpired || durationExpired
                    ? "Abgelaufen"
                    : isWarning || durationWarning
                      ? "Läuft ab"
                      : isGroup
                        ? (allRedeemed
                            ? `${group.personCount}/${group.personCount} ein`
                            : checkedIn
                              ? `${group.redeemedPersonCount}/${group.personCount} ein`
                              : `${group.personCount} Pers.`)
                        : checkedIn
                          ? "Eingecheckt"
                          : ticket.status === "VALID" ? "Gültig" : "Eingelöst";

                const typeLine = monitorTicketTypeLine(ticket);
                const slotLabel = monitorSlotLabel(ticket);
                const slotStr = slotLabel ? `${slotLabel} Uhr` : null;
                // Bei Slot-/Zeitfenster-Tickets ist das Enddatum (= der Slot-Tag)
                // redundant - dort die Uhrzeit zeigen, das "bis"-Datum weglassen.
                const isSlotTicket = ticket.validityType === "TIME_SLOT";
                const subParts = [
                  typeLine,
                  slotStr && slotStr !== typeLine ? slotStr : null,
                  // Bei (abgeleiteter) Slot-Uhrzeit ist das "bis"-Datum redundant
                  // (der Slot liegt am selben Tag) - dann weglassen.
                  (!isSlotTicket && !slotStr && endStr) ? `bis ${endStr}` : null,
                ].filter(Boolean) as string[];

                return (
                  <div
                    key={isGroup ? `g:${memberIds.join(",")}` : `t:${ticket.id}`}
                    onClick={() => handleTicketClick(ticket)}
                    className={cn(
                      "glass-tile press flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none",
                      cardBg,
                      !isScanning && "hover:bg-glass-strong",
                    )}
                  >
                    {ticket.hasPhoto ? (
                      <div className={cn("h-10 w-10 rounded-control shrink-0 overflow-hidden bg-glass-tile ring-1 ring-inset ring-glass-border", isPaused && "opacity-60")}>
                        {/* Bild wird beim Scroll per native lazy-loading über den
                            /photo-Endpoint nachgeladen (statt Base64 im Poll).
                            Der Endpoint antwortet mit JSON, nicht mit Image – deshalb
                            lazy via einen TicketAvatar-Helper darunter. */}
                        <TicketAvatarLazy token={token} ticketId={ticket.id} className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <IconChip icon={Users} size="lg" className={cn(isPaused && "opacity-60")} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">
                        {[ticket.firstName, ticket.lastName].filter(Boolean).join(" ") || ticket.name}
                        {(() => { const a = calcAge(ticket.birthDate); return a != null ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">({a})</span> : null; })()}
                      </p>
                      <p className="text-xs font-medium truncate text-muted-foreground tabular-nums">
                        {subParts.length > 0
                          ? subParts.join(" · ")
                          : <span className="text-muted-foreground">Ticket</span>}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      {/* Die Zeile trägt den Zustand schon als Tönung; die Pille bleibt getönt,
                          die Schrift steht in foreground (Kontrast 4,5:1). */}
                      <Badge variant={badgeStyle} className="text-[11px] font-bold text-foreground">
                        {badgeLabel}
                      </Badge>
                      {ticket.validityType === "DURATION" && ticket.validityDurationMinutes && ticket.firstScanAt && (
                        isPaused ? (
                          // Pause als Lucide-Symbol statt Emoji (docs/design-regeln.md, Abschnitt 4).
                          <Badge variant="warning" className="px-2.5 py-1">
                            <Pause aria-hidden />
                          </Badge>
                        ) : (
                          <DurationCountdown
                            firstScanAt={ticket.firstScanAt}
                            durationMinutes={ticket.validityDurationMinutes}
                          />
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Bestaetigungsdialog vor Massenpause - zeigt die exakte
          Trefferzahl, die der Klick anfasst. Wird vom Public-Monitor
          ausgeloest, wenn der Nutzer auf die Uhr ("Alle pausieren") klickt. */}
      {pauseConfirm && (
        // Massen-Pause sperrt alle Tickets des Bereichs: AlertDialog mit destructive-Taste
        // (docs/design-regeln.md, Abschnitt 18), schließt nicht beim Tippen daneben. Er rendert
        // in <body>, also außerhalb der Monitor-Wurzel – deshalb trägt der Inhalt das Farbschema selbst.
        <AlertDialog open onOpenChange={(open) => { if (!open && !pauseToggling) setPauseConfirm(null); }}>
          <AlertDialogContent className={themeClass}>
            <AlertDialogHeader className="sm:grid-cols-[auto_1fr]">
              <AlertDialogMedia className="text-warning">
                <Pause strokeWidth={2.2} />
              </AlertDialogMedia>
              <AlertDialogTitle>
                {pauseConfirm.isGlobal ? "Massen-Pause nicht möglich" : "Alle Tickets pausieren?"}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Monitor „{monitorName}“
              </AlertDialogDescription>
            </AlertDialogHeader>

            {pauseConfirm.isGlobal ? (
              <Notice
                tone="danger"
                title={
                  <>
                    Dieser Monitor ist keinem Bereich zugeordnet. Eine Massen-Pause
                    würde account-weit ALLE Tickets pausieren und ist deshalb aus
                    Sicherheitsgründen deaktiviert. Bitte einen bereichsspezifischen
                    Monitor (z.&nbsp;B. Seilbahn A) zum Pausieren verwenden.
                  </>
                }
              />
            ) : (
              <div className="glass-tile px-4 py-4">
                <p className="text-sm font-medium">
                  Es werden{" "}
                  <span className="font-mono font-extrabold tabular-nums text-base text-warning">
                    {pauseConfirm.count}
                  </span>{" "}
                  Tickets pausiert.
                </p>
              </div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={pauseToggling} className="h-14 px-6 text-base">
                {pauseConfirm.isGlobal ? "Verstanden" : "Abbrechen"}
              </AlertDialogCancel>
              {!pauseConfirm.isGlobal && (
                <AlertDialogAction
                  variant="destructive"
                  className="h-14 px-6 text-base"
                  // Offen lassen, bis die Pause durch ist; confirmPauseAll schließt danach selbst.
                  onClick={(e) => { e.preventDefault(); void confirmPauseAll(); }}
                  disabled={pauseToggling || pauseConfirm.count === 0}
                >
                  {pauseToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                  {pauseConfirm.count === 0 ? "Keine Tickets" : `${pauseConfirm.count} pausieren`}
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Mobile Ticket Detail Overlay */}
      {selectedTicket && (
        <TicketDetailOverlay
          ticket={selectedTicket}
          scans={scans}
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

// Die Zeitspanne steht als Text in der Pille; Farbe trägt hier keine Bedeutung
// (docs/design-regeln.md, Abschnitt 3: keine Farbe als Dekoration).
const SCAN_LEADER_PERIODS = [
  { key: "day" as const, label: "Tag", title: "Meiste Scans heute" },
  { key: "week" as const, label: "Woche", title: "Meiste Scans diese Woche" },
  { key: "month" as const, label: "Monat", title: "Meiste Scans diesen Monat" },
  { key: "year" as const, label: "Jahr", title: "Meiste Scans in diesem Jahr" },
];

function ScanLeaderBadges({
  ticketId,
  board,
  size,
}: {
  ticketId: number | null;
  board: ScanLeaderBoard | null;
  size?: "lg";
}) {
  if (!ticketId || !board) return null;
  const items = SCAN_LEADER_PERIODS.flatMap((period) => {
    const row = board[period.key];
    if (!row?.ticketIds.includes(ticketId)) return [];
    return [{ ...period, count: row.count }];
  });
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", size === "lg" && "justify-center mt-1.5")}>
      {items.map((period) => (
        // Glas-Pille; der Pokal trägt den Akzent.
        <Badge
          key={period.key}
          variant="secondary"
          title={`${period.title} (${period.count})`}
          className={cn(
            "font-bold",
            size === "lg" ? "text-xs px-2 py-1 [&>svg]:size-3.5" : "text-[10px] px-1.5 py-0.5 [&>svg]:size-2.5",
          )}
        >
          <Trophy className="text-primary" aria-hidden />
          {period.label}
          {size === "lg" ? <span className="tabular-nums opacity-80">{period.count}</span> : null}
        </Badge>
      ))}
    </div>
  );
}

function formatExpiredSince(expiredForMs: number): string {
  const secs = Math.max(0, Math.floor(expiredForMs / 1000));
  if (secs < 60) return `abgelaufen seit ${secs} Sek.`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `abgelaufen seit ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const m = mins % 60;
    return m > 0 ? `abgelaufen seit ${hours} Std. ${m} Min.` : `abgelaufen seit ${hours} Std.`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "abgelaufen seit 1 Tag" : `abgelaufen seit ${days} Tagen`;
}

function DurationCountdown({ firstScanAt, durationMinutes, size }: { firstScanAt: string; durationMinutes: number; size?: "lg" }) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const expiresAt = new Date(firstScanAt).getTime() + durationMinutes * 60_000;
    const tick = () => {
      const diff = expiresAt - Date.now();
      if (diff <= 0) {
        setRemaining(formatExpiredSince(-diff));
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

  // Restzeit als Pille: läuft = info, abgelaufen = danger. Sie steht meist auf getönten
  // Karten und Zeilen – die Tönung trägt den Zustand, die Schrift bleibt foreground (4,5:1).
  return (
    <Badge
      variant={expired ? "danger" : "info"}
      className={cn(
        "tabular-nums font-bold text-foreground",
        expired ? "font-sans" : "font-mono",
        isLg ? "text-xl sm:text-2xl px-4 py-2 gap-1.5 whitespace-normal [&>svg]:size-5 sm:[&>svg]:size-6" : "text-xs px-2.5 py-1",
      )}
    >
      {isLg && <Clock aria-hidden />}
      {remaining}
    </Badge>
  );
}

/**
 * Zeigt an, wie lange ein Scan zurückliegt. Frische Scans (< 5 Min) laufen
 * sekündlich live mit ("vor 12 Sek.") und stehen fett in Schriftfarbe,
 * damit der letzte Scan sofort erkennbar ist. Ältere Scans fallen auf die
 * absolute Uhrzeit zurück, damit der genaue Zeitpunkt nachvollziehbar bleibt.
 */
function ScanAgeTimer({ scanTime, size }: { scanTime: string; size?: "lg" }) {
  const [, force] = useState(0);
  const startMs = new Date(scanTime).getTime();
  const ageMs = Date.now() - startMs;
  const isFresh = ageMs < 5 * 60_000;

  useEffect(() => {
    if (!isFresh) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isFresh]);

  const isLg = size === "lg";

  if (!isFresh) {
    return (
      <span className={cn(isLg ? "text-lg" : "text-sm", "tabular-nums font-mono font-semibold text-muted-foreground")}>
        {fmtTime(scanTime)}
      </span>
    );
  }

  const secs = Math.max(0, Math.floor(ageMs / 1000));
  const label = secs < 60
    ? `vor ${secs} Sek.`
    : `vor ${Math.floor(secs / 60)} Min. ${secs % 60} Sek.`;

  // Frisch: die mitlaufende Zeit fett in Schriftfarbe – lesbar auf getönten Ergebnis-Karten
  // (Kontrast 4,5:1). Kein grüner Pulspunkt: Grün hieße auf einer roten Karte etwas anderes,
  // und gepulst wird nur der Live-Punkt (docs/design-regeln.md, Abschnitte 3 und 9).
  return (
    <span className={cn(isLg ? "text-lg" : "text-sm", "tabular-nums font-mono font-bold text-foreground")}>
      {label}
    </span>
  );
}

/**
 * Lazy-Avatar: Lädt das Profilbild erst beim Scroll in den Viewport via
 * IntersectionObserver. Cached pro Ticket-ID, damit erneutes Ein/Aus-blenden
 * keinen weiteren Request auslöst.
 */
const lazyAvatarCache = new Map<number, string | null>();

function TicketAvatarLazy({
  token,
  ticketId,
  className,
}: {
  token: string;
  ticketId: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(() => lazyAvatarCache.get(ticketId) ?? null);
  const loadedRef = useRef(lazyAvatarCache.has(ticketId));

  useEffect(() => {
    if (loadedRef.current) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !loadedRef.current) {
          loadedRef.current = true;
          io.disconnect();
          fetch(
            `/api/monitor/public/${encodeURIComponent(token)}/photo?ticketId=${ticketId}`,
            { cache: "no-store" }
          )
            .then((r) => r.json())
            .then((d) => {
              const img = (d?.profileImage as string | null) ?? null;
              lazyAvatarCache.set(ticketId, img);
              setSrc(img);
            })
            .catch(() => {});
        }
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [token, ticketId]);

  return (
    <div ref={ref} className="h-full w-full">
      {src ? <img src={src} alt="" className={className} /> : null}
    </div>
  );
}

function TicketDetailOverlay({
  ticket,
  scans,
  scanningId,
  onScan,
  onClose,
  token,
  onPaused,
}: {
  ticket: TicketInfo;
  scans: Scan[];
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
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    setCurrentImage(null);
    setImageLoading(true);
    fetch(`/api/monitor/public/${encodeURIComponent(token)}/photo?ticketId=${ticket.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCurrentImage(d.profileImage ?? null))
      .catch(() => {})
      .finally(() => setImageLoading(false));
  }, [token, ticket.id]);

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
  const headerSlotLabel = monitorSlotLabel(ticket);
  const headerSlotStr = headerSlotLabel ? `${headerSlotLabel} Uhr` : null;
  const headerSubParts = [
    typeLine,
    headerSlotStr && headerSlotStr !== typeLine ? headerSlotStr : null,
    (ticket.validityType !== "TIME_SLOT" && !headerSlotStr && endStr) ? `bis ${endStr}` : null,
  ].filter(Boolean) as string[];
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
    // Vollbild über dem Monitor (Handy und Tablet); das Farbschema erbt es von der Monitor-Wurzel.
    <div className="fixed inset-0 z-50 flex flex-col page-ambient text-foreground">
      <header
        className="glass-bar border-b border-border px-4 py-3 flex items-center gap-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zurück" className="-ml-2 size-14 rounded-full">
          <ChevronLeft className="size-6" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold truncate">{name}</h2>
          <p className="text-xs text-muted-foreground">
            {headerSubParts.length > 0 ? headerSubParts.join(" · ") : "Ticket"}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 monitor-scrollbar">
        {/* Ticket Info */}
        <Card className="flex-row items-center gap-4 px-4">
          {currentImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentImage} alt="" className="h-16 w-16 rounded-tile object-cover shrink-0 ring-1 ring-glass-border" />
          ) : (
            <div className="h-16 w-16 rounded-tile flex items-center justify-center shrink-0 bg-glass-tile ring-1 ring-inset ring-glass-border">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">
              {name}
              {(() => { const a = calcAge(ticket.birthDate); return a != null ? <span className="ml-1.5 text-sm font-normal text-muted-foreground tabular-nums">({a} J.)</span> : null; })()}
            </p>
            <p className="text-sm text-muted-foreground">
              {typeLine ?? "Ticket"}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge
                variant={ticket.status === "PAUSED" ? "warning" : ticket.status === "VALID" ? "success" : "info"}
                className="font-bold"
              >
                {ticket.status === "PAUSED" ? "Pausiert" : ticket.status === "VALID" ? "Gültig" : "Eingelöst"}
              </Badge>
              {startStr && endStr && (
                <span className="text-xs text-muted-foreground tabular-nums">{startStr} – {endStr}</span>
              )}
            </div>
          </div>
        </Card>

        {/* Checkin Button: Primärtaste; nach dem Einchecken kurz in der Ergebnisfarbe. */}
        <Button
          onClick={onScan}
          disabled={isScanning}
          className={cn(
            "h-15 w-full text-lg font-bold",
            isScanning && "bg-success text-success-foreground shadow-none hover:bg-success disabled:opacity-100",
          )}
        >
          <LogIn className="size-5" />
          {isScanning ? "Eingecheckt!" : "Einchecken"}
        </Button>

        {/* Pause Button: Pause ist ein Hinweis-Zustand (warning). */}
        {!pauseOpen ? (
          <Button
            variant="outline"
            onClick={() => setPauseOpen(true)}
            className="h-14 w-full font-semibold border-warning/40 text-warning hover:bg-warning/10"
          >
            <Pause className="h-4 w-4" />
            Pausieren
          </Button>
        ) : (
          <Card className="gap-3 px-4">
            <div className="flex items-center gap-2">
              <Pause className="h-4 w-4 text-warning" />
              <p className="text-sm font-bold">Ticket pausieren</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {durationOptions.map((opt) => (
                <Button
                  key={opt.value}
                  variant="outline"
                  aria-pressed={pauseDuration === opt.value}
                  onClick={() => setPauseDuration(pauseDuration === opt.value ? null : opt.value)}
                  className={cn(
                    "h-14 font-semibold",
                    pauseDuration === opt.value && "border-primary/60 bg-primary/15 ring-1 ring-inset ring-primary/40 hover:bg-primary/20",
                  )}
                >
                  {opt.label}
                </Button>
              ))}
            </div>

            <Input
              type="text"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              placeholder="Begründung (optional)"
              className="h-14"
            />

            {/* Wie ein Dialog-Fuß (Abschnitt 16): Pausieren rechts, auf dem Handy oben in voller
                Breite; destructive wie bei der Massen-Pause, weil das Ticket gesperrt wird. */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => { setPauseOpen(false); setPauseDuration(null); setPauseReason(""); }}
                className="h-14 px-6 font-semibold"
              >
                Abbrechen
              </Button>
              <Button
                variant="destructive"
                onClick={handlePause}
                disabled={!pauseDuration || pauseLoading}
                className="h-14 px-6 font-bold"
              >
                {pauseLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                Pausieren
              </Button>
            </div>
          </Card>
        )}

        {/* Photo Button */}
        <Button
          variant="secondary"
          onClick={() => setCameraOpen(true)}
          disabled={photoSaving}
          className="h-14 w-full font-semibold"
        >
          {photoSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          Foto {currentImage ? "ändern" : "aufnehmen"}
        </Button>

        {/* Scan History */}
        <div>
          <SectionHeading
            title="Scan-Verlauf"
            icon={ScanLine}
            aside={<Badge variant="secondary" className="font-mono tabular-nums">{ticketScans.length}</Badge>}
            className="mb-3"
          />
          {ticketScans.length === 0 ? (
            <Card>
              <EmptyState compact icon={ScanLine} title="Noch keine Scans" />
            </Card>
          ) : (
            <Card className="gap-1.5 p-2 sm:p-2">
              {ticketScans.map((scan) => {
                // Gleiche Farbe, gleiches Symbol wie im Feed: geschützt = warning, nicht rot (Abschnitt 3).
                const rc = RESULT_CONFIG[scan.result];
                const Icon = rc.icon;
                return (
                  <div
                    key={scan.id}
                    className={cn(
                      "glass-tile flex items-center justify-between gap-3 px-3 py-2.5",
                      rc.tile,
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className={cn("h-5 w-5 shrink-0", rc.text)} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {scan.result === "GRANTED" ? rc.label : (scanDenyReasonLabel(scan.note) || rc.label)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {scan.device?.name ?? "Monitor"}
                        </p>
                      </div>
                    </div>
                    <ScanAgeTimer scanTime={scan.scanTime} />
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={handleCapture}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

function CameraCapture({ onCapture, onClose }: { onCapture: (dataUrl: string) => void; onClose: () => void }) {
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
    // Kamera: schwarzer Grund hinter dem Videobild ist erlaubt (docs/design-regeln.md, Abschnitt 15).
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black">
      <canvas ref={canvasRef} className="hidden" />
      {!preview ? (
        <>
          <div className="relative w-full max-w-[320px] aspect-square rounded-card overflow-hidden bg-black">
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
            className="mt-4 h-14 px-6 rounded-control text-white/70 text-base font-semibold hover:text-white transition-colors"
          >
            Abbrechen
          </button>
        </>
      ) : (
        <>
          <div className="relative w-full max-w-[320px] aspect-square rounded-card overflow-hidden">
            <img src={preview} alt="Preview" className="w-full h-full object-cover" />
          </div>
          <div className="flex gap-4 mt-6">
            <button
              onClick={retake}
              className={cn(
                "press h-14 px-6 rounded-control font-semibold text-base",
                "bg-white/10 text-white hover:bg-white/20",
              )}
            >
              Nochmal
            </button>
            <Button
              onClick={() => onCapture(preview)}
              className="h-14 px-6 text-base font-bold"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Verwenden
              </span>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function LiveClock({ allPaused, pauseToggling, onClick }: { allPaused: boolean; pauseToggling: boolean; onClick: () => void }) {
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
    // Uhr als Glaskarte; „alles pausiert“ ist ein Hinweis-Zustand (warning, docs/design-regeln.md, Abschnitt 3).
    // Die Tönung und das Symbol tragen die Farbe, die Schrift bleibt in foreground (Kontrast im Hellen).
    <button
      onClick={onClick}
      disabled={pauseToggling}
      className={cn(
        "glass-card press w-full px-5 py-4 text-center cursor-pointer",
        allPaused
          ? "border-warning/50 bg-linear-to-br from-warning/25 to-warning/[0.06]"
          : "hover:bg-glass-strong",
        pauseToggling && "opacity-60",
      )}
    >
      {allPaused && (
        <div className="flex items-center justify-center gap-2 mb-1">
          <Pause className="h-4 w-4 text-warning" />
          <span className="text-xs font-bold uppercase tracking-widest">Pausiert</span>
        </div>
      )}
      <p className="text-5xl font-mono font-black tracking-tight tabular-nums">{time}</p>
      <p className={cn(
        "text-sm mt-1 font-bold",
        allPaused ? "text-foreground" : "text-muted-foreground",
      )}>{date}</p>
    </button>
  );
}
