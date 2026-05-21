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
  Pencil,
  Printer,
  TicketX,
  RefreshCw,
  Plus,
  DoorOpen,
  Check,
  ChevronDown,
  Megaphone,
  Send,
} from "lucide-react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { cn } from "@/lib/utils";
import { LockerOverlay } from "@/components/checkin/locker-overlay";
import { Lock } from "lucide-react";
import { printPdfBlob, type PrintResult } from "@/lib/print-tickets";

interface TicketExtra {
  name: string;
  quantity: number;
}

interface CheckinTicket {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
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
  vereinId: number | null;
  checkedIn: boolean;
  accessArea?: { id: number; name: string } | null;
  subscription?: { id: number; name: string; requiresPhoto?: boolean; requiresRfid?: boolean } | null;
  service?: { id: number; name: string; requiresPhoto?: boolean; requiresRfid?: boolean; allowManualCheckin?: boolean } | null;
  verein?: { id: number; name: string } | null;
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

interface DefaultValidity {
  defaultValidityType?: string | null;
  defaultStartDate?: string | null;
  defaultEndDate?: string | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
  defaultValidityDurationMinutes?: number | null;
}

interface ServiceData extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
  /** Service hat mindestens eine ANNY-Resource-Verknuepfung -> Slot-Buchung. */
  hasAnnyLink?: boolean;
}

interface SubOption extends DefaultValidity {
  id: number;
  name: string;
  areaIds?: number[];
}

interface AnnySyncStatus {
  lastSync: string | null;
  created?: number;
  updated?: number;
  errors?: number;
  errorDetails?: string[];
}

interface OpenableDevice {
  id: number;
  name: string;
  category: "TUER" | "DREHKREUZ";
  lastUpdate: string | null;
}

interface CheckinData {
  monitorName: string;
  accountName: string;
  date: string;
  tickets: CheckinTicket[];
  subscriptions: SubData[];
  services: ServiceData[];
  areas: { id: number; name: string }[];
  allSubscriptions?: SubOption[];
  recentScans: ScanEntry[];
  annySyncStatus?: AnnySyncStatus | null;
  openableDevices?: OpenableDevice[];
  quickDeviceIds?: number[];
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function personName(t: { firstName: string | null; lastName: string | null; name: string }): string {
  return [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
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

/**
 * Liefert eine kompakte Uhrzeit-Beschriftung fuer die Ticket-Card im
 * Shop Monitor. Reihenfolge:
 *   1. slotStart/slotEnd (TIME_SLOT-Tickets, z. B. "10:00–12:00").
 *   2. startDate/endDate, wenn beide am gleichen Tag liegen und nicht
 *      einen "ganzen Tag" abdecken (00:00–23:59). Das deckt die aus Anny
 *      synchronisierten Bahnmieten/Kursplaetze ab, die ihre Uhrzeit als
 *      Timestamp tragen.
 *   3. Sonst leer (Mehrtages-Tickets ohne Slot-Zeit).
 */
function formatTicketTimeLabel(ticket: {
  slotStart: string | null;
  slotEnd: string | null;
  startDate: string | null;
  endDate: string | null;
}): string {
  if (ticket.slotStart && ticket.slotEnd) {
    return `${ticket.slotStart}–${ticket.slotEnd}`;
  }
  if (ticket.startDate && ticket.endDate) {
    const s = new Date(ticket.startDate);
    const e = new Date(ticket.endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return "";
    const sameDay =
      s.getFullYear() === e.getFullYear()
      && s.getMonth() === e.getMonth()
      && s.getDate() === e.getDate();
    if (!sameDay) return "";
    const isFullDay =
      s.getHours() === 0 && s.getMinutes() === 0
      && (
        (e.getHours() === 23 && e.getMinutes() === 59)
        || (e.getHours() === 0 && e.getMinutes() === 0)
      );
    if (isFullDay) return "";
    const fmt = (d: Date) =>
      d.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      });
    return `${fmt(s)}–${fmt(e)}`;
  }
  return "";
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
  const [editMode, setEditMode] = useState<"photo" | "rfid" | "dates" | "person" | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cancellingVoucher, setCancellingVoucher] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanBufferRef = useRef("");
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownScanIdsRef = useRef<Set<number>>(new Set());
  const [scanHighlights, setScanHighlights] = useState<Map<number, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  // Welche Vereins-/Abo-/Service-Gruppen sind aktuell aufgeklappt? Standard:
  // alle eingeklappt (siehe Rendering) - im Shop-Workflow waechst die Liste
  // sonst sehr schnell auf hunderte Eintraege an. Bei aktiver Suche wird die
  // Logik ueberbrueckt, damit Treffer immer sichtbar sind.
  const [expandedVereine, setExpandedVereine] = useState<Set<number>>(new Set());
  const [expandedAbos, setExpandedAbos] = useState<Set<number>>(new Set());
  const [expandedServiceGroups, setExpandedServiceGroups] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [addTicketOpen, setAddTicketOpen] = useState(false);
  const [lockerOverlayOpen, setLockerOverlayOpen] = useState(false);
  const [addTicketPrefill, setAddTicketPrefill] = useState<{
    firstName?: string;
    lastName?: string;
    rfidCode?: string;
    profileImage?: string | null;
    voucher?: {
      code: string;
      ticketTypeName: string | null;
      serviceId: number | null;
      serviceName: string | null;
      accessAreaId: number | null;
      accessAreaName: string | null;
      validityType: string | null;
      validityDurationMinutes: number | null;
    };
  } | undefined>();
  const [syncErrorsOpen, setSyncErrorsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [openingDeviceId, setOpeningDeviceId] = useState<number | null>(null);
  const [openedDeviceIds, setOpenedDeviceIds] = useState<Set<number>>(new Set());
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  // Hinweis-an-Seilbahn-Monitor: einfacher Dialog mit freier Textarea. Wird
  // beim Senden ueber /api/checkin/public/[token]/announcements an alle
  // Public-Monitore desselben Accounts geschickt.
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [announcementText, setAnnouncementText] = useState("");
  const [announcementSending, setAnnouncementSending] = useState(false);
  const [announcementError, setAnnouncementError] = useState<string | null>(null);
  const [announcementSentAt, setAnnouncementSentAt] = useState<number | null>(null);

  const handleSendAnnouncement = useCallback(async () => {
    const message = announcementText.trim();
    if (!message || announcementSending) return;
    setAnnouncementSending(true);
    setAnnouncementError(null);
    try {
      const res = await fetch(`/api/checkin/public/${token}/announcements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAnnouncementError(typeof data?.error === "string" ? data.error : "Senden fehlgeschlagen");
      } else {
        setAnnouncementText("");
        setAnnouncementSentAt(Date.now());
        setAnnouncementOpen(false);
        setTimeout(() => setAnnouncementSentAt(null), 2500);
      }
    } catch {
      setAnnouncementError("Netzwerkfehler");
    } finally {
      setAnnouncementSending(false);
    }
  }, [token, announcementText, announcementSending]);

  const handleQuickOpen = useCallback(async (deviceId: number) => {
    setOpeningDeviceId(deviceId);
    try {
      const res = await fetch(`/api/checkin/public/${token}/devices/${deviceId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open" }),
      });
      if (res.ok) {
        setOpenedDeviceIds((prev) => new Set(prev).add(deviceId));
        setTimeout(() => {
          setOpenedDeviceIds((prev) => {
            const next = new Set(prev);
            next.delete(deviceId);
            return next;
          });
        }, 2000);
      }
    } finally {
      setOpeningDeviceId(null);
    }
  }, [token]);

  // Schliesst das "Reinlassen"-Dropdown bei Klick ausserhalb / Escape.
  useEffect(() => {
    if (!openMenuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (openMenuRef.current && !openMenuRef.current.contains(e.target as Node)) {
        setOpenMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    const seenIds = new Set<number>();

    setData(null);
    setLoading(true);
    setError("");

    const doFetch = async () => {
      try {
        const res = await fetch(`/api/checkin/public/${token}?date=${date}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) { setError("Check-in Monitor nicht gefunden"); return; }
        const json: CheckinData = await res.json();
        if (cancelled) return;

        const newScans = json.recentScans.filter((s) => !seenIds.has(s.id));
        if (seenIds.size > 0 && newScans.length > 0) {
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
              if (cancelled) return;
              setScanHighlights((prev) => {
                const next = new Map(prev);
                for (const k of highlights.keys()) next.delete(k);
                return next;
              });
            }, 4000);
          }
        }
        for (const s of json.recentScans) seenIds.add(s.id);

        setData(json);
        setError("");
      } catch {
        if (!cancelled) setError("Verbindungsfehler");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    refreshRef.current = () => doFetch();

    doFetch();
    let interval: ReturnType<typeof setInterval> | null = setInterval(doFetch, 8000);

    const handleVisibility = () => {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else if (!interval) {
        doFetch();
        interval = setInterval(doFetch, 8000);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [token, date]);

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
        refreshRef.current?.();
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket((prev) => prev
            ? {
                ...prev,
                checkedIn: true,
                ...(prev.subscriptionId ? {} : { status: "REDEEMED" as const }),
              }
            : null);
        }
      } else if (json.message) {
        alert(json.message);
      }
    } finally {
      setCheckingIn(null);
    }
  }, [token, selectedTicket]);

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
      if (typeof window !== "undefined") {
        console.log("[shop-monitor] scan response", json);
      }
      if (json.found && json.ticket) {
        setScanResult(json);
        setSelectedTicket(json.ticket);
        setScanMode(false);
      } else if (json.voucher) {
        // Gutschein erkannt: Ticket-Maske oeffnen, vorausgefuellt mit
        // Voucher-Daten. Eingeloest wird der Voucher dann beim Submit
        // im /ticket-Endpoint. Reihenfolge wichtig: erst Selected-Ticket
        // schliessen, dann Prefill setzen, dann Modal oeffnen.
        setSelectedTicket(null);
        setScanResult(null);
        setScanMode(false);
        setAddTicketPrefill({
          voucher: json.voucher,
        });
        setAddTicketOpen(true);
      } else {
        setScanResult(json);
      }
    } catch (err) {
      console.error("[shop-monitor] scan failed", err);
      setScanResult({ found: false, message: "Netzwerkfehler beim Scannen" });
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

  const handleUpdateTicket = useCallback(async (
    ticketId: number,
    update: {
      profileImage?: string;
      rfidCode?: string;
      startDate?: string | null;
      endDate?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      birthDate?: string | null;
    },
    force?: boolean,
  ) => {
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
      refreshRef.current?.();
      if (selectedTicket?.id === ticketId) {
        const patch: Record<string, unknown> = {};
        if (update.profileImage !== undefined) patch.profileImage = update.profileImage;
        if (update.rfidCode !== undefined) patch.rfidCode = update.rfidCode;
        if (update.startDate !== undefined) patch.startDate = json.ticket?.startDate ?? update.startDate;
        if (update.endDate !== undefined) patch.endDate = json.ticket?.endDate ?? update.endDate;
        if (update.firstName !== undefined) patch.firstName = json.ticket?.firstName ?? update.firstName;
        if (update.lastName !== undefined) patch.lastName = json.ticket?.lastName ?? update.lastName;
        if (update.birthDate !== undefined) patch.birthDate = json.ticket?.birthDate ?? update.birthDate;
        if (json.ticket?.name) patch.name = json.ticket.name;
        setSelectedTicket((prev) => prev ? { ...prev, ...patch } : null);
      }
    } finally {
      setUpdatingTicket(null);
      setEditMode(null);
    }
  }, [token, selectedTicket]);

  const handleCameraCapture = useCallback((dataUrl: string) => {
    if (!selectedTicket) return;
    setCameraOpen(false);
    setEditMode("photo");
    handleUpdateTicket(selectedTicket.id, { profileImage: dataUrl });
  }, [selectedTicket, handleUpdateTicket]);

  const handleCancelVoucher = useCallback(async () => {
    if (!selectedTicket) return;
    setCancellingVoucher(true);
    try {
      const res = await fetch(`/api/checkin/public/${token}/voucher`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: selectedTicket.id }),
      });
      const json = await res.json();
      if (json.success) {
        await printVoucher(json.voucher.code, json.voucher.ticketTypeName, data?.accountName ?? "");
        setSelectedTicket(null);
        refreshRef.current?.();
      }
    } finally {
      setCancellingVoucher(false);
    }
  }, [selectedTicket, token, data?.accountName]);

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

  const checkedInAbos = useMemo(() => {
    const all: CheckinTicket[] = [];
    for (const sub of subscriptions) {
      for (const t of sub.tickets) {
        // Abo: nur API-Flag checkedIn (= heute eingescannt), nicht dauerhaft REDEEMED
        if (t.checkedIn) {
          all.push({ ...t, subscription: { id: sub.id, name: sub.name, requiresPhoto: sub.requiresPhoto, requiresRfid: sub.requiresRfid } });
        }
      }
    }
    return all;
  }, [subscriptions]);

  const allCheckedIn = useMemo(() => [...checkedInTickets, ...checkedInAbos], [checkedInTickets, checkedInAbos]);

  const matchesSearch = useCallback((t: CheckinTicket) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (t.firstName?.toLowerCase().includes(q)) ||
      (t.lastName?.toLowerCase().includes(q)) ||
      t.name.toLowerCase().includes(q) ||
      (t.ticketTypeName?.toLowerCase().includes(q)) ||
      (t.rfidCode?.toLowerCase().includes(q)) ||
      (t.barcode?.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  const filteredUpcoming = useMemo(() => upcoming.filter(matchesSearch), [upcoming, matchesSearch]);
  const filteredCheckedIn = useMemo(() => allCheckedIn.filter(matchesSearch), [allCheckedIn, matchesSearch]);
  const filteredPending = useMemo(() => pendingTickets.filter(matchesSearch), [pendingTickets, matchesSearch]);

  const filteredSubscriptions = useMemo(() => {
    return subscriptions.map((s) => ({
      ...s,
      tickets: s.tickets.filter(matchesSearch),
    })).filter((s) => s.tickets.length > 0);
  }, [subscriptions, matchesSearch]);

  // Reguläre Service-/Tickettyp-Gruppen (alle ohne Vereins-Zugehoerigkeit) –
  // werden ganz oben in der Tickets-Sektion gerendert wie gewohnt.
  const serviceGroups = useMemo(() => {
    const groups = new Map<string, CheckinTicket[]>();
    for (const t of filteredPending) {
      if (t.vereinId != null) continue;
      const key = t.service?.name ?? t.subscription?.name ?? t.ticketTypeName ?? "Sonstige";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return groups;
  }, [filteredPending]);

  // Vereins-Gruppen: pro Verein eine eingeklappte Sektion am Ende der
  // Tickets-Liste. Mitglieder-Tickets eines Vereins koennen schnell zu
  // hundert Eintraegen anwachsen (z. B. "Tristar Oelde") und sollen den
  // Tagesueberblick nicht zumuellen. Bei aktiver Suche werden Treffer
  // automatisch ausgeklappt, damit man trotzdem klicken kann.
  const vereinGroups = useMemo(() => {
    const groups = new Map<number, { id: number; name: string; tickets: CheckinTicket[] }>();
    for (const t of filteredPending) {
      if (t.vereinId == null) continue;
      const name = t.verein?.name ?? `Verein #${t.vereinId}`;
      const entry = groups.get(t.vereinId) ?? { id: t.vereinId, name, tickets: [] };
      entry.tickets.push(t);
      groups.set(t.vereinId, entry);
    }
    const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const g of sorted) {
      g.tickets.sort((a, b) => {
        const aN = (a.lastName ?? a.name).toLowerCase();
        const bN = (b.lastName ?? b.name).toLowerCase();
        return aN.localeCompare(bN);
      });
    }
    return sorted;
  }, [filteredPending]);

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
          <img src="/logo-dark.png" alt="EMP Access" className="h-9 w-9 shrink-0" />
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
          {(() => {
            const openable = data?.openableDevices ?? [];
            if (openable.length === 0) return null;

            const quickIds = data?.quickDeviceIds ?? [];
            const quickDevices = quickIds
              .map((id) => openable.find((d) => d.id === id))
              .filter((d): d is OpenableDevice => !!d);
            const remaining = openable.filter((d) => !quickIds.includes(d.id));

            // Direkt-Button-Renderer (Schnellzugriff oder Single-Door-Fallback).
            const renderDirectButton = (d: OpenableDevice) => {
              const isLoading = openingDeviceId === d.id;
              const wasOpened = openedDeviceIds.has(d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => handleQuickOpen(d.id)}
                  disabled={openingDeviceId !== null}
                  title={`${d.name} öffnen`}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors active:scale-95 disabled:opacity-60 whitespace-nowrap",
                    wasOpened
                      ? "bg-emerald-600 text-white"
                      : "bg-sky-600 hover:bg-sky-500 text-white",
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                  ) : wasOpened ? (
                    <Check className="h-5 w-5 shrink-0" />
                  ) : (
                    <DoorOpen className="h-5 w-5 shrink-0" />
                  )}
                  <span className="hidden md:inline">{d.name}</span>
                </button>
              );
            };

            // Dropdown-Renderer fuer "Mehr Türen" / Sammel-Reinlassen.
            const renderDropdown = (label: string, items: OpenableDevice[]) => {
              const anyLoading = openingDeviceId !== null && items.some((d) => d.id === openingDeviceId);
              const anyJustOpened = items.some((d) => openedDeviceIds.has(d.id));
              return (
                <div ref={openMenuRef} className="relative">
                  <button
                    onClick={() => setOpenMenuOpen((v) => !v)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors active:scale-95 whitespace-nowrap",
                      anyJustOpened
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-700 hover:bg-slate-600 text-white",
                    )}
                  >
                    {anyLoading ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                    ) : anyJustOpened ? (
                      <Check className="h-5 w-5 shrink-0" />
                    ) : (
                      <DoorOpen className="h-5 w-5 shrink-0" />
                    )}
                    <span className="hidden md:inline">{label}</span>
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 transition-transform", openMenuOpen && "rotate-180")}
                    />
                  </button>
                  {openMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-72 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-xl ring-1 ring-black/20 p-2 z-50">
                      <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wider text-slate-500">
                        Tür öffnen
                      </div>
                      {items.map((d) => {
                        const isLoading = openingDeviceId === d.id;
                        const wasOpened = openedDeviceIds.has(d.id);
                        return (
                          <button
                            key={d.id}
                            onClick={() => {
                              handleQuickOpen(d.id);
                              setOpenMenuOpen(false);
                            }}
                            disabled={openingDeviceId !== null}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-60",
                              wasOpened
                                ? "bg-emerald-600/20 text-emerald-300"
                                : "text-slate-100 hover:bg-slate-800",
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                                wasOpened ? "bg-emerald-600 text-white" : "bg-sky-600/20 text-sky-300",
                              )}
                            >
                              {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : wasOpened ? (
                                <Check className="h-4 w-4" />
                              ) : (
                                <DoorOpen className="h-4 w-4" />
                              )}
                            </span>
                            <span className="truncate">{d.name}</span>
                            <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500 shrink-0">
                              {d.category === "DREHKREUZ" ? "Drehkreuz" : "Tür"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            };

            // Keine Schnellzugriff-Türen konfiguriert → einzelner Sammel-Button
            // mit allen Türen im Dropdown.
            if (quickDevices.length === 0) {
              if (openable.length === 1) return renderDirectButton(openable[0]);
              return renderDropdown("Reinlassen", openable);
            }

            // Schnellzugriff-Türen als direkte Buttons + optional Dropdown fuer
            // den Rest.
            return (
              <>
                {quickDevices.map(renderDirectButton)}
                {remaining.length > 0 && renderDropdown(`+${remaining.length}`, remaining)}
              </>
            );
          })()}
          <button
            onClick={() => { setAddTicketPrefill(undefined); setAddTicketOpen(true); }}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <Plus className="h-5 w-5" />
            <span className="hidden sm:inline">Ticket</span>
          </button>
          <button
            onClick={() => { setAnnouncementError(null); setAnnouncementOpen(true); }}
            title="Hinweis an die Live-Monitore schicken"
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors active:scale-95",
              announcementSentAt
                ? "bg-emerald-600 text-white"
                : "bg-amber-600 hover:bg-amber-500 text-white",
            )}
          >
            {announcementSentAt ? <Check className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}
            <span className="hidden sm:inline">
              {announcementSentAt ? "Gesendet" : "Hinweis"}
            </span>
          </button>
          <button
            onClick={() => setLockerOverlayOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <Lock className="h-5 w-5" />
            <span className="hidden sm:inline">Schließfächer</span>
          </button>
          <button
            onClick={() => setScanMode(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <ScanLine className="h-5 w-5" />
            Scannen
          </button>
          <LiveClock />
          <button
            onClick={() => { setRefreshing(true); refreshRef.current?.(); setTimeout(() => setRefreshing(false), 800); }}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors active:scale-95"
            title="Aktualisieren"
          >
            <RefreshCw className={cn("h-4.5 w-4.5", refreshing && "animate-spin")} />
          </button>
        </div>
      </header>

      {/* ANNY Sync Status */}
      {data?.annySyncStatus && (() => {
        const syncSt = data.annySyncStatus!;
        const syncAge = syncSt.lastSync ? Date.now() - new Date(syncSt.lastSync).getTime() : Infinity;
        const isStale = syncAge > 2 * 60 * 60_000;
        const hasErrors = (syncSt.errors ?? 0) > 0;
        const details = syncSt.errorDetails ?? [];
        const fmtAgo = (iso: string | null) => {
          if (!iso) return "Nie";
          const diff = Date.now() - new Date(iso).getTime();
          const mins = Math.floor(diff / 60_000);
          if (mins < 1) return "Gerade eben";
          if (mins < 60) return `vor ${mins} Min.`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `vor ${hrs} Std.`;
          return `vor ${Math.floor(hrs / 24)} Tagen`;
        };
        const triggerSync = async () => {
          if (syncing) return;
          setSyncing(true);
          try {
            await fetch(`/api/checkin/public/${token}/anny-sync`, { method: "POST" });
            refreshRef.current?.();
          } catch { /* ignore */ }
          setSyncing(false);
        };
        return (
          <div className={cn(
            "border-b text-xs",
            hasErrors
              ? "border-rose-900/50 bg-rose-950/20 text-rose-400"
              : isStale
                ? "border-amber-900/50 bg-amber-950/20 text-amber-400"
                : "border-slate-800 bg-slate-900/50 text-slate-400",
          )}>
            <div className="flex items-center gap-2 px-4 py-1.5">
              <div
                className={cn("flex items-center gap-2 flex-1 min-w-0", hasErrors && details.length > 0 && "cursor-pointer")}
                onClick={() => { if (hasErrors && details.length > 0) setSyncErrorsOpen((v) => !v); }}
              >
                <RefreshCw className={cn("h-3 w-3 shrink-0", syncing && "animate-spin")} />
                <span className="truncate">ANNY Sync: {fmtAgo(syncSt.lastSync)}</span>
                {(syncSt.created ?? 0) > 0 && <span className="text-emerald-400 shrink-0">+{syncSt.created} neu</span>}
                {hasErrors && <span className="text-rose-400 shrink-0">{syncSt.errors} Fehler</span>}
                {hasErrors && details.length > 0 && <span className="text-rose-500">{syncErrorsOpen ? "▲" : "▼"}</span>}
              </div>
              <button
                onClick={triggerSync}
                disabled={syncing}
                className={cn(
                  "shrink-0 px-2.5 py-0.5 rounded-lg font-semibold transition-colors active:scale-95",
                  syncing
                    ? "bg-slate-700 text-slate-500 cursor-wait"
                    : "bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50 border border-indigo-500/30",
                )}
              >
                {syncing ? "Sync..." : "Jetzt synchronisieren"}
              </button>
            </div>
            {syncErrorsOpen && details.length > 0 && (
              <div className="px-4 pb-2 space-y-0.5">
                {details.map((d, i) => (
                  <p key={i} className="text-[10px] text-rose-300/80 font-mono truncate">{d}</p>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Day selector */}
      <DaySelector date={date} onChange={setDate} />

      {/* Search */}
      <div className="px-4 py-2 border-b border-slate-800/50">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ticket suchen…"
            className="w-full bg-slate-800/60 border border-slate-700/50 text-white rounded-xl pl-9 pr-9 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-safe monitor-scrollbar">

        {/* Upcoming */}
        {filteredUpcoming.length > 0 && (
          <Section title="Nächste Gäste" icon={Clock} count={filteredUpcoming.length} color="amber">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredUpcoming.map((t) => (
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
        <Section title="Tickets" icon={Ticket} count={filteredPending.length} color="indigo">
          {filteredPending.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">Keine ausstehenden Tickets</p>
          ) : (
            <div className="space-y-3">
              {[...serviceGroups.entries()].map(([groupName, tickets]) => {
                // Leere Gruppen werden ohnehin durch das filteredPending-
                // Verfahren rausgefiltert; defensiv noch ein expliziter Skip
                // damit kein Header ohne Inhalt erscheint.
                if (tickets.length === 0) return null;
                const isSearching = searchQuery.trim().length > 0;
                const isExpanded = isSearching || expandedServiceGroups.has(groupName);
                return (
                  <div key={groupName} className="rounded-xl border border-slate-800/70 bg-slate-900/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        if (isSearching) return;
                        setExpandedServiceGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(groupName)) next.delete(groupName);
                          else next.add(groupName);
                          return next;
                        });
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/40 transition-colors text-left"
                    >
                      <Ticket className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider truncate">
                        {groupName}
                      </span>
                      <Badge className="ml-1 bg-indigo-500/20 text-indigo-300 border-indigo-500/30 font-normal">
                        {tickets.length}
                      </Badge>
                      <ChevronDown
                        className={cn(
                          "ml-auto h-4 w-4 text-slate-500 shrink-0 transition-transform",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </button>
                    {isExpanded && (
                      <div className="border-t border-slate-800/70 p-2">
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
                    )}
                  </div>
                );
              })}

              {/* Vereine: standardmaessig eingeklappt am Ende. Bei aktiver
                  Suche immer aufgeklappt, damit Treffer sichtbar sind. */}
              {vereinGroups.map((g) => {
                const isSearching = searchQuery.trim().length > 0;
                const isExpanded = isSearching || expandedVereine.has(g.id);
                return (
                  <div key={`verein-${g.id}`} className="rounded-xl border border-slate-800/70 bg-slate-900/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        if (isSearching) return;
                        setExpandedVereine((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.id)) next.delete(g.id);
                          else next.add(g.id);
                          return next;
                        });
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/40 transition-colors text-left"
                    >
                      <Users className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider truncate">
                        {g.name}
                      </span>
                      <Badge className="ml-1 bg-indigo-500/20 text-indigo-300 border-indigo-500/30 font-normal">
                        {g.tickets.length}
                      </Badge>
                      <span className="ml-auto text-[10px] text-slate-500 uppercase tracking-wider">
                        Verein
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-slate-500 shrink-0 transition-transform",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </button>
                    {isExpanded && (
                      <div className="border-t border-slate-800/70 p-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {g.tickets.map((t) => (
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
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Checked in */}
        {filteredCheckedIn.length > 0 && (
          <Section title="Eingecheckt" icon={CheckCircle2} count={filteredCheckedIn.length} color="emerald">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredCheckedIn.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  onTap={() => setSelectedTicket(t)}
                  checked
                  isSub={!!t.subscriptionId}
                  highlight={scanHighlights.get(t.id)}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Subscriptions – jedes Abo wie Vereine als eingeklappte Box.
            Bei Suche automatisch aufgeklappt. */}
        {filteredSubscriptions.length > 0 && (
          <Section title="Abonnements" icon={CreditCard} count={filteredSubscriptions.reduce((a, s) => a + s.tickets.length, 0)} color="violet">
            <div className="space-y-2">
              {filteredSubscriptions.map((sub) => {
                const isSearching = searchQuery.trim().length > 0;
                const isExpanded = isSearching || expandedAbos.has(sub.id);
                return (
                  <div key={sub.id} className="rounded-xl border border-slate-800/70 bg-slate-900/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        if (isSearching) return;
                        setExpandedAbos((prev) => {
                          const next = new Set(prev);
                          if (next.has(sub.id)) next.delete(sub.id);
                          else next.add(sub.id);
                          return next;
                        });
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/40 transition-colors text-left"
                    >
                      <CreditCard className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider truncate">
                        {sub.name}
                      </span>
                      <Badge className="ml-1 bg-violet-500/20 text-violet-300 border-violet-500/30 font-normal">
                        {sub.tickets.length}
                      </Badge>
                      <span className="ml-auto text-[10px] text-slate-500 uppercase tracking-wider">
                        Abo
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-slate-500 shrink-0 transition-transform",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </button>
                    {isExpanded && (
                      <div className="border-t border-slate-800/70 p-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {sub.tickets.map((t) => (
                            <TicketCard
                              key={t.id}
                              ticket={{ ...t, subscription: { id: sub.id, name: sub.name, requiresPhoto: sub.requiresPhoto, requiresRfid: sub.requiresRfid } }}
                              onTap={() => setSelectedTicket({ ...t, subscription: { id: sub.id, name: sub.name, requiresPhoto: sub.requiresPhoto, requiresRfid: sub.requiresRfid } })}
                              checked={t.checkedIn}
                              onCheckin={() => handleCheckin(t.id)}
                              checkingIn={checkingIn === t.id}
                              isSub
                              highlight={scanHighlights.get(t.id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
          onSaveDates={(startDate, endDate) => handleUpdateTicket(selectedTicket.id, { startDate, endDate })}
          onSavePerson={(person) => handleUpdateTicket(selectedTicket.id, person)}
          onOpenCamera={() => setCameraOpen(true)}
          updatingTicket={updatingTicket === selectedTicket.id}
          accountName={data?.accountName ?? ""}
          rfidConflict={rfidConflict?.ticketId === selectedTicket.id ? rfidConflict : null}
          onForceRfid={() => { if (rfidConflict) { handleUpdateTicket(rfidConflict.ticketId, { rfidCode: rfidConflict.rfidCode }, true); } }}
          onCancelRfid={() => setRfidConflict(null)}
          ticketScans={(data?.recentScans ?? []).filter((s) => s.ticketId === selectedTicket.id)}
          onAddTicket={() => {
            setAddTicketPrefill({
              firstName: selectedTicket.firstName ?? undefined,
              lastName: selectedTicket.lastName ?? undefined,
              rfidCode: selectedTicket.rfidCode ?? undefined,
              profileImage: selectedTicket.profileImage,
            });
            setSelectedTicket(null);
            setAddTicketOpen(true);
          }}
          onCancelVoucher={handleCancelVoucher}
          cancellingVoucher={cancellingVoucher}
        />
      )}

      {cameraOpen && (
        <CameraOverlay
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* Add ticket overlay */}
      {addTicketOpen && (
        <AddTicketOverlay
          token={token}
          services={data?.services ?? []}
          onClose={() => { setAddTicketOpen(false); setAddTicketPrefill(undefined); }}
          onCreated={async (newTicketId) => {
            // Saubere Refresh-Choreographie nach Ticket-Create:
            // 1) Overlay sofort schliessen (Mitarbeiter sieht kurz die
            //    Liste).
            // 2) Falls der Monitor gerade nicht "heute" anzeigt, auf
            //    heute springen - nur dort taucht das neue Ticket auf
            //    (Default-Datum ist heute).
            // 3) Refresh-Indikator anstellen, Daten neu laden.
            // 4) Neu erstelltes Ticket kurz hervorheben (gleiche
            //    Highlight-Logik wie bei einem Live-Scan).
            setAddTicketOpen(false);
            setAddTicketPrefill(undefined);
            const today = toDateStr(new Date());
            if (date !== today) {
              setDate(today);
            }
            setRefreshing(true);
            try {
              await refreshRef.current?.();
            } finally {
              setRefreshing(false);
            }
            if (newTicketId) {
              setScanHighlights((prev) => {
                const next = new Map(prev);
                next.set(newTicketId, "GRANTED");
                return next;
              });
              setTimeout(() => {
                setScanHighlights((prev) => {
                  const next = new Map(prev);
                  next.delete(newTicketId);
                  return next;
                });
              }, 4000);
            }
          }}
          prefill={addTicketPrefill}
        />
      )}

      {/* Locker overlay */}
      {lockerOverlayOpen && (
        <LockerOverlay
          token={token}
          onClose={() => setLockerOverlayOpen(false)}
        />
      )}

      {/* Hinweis-an-Monitore Dialog */}
      {announcementOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setAnnouncementOpen(false); }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                <Megaphone className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white">Hinweis an Monitore</h2>
                <p className="text-xs text-slate-400">
                  Erscheint als Banner oben in allen Live-Monitoren, bis dort manuell geschlossen.
                </p>
              </div>
              <button
                onClick={() => setAnnouncementOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                autoFocus
                value={announcementText}
                onChange={(e) => setAnnouncementText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void handleSendAnnouncement();
                  }
                }}
                placeholder='z.B. "Anfängerkurs kommt gleich an Seilbahn A"'
                maxLength={500}
                rows={4}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 text-white text-sm px-3 py-2.5 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/60 resize-none"
              />
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{announcementText.length}/500</span>
                <span>⌘/Ctrl + Enter zum Senden</span>
              </div>
              {announcementError && (
                <div className="rounded-lg bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-xs text-rose-300">
                  {announcementError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
              <button
                onClick={() => setAnnouncementOpen(false)}
                disabled={announcementSending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSendAnnouncement}
                disabled={announcementSending || !announcementText.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {announcementSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Senden
              </button>
            </div>
          </div>
        </div>
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

  const todayStrGlobal = toDateStr(new Date());

  const days = useMemo(() => {
    const result: { date: string; label: string; isToday: boolean }[] = [];
    const center = new Date(date + "T12:00:00");
    for (let i = -3; i <= 3; i++) {
      const d = new Date(center);
      d.setDate(d.getDate() + i);
      const ds = toDateStr(d);
      result.push({
        date: ds,
        label: d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }),
        isToday: ds === todayStrGlobal,
      });
    }
    return result;
  }, [date, todayStrGlobal]);

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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => setCalOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] w-full sm:w-[340px] shadow-2xl">
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
                const isToday = ds === todayStrGlobal;
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
                onClick={() => { onChange(todayStrGlobal); setCalOpen(false); }}
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
          : ticket.status === "PAUSED"
          ? "border-orange-700/40 bg-orange-950/30 opacity-70"
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
        <p className="text-sm font-bold truncate">
          {personName(ticket)}
          {(() => { const a = calcAge(ticket.birthDate); return a != null ? <span className="ml-1 text-xs font-normal text-slate-500">({a})</span> : null; })()}
        </p>
        {(() => {
          const timeLabel = formatTicketTimeLabel(ticket);
          return (
            <p className="text-xs text-slate-400 truncate">
              {timeLabel}
              {timeLabel && ticket.ticketTypeName ? " · " : ""}
              {ticket.ticketTypeName ?? ""}
            </p>
          );
        })()}
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
        {ticket.status === "PAUSED" ? (
          <Badge className="bg-orange-500/25 text-orange-200 text-[11px] px-2 py-0.5 font-bold">Pausiert</Badge>
        ) : checked ? (
          <Badge className="bg-emerald-500/25 text-emerald-200 text-[11px] px-2 py-0.5 font-bold">Eingecheckt</Badge>
        ) : onCheckin ? (
          <div className="flex flex-col items-end gap-1">
            {isSub && <Badge className="bg-violet-500/25 text-violet-200 text-[11px] px-2 py-0.5 font-bold">Abo</Badge>}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCheckin(); }}
              disabled={checkingIn}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-colors active:scale-95 disabled:opacity-50"
            >
              {checkingIn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Einchecken"}
            </button>
          </div>
        ) : isSub ? (
          <Badge className="bg-violet-500/25 text-violet-200 text-[11px] px-2 py-0.5 font-bold">Abo</Badge>
        ) : null}
      </div>
    </div>
  );
}

/// Erzeugt einen Datei-Slug aus Tickettyp/Code fuer den Download-Fallback.
function buildPrintFilename(prefix: string, code: string): string {
  const slug = code.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "ticket";
  return `${prefix}_${slug}.pdf`;
}

async function printTicket(ticket: CheckinTicket, accountName: string): Promise<PrintResult> {
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
  return printPdfBlob(blob, buildPrintFilename("ticket", code));
}

async function printVoucher(
  voucherCode: string,
  ticketTypeName: string | null,
  accountName: string,
): Promise<PrintResult> {
  let qrDataUrl = "";
  try {
    qrDataUrl = await QRCode.toDataURL(voucherCode, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch { /* ignore */ }

  const pw = 72;
  const margin = 4;
  const contentW = pw - margin * 2;
  const doc = new jsPDF({ unit: "mm", format: [pw, 160] });

  let y = 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(accountName, pw / 2, y, { align: "center" });
  y += 5;

  doc.setDrawColor(0);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);
  y += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("GUTSCHEIN", pw / 2, y, { align: "center" });
  y += 6;

  if (ticketTypeName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const typeLines = doc.splitTextToSize(ticketTypeName, contentW);
    doc.text(typeLines, pw / 2, y, { align: "center" });
    y += typeLines.length * 4;
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

  doc.setFont("courier", "bold");
  doc.setFontSize(10);
  doc.text(voucherCode, pw / 2, y, { align: "center" });
  y += 5;

  doc.line(margin, y, pw - margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Einmalig einlösbar. Beim Scannen wird", pw / 2, y, { align: "center" });
  y += 3;
  doc.text("ein Tagesticket erstellt.", pw / 2, y, { align: "center" });
  y += 4;

  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  doc.text(`Erstellt: ${now}`, pw / 2, y, { align: "center" });
  y += 8;

  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pw - margin, y);

  const blob = doc.output("blob");
  return printPdfBlob(blob, buildPrintFilename("gutschein", voucherCode));
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
  onSaveDates,
  onSavePerson,
  onOpenCamera,
  updatingTicket,
  accountName,
  rfidConflict,
  onForceRfid,
  onCancelRfid,
  ticketScans,
  onAddTicket,
  onCancelVoucher,
  cancellingVoucher,
}: {
  ticket: CheckinTicket;
  onClose: () => void;
  onCheckin: () => void;
  checkingIn: boolean;
  editMode: "photo" | "rfid" | "dates" | "person" | null;
  setEditMode: (m: "photo" | "rfid" | "dates" | "person" | null) => void;
  onSaveDates: (startDate: string | null, endDate: string | null) => void;
  onSavePerson: (person: { firstName: string | null; lastName: string | null; birthDate: string | null }) => void;
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
  onAddTicket: () => void;
  onCancelVoucher: () => void;
  cancellingVoucher: boolean;
}) {
  const extras = (ticket.extras ?? []) as TicketExtra[];
  const isSub = !!ticket.subscriptionId;
  const isChecked = isSub ? ticket.checkedIn : (ticket.checkedIn || ticket.status === "REDEEMED");

  const toDateValue = (d: string | null) => d ? new Date(d).toISOString().slice(0, 10) : "";
  const [dateStart, setDateStart] = useState(toDateValue(ticket.startDate));
  const [dateEnd, setDateEnd] = useState(toDateValue(ticket.endDate));
  useEffect(() => {
    setDateStart(toDateValue(ticket.startDate));
    setDateEnd(toDateValue(ticket.endDate));
  }, [ticket.startDate, ticket.endDate]);

  const [editFirstName, setEditFirstName] = useState(ticket.firstName ?? "");
  const [editLastName, setEditLastName] = useState(ticket.lastName ?? "");
  const [editBirthDate, setEditBirthDate] = useState(toDateValue(ticket.birthDate));
  const birthDateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editMode !== "person") {
      setEditFirstName(ticket.firstName ?? "");
      setEditLastName(ticket.lastName ?? "");
      setEditBirthDate(toDateValue(ticket.birthDate));
    }
  }, [ticket.firstName, ticket.lastName, ticket.birthDate, editMode]);
  useEffect(() => {
    if (birthDateRef.current && document.activeElement !== birthDateRef.current) {
      birthDateRef.current.value = editBirthDate;
    }
  }, [editBirthDate]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)] monitor-scrollbar"
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
            <button
              type="button"
              onClick={() => setEditMode(editMode === "person" ? null : "person")}
              className="group flex items-center gap-1.5 text-left max-w-full"
              title="Name & Geburtstag bearbeiten"
            >
              <h2 className="text-xl font-bold truncate">{personName(ticket)}</h2>
              <Pencil className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
            </button>
            <p className="text-sm text-slate-400 mt-0.5">
              {ticket.ticketTypeName ?? ticket.service?.name ?? ticket.subscription?.name ?? ""}
              {(() => {
                const a = calcAge(ticket.birthDate);
                return a != null ? <span className="ml-1 text-slate-500">· {a} J.</span> : null;
              })()}
            </p>
            {(() => {
              const label = formatTicketTimeLabel(ticket);
              return label ? (
                <p className="text-sm text-slate-500 mt-0.5">{label} Uhr</p>
              ) : null;
            })()}
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

        {/* Person-Edit */}
        {editMode === "person" && (
          <div className="px-5 py-4 border-b border-slate-800 space-y-3 bg-slate-900/60">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              <Users className="h-3.5 w-3.5 inline mr-1.5" />
              Person
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Vorname</label>
                <input
                  type="text"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  placeholder="Max"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Nachname</label>
                <input
                  type="text"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  placeholder="Mustermann"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Geburtsdatum</label>
              <input
                ref={birthDateRef}
                type="date"
                defaultValue={editBirthDate}
                onChange={(e) => setEditBirthDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              {(() => {
                const a = calcAge(editBirthDate || null);
                return a != null ? (
                  <p className="text-xs text-slate-500">Alter: {a} Jahre</p>
                ) : null;
              })()}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onSavePerson({
                    firstName: editFirstName.trim() || null,
                    lastName: editLastName.trim() || null,
                    birthDate: editBirthDate
                      ? new Date(editBirthDate).toISOString()
                      : null,
                  });
                }}
                disabled={updatingTicket}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95"
              >
                {updatingTicket && editMode === "person" ? (
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                ) : (
                  "Speichern"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditFirstName(ticket.firstName ?? "");
                  setEditLastName(ticket.lastName ?? "");
                  setEditBirthDate(toDateValue(ticket.birthDate));
                  setEditMode(null);
                }}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-semibold transition-colors active:scale-95"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

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
          {editMode === "dates" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium w-16 shrink-0">Gültig</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <span className="text-slate-500 self-center">–</span>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onSaveDates(
                      dateStart ? new Date(dateStart).toISOString() : null,
                      dateEnd ? new Date(dateEnd).toISOString() : null,
                    );
                  }}
                  disabled={updatingTicket}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95"
                >
                  {updatingTicket && editMode === "dates" ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Speichern"}
                </button>
                <button
                  onClick={() => {
                    setDateStart(toDateValue(ticket.startDate));
                    setDateEnd(toDateValue(ticket.endDate));
                    setEditMode(null);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-semibold transition-colors active:scale-95"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditMode("dates")}
              className="flex items-center gap-2 text-xs w-full text-left group"
            >
              <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-slate-400 font-medium w-16 shrink-0">Gültig</span>
              <span className="text-slate-200 truncate">
                {ticket.startDate && ticket.endDate
                  ? `${new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })} – ${new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}${new Date(ticket.endDate) < new Date() ? " (abgelaufen)" : ""}`
                  : ticket.startDate
                    ? `ab ${new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}`
                    : "Nicht gesetzt"}
              </span>
              <Pencil className="h-3 w-3 text-slate-600 group-hover:text-slate-400 transition-colors ml-auto shrink-0" />
            </button>
          )}
        </div>

        {/* Scan history */}
        {ticketScans.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-800">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              <ScanLine className="h-3.5 w-3.5 inline mr-1.5" />Scanverlauf
            </p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto monitor-scrollbar">
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

          {/* New ticket for same person */}
          <button
            onClick={onAddTicket}
            className="w-full bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            Neues Ticket hinzufügen
          </button>

          {ticket.status !== "CANCELED" && (
            <button
              onClick={onCancelVoucher}
              disabled={cancellingVoucher}
              className="w-full bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-[0.98] disabled:opacity-50"
            >
              <TicketX className="h-4 w-4" />
              {cancellingVoucher ? "Wird storniert..." : "Stornieren & Gutschein"}
            </button>
          )}
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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl w-full sm:max-w-md p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4">
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
    <div className="fixed inset-0 z-[60] bg-black flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
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
        <div className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex justify-center">
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

/* ──── Add Ticket Overlay ──── */

const ADD_EMPTY = {
  firstName: "",
  lastName: "",
  ticketTypeName: "",
  code: "",
  accessAreaId: "none",
  subscriptionId: "none",
  serviceId: "none",
  status: "VALID",
  startDate: "",
  endDate: "",
  validityType: "DATE_RANGE",
  slotStart: "",
  slotEnd: "",
  validityDurationMinutes: "",
};

function toDateInput(val: string | Date | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/// Robuster POST für Tickets aus dem Shop-Monitor: Timeout via AbortController
/// und ein Retry mit Backoff bei transienten Fehlern (Netz/Abort/5xx).
/// Mutationen sind hier safe zu wiederholen, weil im Erfolgsfall die zweite
/// Anfrage nicht mehr ausgelöst wird – nur bei *fehlgeschlagener* Antwort
/// wird erneut gesendet.
async function postTicketWithRetry(
  token: string,
  payload: Record<string, unknown>,
  { timeoutMs = 12_000, retries = 1 }: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`/api/checkin/public/${token}/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
        keepalive: true,
      });
      if (res.status >= 500 && res.status <= 599 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      if ((isAbort || isNetwork) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("Unbekannter Fehler");
}

function AddTicketOverlay({
  token,
  services,
  onClose,
  onCreated,
  prefill,
}: {
  token: string;
  services: ServiceData[];
  onClose: () => void;
  onCreated: (newTicketId?: number) => void;
  prefill?: {
    firstName?: string;
    lastName?: string;
    rfidCode?: string;
    profileImage?: string | null;
    voucher?: {
      code: string;
      ticketTypeName: string | null;
      serviceId: number | null;
      serviceName: string | null;
      accessAreaId: number | null;
      accessAreaName: string | null;
      validityType: string | null;
      validityDurationMinutes: number | null;
    };
  };
}) {
  const voucher = prefill?.voucher;
  const [firstName, setFirstName] = useState(prefill?.firstName ?? "");
  const [lastName, setLastName] = useState(prefill?.lastName ?? "");
  const [code, setCode] = useState(prefill?.rfidCode ?? "");
  const [serviceId, setServiceId] = useState(
    voucher?.serviceId != null ? String(voucher.serviceId) : "none",
  );
  // accessAreaId bleibt im State - wird automatisch ueber den Service gesetzt,
  // hat aber keine UI-Eingabemoeglichkeit mehr (Shop-Workflow: nicht relevant).
  const [accessAreaId, setAccessAreaId] = useState(
    voucher?.accessAreaId != null ? String(voucher.accessAreaId) : "none",
  );
  // Optionale Datums-Felder. Format je nach `dateMode`:
  //   * "datetime" -> yyyy-mm-ddTHH:mm (Kurs: Datum + Uhrzeit von/bis)
  //   * "single"   -> yyyy-mm-dd, nur startDate sichtbar (Tagesticket/DURATION)
  // Leer = Service-Defaults oder Fallback "heute".
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);

  // Slot-Auswahl aus ANNY (nur bei TIME_SLOT-Services). `slotDate` haelt den
  // gewaehlten Tag im Slot-Picker; daraus wird beim Slot-Klick startDate /
  // endDate gesetzt. `slots` kommt aus /slots-Endpoint, `hasAnnyLink`
  // entscheidet, ob das Slot-Grid oder das datetime-local-Fallback gezeigt
  // wird.
  const [slotDate, setSlotDate] = useState("");
  const [slots, setSlots] = useState<
    Array<{
      startTime: string;
      endTime: string;
      startIso: string;
      endIso: string;
      remaining?: number;
    }>
  >([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsLoaded, setSlotsLoaded] = useState(false);
  const [hasAnnyLink, setHasAnnyLink] = useState(false);
  const [slotsNote, setSlotsNote] = useState<string>("");

  // Effektiver Datums-Modus fuer die UI:
  //   * Service mit TIME_SLOT oder ANNY-Verknuepfung -> "datetime" (Kurs)
  //   * sonst (Ticket/DURATION)                      -> "single" (nur Datum)
  // Abos werden in diesem Dialog gar nicht angeboten - reine Abo-Vergabe
  // laeuft ueber das Backoffice.
  //
  // Der `hasAnnyLink`-Pfad ist wichtig, weil manche Kurse im Backoffice als
  // DATE_RANGE/NULL konfiguriert sind, obwohl sie de-facto Slot-Buchungen
  // sind. Sobald eine ANNY-Resource haengt, behandeln wir den Service als
  // Slot-Service und ziehen Slots aus ANNY.
  const dateMode: "single" | "datetime" = useMemo(() => {
    if (serviceId !== "none") {
      const svc = services.find((s) => String(s.id) === serviceId);
      if (svc?.defaultValidityType === "TIME_SLOT") return "datetime";
      if (svc?.hasAnnyLink) return "datetime";
    }
    if (voucher?.validityType === "TIME_SLOT") return "datetime";
    return "single";
  }, [serviceId, services, voucher]);
  const [error, setError] = useState("");

  // Slots fuer (Service, slotDate) aus ANNY ziehen. Re-fetch bei Wechsel von
  // Service oder Datum. Bei dateMode != "datetime" deaktiviert (Tagestickets
  // brauchen keine Slot-Liste).
  useEffect(() => {
    if (dateMode !== "datetime" || serviceId === "none" || !slotDate) {
      setSlots([]);
      setSlotsLoaded(false);
      setHasAnnyLink(false);
      setSlotsNote("");
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsLoaded(false);
    fetch(
      `/api/checkin/public/${token}/slots?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(slotDate)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((data: { slots?: typeof slots; hasAnnyLink?: boolean; note?: string }) => {
        if (cancelled) return;
        setSlots(Array.isArray(data.slots) ? data.slots : []);
        setHasAnnyLink(Boolean(data.hasAnnyLink));
        setSlotsNote(typeof data.note === "string" ? data.note : "");
        setSlotsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
        setHasAnnyLink(false);
        setSlotsNote("");
        setSlotsLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateMode, serviceId, slotDate, token]);

  const [pendingConflict, setPendingConflict] = useState<{
    label: string;
    type: string | null;
    payload: Record<string, unknown>;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setPendingConflict(null);

    // Tickets ohne Personalisierung sind im Shop ueblich (anonyme
    // Tageskarten/Anfaengerkurs-Pl aetze). Wenn weder Vor- noch Nachname
    // gesetzt sind, leiten wir den Anzeigenamen aus dem Service-/Abo-
    // Namen ab, sonst Fallback "Ticket".
    const fullName =
      `${firstName} ${lastName}`.trim()
      || services.find((s) => String(s.id) === serviceId)?.name
      || voucher?.ticketTypeName
      || "Ticket";
    const payload: Record<string, unknown> = {
      name: fullName,
      status: "VALID",
    };
    if (firstName) payload.firstName = firstName;
    if (lastName) payload.lastName = lastName;

    if (serviceId !== "none") {
      payload.serviceId = Number(serviceId);
      const svc = services.find((s) => String(s.id) === serviceId);
      if (svc) {
        payload.ticketTypeName = svc.name;
        if (svc.defaultValidityType) {
          payload.validityType = svc.defaultValidityType;
          if (svc.defaultValidityType === "DATE_RANGE") {
            if (svc.defaultStartDate) payload.startDate = new Date(svc.defaultStartDate).toISOString();
            if (svc.defaultEndDate) payload.endDate = new Date(svc.defaultEndDate).toISOString();
          } else if (svc.defaultValidityType === "TIME_SLOT") {
            if (svc.defaultSlotStart) payload.slotStart = svc.defaultSlotStart;
            if (svc.defaultSlotEnd) payload.slotEnd = svc.defaultSlotEnd;
          } else if (svc.defaultValidityType === "DURATION" && svc.defaultValidityDurationMinutes != null) {
            payload.validityDurationMinutes = svc.defaultValidityDurationMinutes;
          }
        }
      }
    }

    if (code) {
      payload.barcode = code;
      payload.qrCode = code;
      payload.rfidCode = code;
    }

    if (prefill?.profileImage) {
      payload.profileImage = prefill.profileImage;
    }

    if (accessAreaId !== "none") {
      payload.accessAreaId = Number(accessAreaId);
    }

    if (voucher) {
      // Gutschein einloesen: Code mitsenden, Backend macht es atomar mit
      // Optimistic Locking. Voucher-Defaults greifen auch dann, wenn der
      // Mitarbeiter keinen Service explizit ausgewaehlt hat.
      payload.voucherCode = voucher.code;
      if (!payload.ticketTypeName && voucher.ticketTypeName) {
        payload.ticketTypeName = voucher.ticketTypeName;
      }
      if (!payload.validityType && voucher.validityType) {
        payload.validityType = voucher.validityType;
      }
      if (
        payload.validityType === "DURATION"
        && payload.validityDurationMinutes == null
        && voucher.validityDurationMinutes != null
      ) {
        payload.validityDurationMinutes = voucher.validityDurationMinutes;
      }
    }

    // Explizite Datums-/Zeit-Eingabe ueberschreibt die Service-/Voucher-
    // Defaults. Format der Werte haengt vom UI-Modus (`dateMode`) ab.
    if (dateMode === "datetime") {
      // Kurs-Modus: yyyy-mm-ddTHH:mm. Datum + Uhrzeit getrennt ans Backend
      // (startDate/endDate als ISO-Datum, slotStart/slotEnd als HH:MM).
      // Sobald wir Slots haben, ist das Ticket eindeutig ein TIME_SLOT -
      // egal was im Service als defaultValidityType konfiguriert war. So
      // funktioniert es auch fuer "Anfaengerkurs" mit DATE_RANGE-Default.
      payload.validityType = "TIME_SLOT";
      if (startDate) {
        const sd = new Date(startDate);
        if (!isNaN(sd.getTime())) {
          payload.startDate = sd.toISOString();
          const t = startDate.split("T")[1];
          if (t) payload.slotStart = t.length === 5 ? `${t}:00` : t;
        }
      }
      if (endDate) {
        const ed = new Date(endDate);
        if (!isNaN(ed.getTime())) {
          payload.endDate = ed.toISOString();
          const t = endDate.split("T")[1];
          if (t) payload.slotEnd = t.length === 5 ? `${t}:00` : t;
        }
      }
    } else if (startDate) {
      // single: ein Datum -> Ticket gilt nur an diesem Tag (ausser DURATION,
      // dort kein endDate, weil sonst der Timer schon mit dem Tag laeuft).
      const sd = new Date(`${startDate}T00:00:00`);
      if (!isNaN(sd.getTime())) payload.startDate = sd.toISOString();
      if (endDate && payload.validityType !== "DURATION") {
        // endDate kann aus Service-Defaults bei Mehrtages-Tickets stammen
        // (im UI nicht angezeigt, aber im State vorhanden).
        const ed = new Date(`${endDate}T23:59:59.999`);
        if (!isNaN(ed.getTime())) payload.endDate = ed.toISOString();
      } else if (payload.validityType !== "DURATION") {
        const ed = new Date(`${startDate}T23:59:59.999`);
        if (!isNaN(ed.getTime())) payload.endDate = ed.toISOString();
      }
    }

    // Fallback: aktuellen Tag als Datum setzen, wenn kein Datum aus
    // Service-/Subscription-Defaults oder User-Eingabe gekommen ist. So
    // ist das Ticket automatisch fuer "heute" gueltig, statt ohne Datum
    // erstellt zu werden (was im Shop Monitor sonst gar nicht mehr
    // angezeigt wird).
    const now = new Date();
    const dayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0,
    );
    const dayEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23, 59, 59, 999,
    );
    const isDuration = payload.validityType === "DURATION";
    if (!payload.startDate) {
      payload.startDate = dayStart.toISOString();
    }
    if (!payload.endDate && !isDuration) {
      payload.endDate = dayEnd.toISOString();
    }
    if (!payload.validityType) {
      payload.validityType = "DATE_RANGE";
    }

    await submitWithPayload(payload);
  }

  async function submitWithPayload(payload: Record<string, unknown>) {
    try {
      const res = await postTicketWithRetry(token, payload);

      if (!res.ok) {
        const data = await safeJson(res);
        const errVal = (data?.error ?? null) as
          | string
          | {
              formErrors?: string[];
              fieldErrors?: Record<string, string[]>;
              serverMessage?: string;
              code?: string;
              conflictTicketLabel?: string;
              conflictTicketType?: string | null;
            }
          | null;

        // Code-Konflikt: Bestaetigungsdialog statt Fehlermeldung anzeigen
        if (
          res.status === 409
          && typeof errVal === "object"
          && errVal
          && errVal.code === "CODE_CONFLICT"
          && !payload.transferCode
        ) {
          setPendingConflict({
            label: errVal.conflictTicketLabel ?? "ein anderes Ticket",
            type: errVal.conflictTicketType ?? null,
            payload,
          });
          setError("");
          setLoading(false);
          return;
        }

        const formErr = typeof errVal === "object" && errVal ? errVal.formErrors?.[0] : undefined;
        const fieldErr =
          typeof errVal === "object" && errVal?.fieldErrors
            ? Object.values(errVal.fieldErrors).flat()[0]
            : undefined;
        const serverMsg =
          typeof errVal === "object" && errVal ? errVal.serverMessage : undefined;
        const baseMsg =
          formErr ??
          fieldErr ??
          (typeof errVal === "string" ? errVal : undefined) ??
          `Fehler beim Erstellen (HTTP ${res.status})`;
        setError(serverMsg ? `${baseMsg}\n${serverMsg}` : baseMsg);
      } else {
        const created = await safeJson(res);
        const newId =
          created && typeof created === "object" && typeof created.id === "number"
            ? created.id
            : undefined;
        setFirstName(""); setLastName(""); setCode("");
        setServiceId("none"); setAccessAreaId("none");
        setStartDate(""); setEndDate("");
        setSlotDate(""); setSlots([]); setSlotsLoaded(false); setHasAnnyLink(false);
        setPendingConflict(null);
        onCreated(newId);
      }
    } catch (err) {
      console.error("[shop-monitor] Ticket-Erstellung fehlgeschlagen", err);
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Zeitüberschreitung – Server antwortet nicht. Bitte erneut versuchen.");
      } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setError("Keine Internetverbindung – bitte WLAN prüfen und erneut senden.");
      } else {
        const msg = err instanceof Error ? err.message : "unbekannt";
        setError(`Netzwerkfehler: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function confirmTransfer() {
    if (!pendingConflict) return;
    setLoading(true);
    setError("");
    const retryPayload = { ...pendingConflict.payload, transferCode: true };
    setPendingConflict(null);
    await submitWithPayload(retryPayload);
  }

  function cancelTransfer() {
    setPendingConflict(null);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)] monitor-scrollbar"
      >
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Plus className="h-5 w-5 text-emerald-400" />
            {voucher ? "Gutschein einlösen" : "Ticket erstellen"}
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {voucher && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-100 text-xs space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <ScanLine className="h-3.5 w-3.5" />
                Gutschein {voucher.code}
              </p>
              <p className="text-amber-200/90">
                {voucher.ticketTypeName ?? voucher.serviceName ?? "Gutschein-Ticket"}
                {voucher.accessAreaName ? ` · ${voucher.accessAreaName}` : ""}
              </p>
              <p className="text-amber-300/70">
                Wird beim Erstellen automatisch eingelöst und mit dem neuen Ticket verknüpft.
              </p>
            </div>
          )}
          {/* Ticket-Typ steht ganz oben, ueber volle Breite und groesser
              gerendert: die Auswahl bestimmt, welche Datums-/Slot-Eingabe
              darunter erscheint und ist der haeufigste Klick im Workflow. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Ticket-Typ
            </label>
            {services.length > 0 ? (
              <select
                value={serviceId}
                onChange={(e) => {
                  const newId = e.target.value;
                  setServiceId(newId);
                  // Beim Wechsel des Service-Typs erst leeren, damit kein
                  // Wert aus dem vorherigen Mode (z.B. datetime-local von
                  // einem Kurs) als reines Datum stehen bleibt.
                  setStartDate("");
                  setEndDate("");
                  setSlotDate("");
                  if (newId === "none") return;
                  const svc = services.find((s) => String(s.id) === newId);
                  if (!svc) return;
                  if (svc.areaIds?.length) setAccessAreaId(String(svc.areaIds[0]));
                  // Service-Defaults ins UI-Format uebernehmen, damit der
                  // User sieht, was beim Submit auto-gesetzt werden wuerde
                  // - und es bei Bedarf umstellen kann.
                  const isSlotService =
                    svc.defaultValidityType === "TIME_SLOT" || !!svc.hasAnnyLink;
                  if (isSlotService) {
                    const day = svc.defaultStartDate
                      ? toDateInput(svc.defaultStartDate)
                      : toDateInput(new Date());
                    const dayEnd = svc.defaultEndDate ? toDateInput(svc.defaultEndDate) : day;
                    // slotDate triggert den ANNY-Slot-Fetch. Wenn der Service
                    // gar keinen ANNY-Link hat, faellt die UI auf datetime-
                    // local zurueck und benutzt startDate/endDate direkt.
                    setSlotDate(day);
                    if (day && svc.defaultSlotStart) {
                      setStartDate(`${day}T${svc.defaultSlotStart.slice(0, 5)}`);
                    } else if (day) {
                      setStartDate(day);
                    }
                    if (dayEnd && svc.defaultSlotEnd) {
                      setEndDate(`${dayEnd}T${svc.defaultSlotEnd.slice(0, 5)}`);
                    } else if (dayEnd) {
                      setEndDate(dayEnd);
                    }
                  } else {
                    if (svc.defaultStartDate) setStartDate(toDateInput(svc.defaultStartDate));
                    if (svc.defaultEndDate) setEndDate(toDateInput(svc.defaultEndDate));
                  }
                }}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-2xl px-4 py-4 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
              >
                <option value="none">Kein Service</option>
                {services.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="z.B. Tageskarte"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-2xl px-4 py-4 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-slate-600"
              />
            )}
          </div>

          {/* Datums-Eingabe direkt unter Ticket-Typ:
              - Kurs (TIME_SLOT) -> Datum + Slot-Auswahl aus ANNY (Fallback: datetime-local)
              - sonst (DATE_RANGE / DURATION) -> nur ein Datum */}
          {dateMode === "datetime" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Datum
                </label>
                <input
                  type="date"
                  value={slotDate}
                  onChange={(e) => {
                    setSlotDate(e.target.value);
                    // Slot-Auswahl verwirft die aktuell gewaehlten Zeiten -
                    // sie passten zum alten Tag. User muss einen Slot neu
                    // waehlen (oder das Fallback nutzt unten den neuen Tag).
                    setStartDate("");
                    setEndDate("");
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-slate-600"
                />
              </div>

              {/* Slot-Picker: drei Zustaende
                  - Loading: Spinner
                  - ANNY hat Slots: Button-Grid (Klick setzt startDate/endDate)
                  - kein ANNY-Link / keine Slots: datetime-local-Fallback */}
              {slotsLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Slots werden geladen…
                </div>
              ) : hasAnnyLink && slots.length > 0 ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Slot wählen
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {slots.map((s) => {
                      const expectedStart = slotDate ? `${slotDate}T${s.startTime}` : "";
                      const isSelected =
                        !!expectedStart && startDate === expectedStart;
                      return (
                        <button
                          key={`${s.startTime}-${s.endTime}`}
                          type="button"
                          onClick={() => {
                            if (!slotDate) return;
                            setStartDate(`${slotDate}T${s.startTime}`);
                            setEndDate(`${slotDate}T${s.endTime}`);
                          }}
                          className={cn(
                            "px-3 py-2 rounded-xl border text-sm font-mono font-semibold tabular-nums transition-colors active:scale-95 flex flex-col items-center justify-center gap-0.5",
                            isSelected
                              ? "bg-emerald-600 border-emerald-500 text-white"
                              : "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600",
                          )}
                        >
                          <span>{s.startTime}–{s.endTime}</span>
                          {typeof s.remaining === "number" && (
                            <span
                              className={cn(
                                "text-[10px] font-normal leading-tight",
                                isSelected
                                  ? "text-emerald-50"
                                  : s.remaining <= 0
                                    ? "text-rose-400"
                                    : s.remaining <= 2
                                      ? "text-amber-400"
                                      : "text-emerald-400",
                              )}
                            >
                              {s.remaining > 0 ? `${s.remaining} frei` : "voll"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  {hasAnnyLink && slotsLoaded && (
                    <div className="text-xs text-amber-400 px-1">
                      {slotsNote || "Keine ANNY-Slots an diesem Tag – manuelle Zeit eintragen."}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Start <span className="text-slate-600 font-normal">(optional)</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-slate-600"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Ende <span className="text-slate-600 font-normal">(optional)</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-slate-600"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                Datum <span className="text-slate-600 font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-slate-600"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">
                Vorname <span className="text-slate-600 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Max"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 placeholder:text-slate-600"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">
                Nachname <span className="text-slate-600 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Mustermann"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 placeholder:text-slate-600"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5" />
              Code <span className="text-slate-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="RFID / Barcode / QR"
              autoComplete="off"
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-slate-600"
            />
          </div>

          {pendingConflict && (
            <div className="bg-amber-950/80 border border-amber-600/60 rounded-xl p-4 text-sm text-amber-100 space-y-3">
              <div className="font-semibold text-amber-200">
                Bändchen bereits vergeben
              </div>
              <div className="text-amber-100/90">
                Der Code ist aktuell Ticket{" "}
                <span className="font-semibold">{pendingConflict.label}</span>
                {pendingConflict.type ? (
                  <span className="text-amber-200/80"> ({pendingConflict.type})</span>
                ) : null}{" "}
                zugeordnet. Bändchen auf das neue Ticket umhängen? Das alte Ticket
                verliert dann seinen Code.
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={cancelTransfer}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg border border-amber-500/50 text-amber-100 text-xs font-semibold hover:bg-amber-900/50 transition-colors disabled:opacity-50"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={confirmTransfer}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Bändchen umhängen"
                  )}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-rose-950 border border-rose-700/50 rounded-xl p-3 text-sm text-rose-200 whitespace-pre-line">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-3 rounded-xl border border-slate-700 text-slate-300 font-semibold text-sm hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading || pendingConflict !== null}
              className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors disabled:opacity-50 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
