"use client";

/** Poll-Takt des Check-in-Kiosks (12 s statt 8 s; Alarme laufen ueber einen eigenen, schnelleren Poll). */
const CHECKIN_POLL_MS = 12_000;

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { TailgateAlertPopup } from "@/components/checkin/tailgate-alert-popup";
import { CheckCircle2, Clock, ScanLine, Users, Ticket, CreditCard, Loader2, Search, X, RefreshCw, Plus, DoorOpen, Check, ChevronDown, Megaphone, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { LockerOverlay } from "@/components/checkin/locker-overlay";
import { LostItemsOverlay } from "@/components/checkin/lost-items-overlay";
import { BulkOverlay } from "@/components/checkin/bulk-overlay";
import { Lock, PackageSearch, Layers } from "lucide-react";
import { bundleAnnyTickets, type TicketBundle } from "@/lib/anny-ticket-bundle";
import { AddTicketOverlay } from "@/components/checkin/add-ticket-overlay";
import { printVoucher } from "@/components/checkin/checkin-print";
import type { BundlePart, CheckinData, CheckinTicket, EquipmentSetup, GuestInfoSummary, OpenableDevice, SlotOverviewData, SlotOverviewSlot } from "@/components/checkin/checkin-types";
import { DaySelector, GuestInfoSummaryPanel, LiveClock, RentalOverviewPanel, Section } from "@/components/checkin/checkin-ui";
import { classifyInfoLabel, compareSetups, isYes, toDateStr } from "@/components/checkin/checkin-utils";
import { CameraOverlay, ScanOverlay } from "@/components/checkin/scan-overlay";
import { SlotOverviewSection } from "@/components/checkin/slot-overview";
import { TicketCard } from "@/components/checkin/ticket-card";
import { TicketOverlay } from "@/components/checkin/ticket-overlay";

export default function CheckinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  // Bildschirm wach halten, solange die Seite sichtbar ist.
  useWakeLock(true);
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
  const [editMode, setEditMode] = useState<"photo" | "rfid" | "dates" | "person" | "slot" | "notes" | "pause" | "guestInfo" | null>(null);
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
  const [lostItemsOverlayOpen, setLostItemsOverlayOpen] = useState(false);
  const [bulkOverlayOpen, setBulkOverlayOpen] = useState(false);
  const [addTicketPrefill, setAddTicketPrefill] = useState<{
    firstName?: string;
    lastName?: string;
    rfidCode?: string;
    profileImage?: string | null;
    /** Service vorbelegen (z.B. Klick aus Slot-Auslastung). */
    serviceId?: number;
    /** Slot-Tag YYYY-MM-DD (fuer Service mit Slot-Picker / Tageskarte). */
    slotDate?: string;
    /** Slot-Zeit HH:MM (nur Slot-Services). */
    slotStart?: string;
    /** Slot-Endzeit HH:MM (nur Slot-Services). */
    slotEnd?: string;
    /** Beim Mount auf das RFID/Code-Feld fokussieren. */
    focusRfid?: boolean;
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

  // Slot-Auslastung des Tages (ANNY-verknuepfte Services). Wird parallel
  // zum Haupt-Dashboard alle 30s gepollt - ANNY-Calls sind zu teuer fuer
  // den normalen 3s-Tick.
  const [slotOverview, setSlotOverview] = useState<SlotOverviewData | null>(null);
  // Slot der gerade gesperrt/entsperrt wird ("serviceId|HH:mm"), fuer Spinner.
  const [blockBusyKey, setBlockBusyKey] = useState<string | null>(null);

  const refreshOverview = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/checkin/public/${token}/slot-overview?date=${encodeURIComponent(date)}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const json = (await r.json()) as SlotOverviewData;
      setSlotOverview(json);
    } catch { /* swallow */ }
  }, [token, date]);

  const handleBlockSlot = useCallback(
    async (serviceId: number, slot: SlotOverviewSlot) => {
      const key = `${serviceId}|${slot.startTime.slice(0, 5)}`;
      if (blockBusyKey) return;
      if (
        !window.confirm(
          `Slot ${slot.startTime}–${slot.endTime} sperren?\n\nDie freie Kapazität wird auch in ANNY belegt, sodass dort niemand mehr buchen kann.`,
        )
      ) {
        return;
      }
      setBlockBusyKey(key);
      try {
        const res = await fetch(`/api/checkin/public/${token}/slot-block`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceId,
            date,
            slotStart: slot.startTime,
            slotEnd: slot.endTime,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          window.alert(typeof data?.error === "string" ? data.error : "Sperren fehlgeschlagen.");
        }
      } catch {
        window.alert("Netzwerkfehler beim Sperren.");
      } finally {
        setBlockBusyKey(null);
        await refreshOverview();
      }
    },
    [token, date, blockBusyKey, refreshOverview],
  );

  const handleUnblockSlot = useCallback(
    async (blockId: number, busyKey: string) => {
      if (blockBusyKey) return;
      if (!window.confirm("Sperre aufheben und ANNY-Buchung stornieren?")) return;
      setBlockBusyKey(busyKey);
      try {
        const res = await fetch(`/api/checkin/public/${token}/slot-block`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blockId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          window.alert(typeof data?.error === "string" ? data.error : "Aufheben fehlgeschlagen.");
        }
      } catch {
        window.alert("Netzwerkfehler beim Aufheben.");
      } finally {
        setBlockBusyKey(null);
        await refreshOverview();
      }
    },
    [token, blockBusyKey, refreshOverview],
  );

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
    let interval: ReturnType<typeof setInterval> | null = setInterval(doFetch, CHECKIN_POLL_MS);

    const handleVisibility = () => {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else if (!interval) {
        doFetch();
        interval = setInterval(doFetch, CHECKIN_POLL_MS);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [token, date]);

  // Slot-Overview-Polling (ANNY-Auslastung). Eigenes Intervall, weil ANNY-
  // Calls ~1-2s teuer sind und nicht jeden 8s-Tick antriggern sollen.
  // 60s + Visibility-Change reicht voellig fuer Auslastungsanzeige.
  useEffect(() => {
    refreshOverview();
    let interval: ReturnType<typeof setInterval> | null = setInterval(refreshOverview, 60000);
    const handleVis = () => {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else if (!interval) {
        refreshOverview();
        interval = setInterval(refreshOverview, 60000);
      }
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVis);
    };
  }, [refreshOverview]);

  const handleScanRef = useRef<((code: string) => void) | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Waehrend der Serien-Erstellung gehoeren alle Scans dem Overlay. Ohne
      // diese Sperre wuerde ein Baendchen, das gescannt wird waehrend der
      // Fokus gerade nicht im Scanfeld liegt, hier als Ticket-Suche landen.
      if (bulkOverlayOpen) return;

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
  }, [bulkOverlayOpen]);

  /** Alle Nicht-Abo-Tickets des Tages, zu Gaesten gebuendelt. Kombi-Services
   *  (z.B. Aquapark Tageskarte = Aquapark + Strandbad) erzeugen in ANNY eine
   *  Buchung je Ressource, also mehrere Tickets fuer denselben Gast. */
  const dayBundles = useMemo(
    () => bundleAnnyTickets((data?.tickets ?? []).filter((t) => !t.subscriptionId)),
    [data?.tickets],
  );

  /** Teilbuchungen je Ticket-ID. Ein Kombi-Ticket wird als eine Karte
   *  angezeigt und muss deshalb auch gemeinsam eingecheckt werden - sonst
   *  bliebe die zweite Buchung offen und der Gast taucht am naechsten Poll
   *  wieder als ausstehend auf. */
  const bundleByTicketId = useMemo(() => {
    const map = new Map<number, CheckinTicket[]>();
    for (const bundle of dayBundles) {
      if (bundle.members.length < 2) continue;
      for (const m of bundle.members) map.set(m.id, bundle.members);
    }
    return map;
  }, [dayBundles]);

  /** Bereichsnamen je ANNY-Resource. Eine Resource-ID kann auf mehrere
   *  Bereiche zeigen (historisch gepflegte Links), daher alle Kandidaten. */
  const areasByResource = useMemo(() => {
    const nameById = new Map<number, string>();
    for (const a of data?.areas ?? []) nameById.set(a.id, a.name);
    const map = new Map<string, Array<{ areaId: number; name: string }>>();
    for (const link of data?.annyResourceAreas ?? []) {
      const name = nameById.get(link.areaId);
      if (!name) continue;
      const arr = map.get(link.resourceId) ?? [];
      if (!arr.some((x) => x.areaId === link.areaId)) arr.push({ areaId: link.areaId, name });
      map.set(link.resourceId, arr);
    }
    return map;
  }, [data?.annyResourceAreas, data?.areas]);

  const areaIdsByService = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const s of data?.services ?? []) map.set(s.id, s.areaIds ?? []);
    return map;
  }, [data?.services]);

  /** Loest die ANNY-Resource eines Teiltickets in einen Bereichsnamen auf.
   *  Bei mehrdeutiger Resource gewinnt der Bereich, der auch zum Service des
   *  Tickets gehoert. */
  const resolveResourceArea = useCallback(
    (t: CheckinTicket): string | null => {
      if (!t.annyResourceId) return null;
      const candidates = areasByResource.get(t.annyResourceId) ?? [];
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0].name;
      const allowed = t.serviceId != null ? areaIdsByService.get(t.serviceId) ?? [] : [];
      return (candidates.find((c) => allowed.includes(c.areaId)) ?? candidates[0]).name;
    },
    [areasByResource, areaIdsByService],
  );

  /** Teiltickets des gerade geoeffneten Gastes, mit aufgeloestem Bereich.
   *  Leer bei Einzeltickets - dann zeigt das Overlay keine Kombi-Sektion. */
  const selectedBundleParts = useMemo<BundlePart[]>(() => {
    if (!selectedTicket) return [];
    const members = bundleByTicketId.get(selectedTicket.id);
    if (!members || members.length < 2) return [];
    return members.map((m) => ({
      ticket: m,
      areaName: resolveResourceArea(m) ?? m.accessArea?.name ?? "Unbekannter Bereich",
    }));
  }, [selectedTicket, bundleByTicketId, resolveResourceArea]);

  const handleCheckin = useCallback(async (ticketId: number) => {
    const ticketIds = bundleByTicketId.get(ticketId)?.map((m) => m.id) ?? [ticketId];
    setCheckingIn(ticketId);
    try {
      let ok = false;
      let failure: string | null = null;
      // Sequentiell, damit die Scan-Eintraege eine nachvollziehbare
      // Reihenfolge behalten und wir bei Teilfehlern trotzdem so viele
      // Buchungen wie moeglich einchecken.
      for (const id of ticketIds) {
        const res = await fetch(`/api/checkin/public/${token}/checkin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: id }),
        });
        const json = await res.json();
        if (json.success) ok = true;
        else if (json.message && !failure) failure = json.message;
      }
      if (ok) {
        refreshRef.current?.();
        if (selectedTicket && ticketIds.includes(selectedTicket.id)) {
          setSelectedTicket((prev) => prev
            ? {
                ...prev,
                checkedIn: true,
                // Abos und Vereinsmitglieder bleiben VALID (tagesbezogener
                // Check-in), nur echte Einzeltickets werden REDEEMED.
                ...(prev.subscriptionId || prev.vereinId ? {} : { status: "REDEEMED" as const }),
              }
            : null);
        }
      }
      if (failure) alert(failure);
    } finally {
      setCheckingIn(null);
    }
  }, [token, selectedTicket, bundleByTicketId]);

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
      slotStart?: string | null;
      slotEnd?: string | null;
      notes?: string | null;
      guestInfo?: Record<string, string> | null;
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

      // Spezialfall: Slot-Wechsel scheitert an ANNY (Slot voll, ANNY
      // verbietet Edit etc.). Backend liefert 4xx/5xx mit
      // { error, annyStatus, partial:false }. Wir blenden eine kurze
      // Meldung ein und brechen ab - der lokale Stand wurde wegen
      // partial:false NICHT veraendert.
      if (!res.ok && (update.slotStart !== undefined || update.slotEnd !== undefined) && json?.error) {
        if (typeof window !== "undefined") {
          alert(json.error);
        }
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
        if (update.slotStart !== undefined) patch.slotStart = json.ticket?.slotStart ?? update.slotStart;
        if (update.slotEnd !== undefined) patch.slotEnd = json.ticket?.slotEnd ?? update.slotEnd;
        if (update.notes !== undefined) patch.notes = json.ticket?.notes ?? update.notes;
        if (update.guestInfo !== undefined) patch.guestInfo = json.ticket?.guestInfo ?? update.guestInfo;
        if (json.ticket?.startDate !== undefined && update.slotStart !== undefined) patch.startDate = json.ticket.startDate;
        if (json.ticket?.endDate !== undefined && update.slotEnd !== undefined) patch.endDate = json.ticket.endDate;
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

  /** Pause/Resume eines einzelnen Tickets. Bei `pause` werden die Dauer
   *  ("1h"/"1d"/"1w"/"1m"/"unbegrenzt") und optionale Begruendung mitgeschickt.
   *  Beim Erfolg wird das selectedTicket lokal sofort aktualisiert, damit der
   *  Status-Badge ohne Refresh umschaltet; der Hintergrund-Refresh sorgt fuer
   *  konsistente Werte. */
  const handlePauseTicket = useCallback(
    async (
      ticketId: number,
      action: "pause" | "resume",
      opts?: { duration?: string; reason?: string },
    ) => {
      setUpdatingTicket(ticketId);
      try {
        const res = await fetch(`/api/checkin/public/${token}/pause`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId, action, ...opts }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (typeof window !== "undefined" && json?.error) alert(json.error);
          return;
        }
        const newStatus = action === "pause" ? "PAUSED" : (json.ticket?.status ?? "VALID");
        const newFirstScan = json.ticket?.firstScanAt ?? undefined;
        refreshRef.current?.();
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket((prev) =>
            prev
              ? {
                  ...prev,
                  status: newStatus,
                  ...(newFirstScan !== undefined ? { firstScanAt: newFirstScan } : {}),
                }
              : null,
          );
        }
      } finally {
        setUpdatingTicket(null);
      }
    },
    [token, selectedTicket],
  );

  const dayTickets = data?.tickets ?? [];
  const subscriptions = data?.subscriptions ?? [];

  // Erst buendeln, dann einsortieren: ein Kombi-Ticket besteht aus mehreren
  // ANNY-Buchungen desselben Gastes. Wuerde erst einsortiert und dann je
  // Liste geb\u00fcndelt, landete ein Gast mit nur teilweise eingecheckten
  // Buchungen gleichzeitig unter „Ausstehend“ und „Eingecheckt“.
  const { upcomingBundles, checkedInBundles, pendingBundles } = useMemo(() => {
    const now = new Date();
    const berlinStr = now.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    const [ch, cm] = berlinStr.split(":").map(Number);
    const nowMin = ch * 60 + cm;

    const upcoming: TicketBundle<CheckinTicket>[] = [];
    const checked: TicketBundle<CheckinTicket>[] = [];
    const pending: TicketBundle<CheckinTicket>[] = [];

    for (const bundle of dayBundles) {
      // Vereinsmitglieder (vereinId) sind Jahres-Mitgliedschaften: „eingecheckt“
      // ist tagesbezogen über das API-Flag checkedIn, NICHT über dauerhaftes
      // REDEEMED – sonst stuenden sie an jedem Tag in der Eingecheckt-Liste.
      // Beim Kombi-Ticket genuegt eine eingecheckte Teilbuchung: der Gast ist
      // dann bereits am Drehkreuz der Hauptressource durch.
      if (bundle.members.some((m) => m.checkedIn || (m.status === "REDEEMED" && !m.vereinId))) {
        checked.push(bundle);
        continue;
      }
      const slotStart = bundle.primary.slotStart;
      if (slotStart) {
        const [sh, sm] = slotStart.split(":").map(Number);
        const slotMin = sh * 60 + sm;
        if (slotMin >= nowMin && slotMin <= nowMin + 60) {
          upcoming.push(bundle);
          continue;
        }
      }
      pending.push(bundle);
    }

    upcoming.sort((a, b) => (a.primary.slotStart ?? "").localeCompare(b.primary.slotStart ?? ""));
    return { upcomingBundles: upcoming, checkedInBundles: checked, pendingBundles: pending };
  }, [dayBundles]);

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

  const allCheckedIn = useMemo(
    () => [
      ...checkedInBundles,
      // Abo-Tickets sind nie Teil einer Kombi-Buchung und bleiben einzeln.
      ...checkedInAbos.map((t) => ({ primary: t, members: [t] })),
    ],
    [checkedInBundles, checkedInAbos],
  );

  const matchesSearch = useCallback((t: CheckinTicket) => {
    if (!searchQuery.trim()) return true;
    // Suche unempfindlich gegen Gross/Klein, Umlaute/Akzente und ß: ANNY liefert
    // Namen z.B. als "Schmeiss" (ohne ß), Personal sucht aber nach "Schmeiß".
    // ß -> ss, dann NFD + Kombinations-Zeichen entfernen (ü->u, é->e, ...).
    const norm = (s: string) =>
      s.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const q = norm(searchQuery);
    return (
      (t.firstName ? norm(t.firstName).includes(q) : false) ||
      (t.lastName ? norm(t.lastName).includes(q) : false) ||
      norm(t.name).includes(q) ||
      (t.ticketTypeName ? norm(t.ticketTypeName).includes(q) : false) ||
      (t.rfidCode ? norm(t.rfidCode).includes(q) : false) ||
      (t.barcode ? norm(t.barcode).includes(q) : false)
    );
  }, [searchQuery]);

  // Ein Bundle bleibt sichtbar, sobald IRGENDEINE seiner Teilbuchungen passt -
  // die Barcodes der Teilbuchungen unterscheiden sich, eine Suche nach dem
  // Code der zweiten Buchung soll den Gast trotzdem finden.
  const matchesBundle = useCallback(
    (b: TicketBundle<CheckinTicket>) => b.members.some(matchesSearch),
    [matchesSearch],
  );

  const filteredUpcoming = useMemo(() => upcomingBundles.filter(matchesBundle), [upcomingBundles, matchesBundle]);
  const filteredCheckedIn = useMemo(() => allCheckedIn.filter(matchesBundle), [allCheckedIn, matchesBundle]);
  const filteredPending = useMemo(() => pendingBundles.filter(matchesBundle), [pendingBundles, matchesBundle]);

  const filteredSubscriptions = useMemo(() => {
    return subscriptions.map((s) => ({
      ...s,
      tickets: s.tickets.filter(matchesSearch),
    })).filter((s) => s.tickets.length > 0);
  }, [subscriptions, matchesSearch]);

  // Reguläre Service-/Tickettyp-Gruppen (alle ohne Vereins-Zugehoerigkeit) –
  // werden ganz oben in der Tickets-Sektion gerendert wie gewohnt. Innerhalb
  // einer Gruppe nach (slotStart, Nachname/Name) sortieren, damit Kurse mit
  // mehreren Slots (z.B. Anfaengerkurs 12-13 / 16-17) sauber gruppiert
  // angezeigt werden statt in Erstellungs-Reihenfolge zu liegen.
  const serviceGroups = useMemo(() => {
    const groups = new Map<string, TicketBundle<CheckinTicket>[]>();
    for (const b of filteredPending) {
      if (b.primary.vereinId != null) continue;
      const t = b.primary;
      const key = t.service?.name ?? t.subscription?.name ?? t.ticketTypeName ?? "Sonstige";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(b);
    }
    for (const bundles of groups.values()) {
      bundles.sort((x, y) => {
        const a = x.primary;
        const b = y.primary;
        // Tickets ohne Slot ans Ende (Tageskarten o.ae.), damit Slot-Tickets
        // oben blockweise stehen.
        const slotCmp = (a.slotStart ?? "~").localeCompare(b.slotStart ?? "~");
        if (slotCmp !== 0) return slotCmp;
        const aN = (a.lastName ?? a.name).toLowerCase();
        const bN = (b.lastName ?? b.name).toLowerCase();
        return aN.localeCompare(bN);
      });
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
    for (const b of filteredPending) {
      const t = b.primary;
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

  // Equipment-Übersicht pro Service-Gruppe: aggregiert die Gaeste-Infos aus
  // den Info-Anfragen über ALLE Tickets des Tages (auch bereits eingecheckte),
  // damit die Material-Vorbereitung stabil bleibt, während nach und nach
  // eingecheckt wird. Sport, Level und Schuhgroesse werden PRO TEILNEHMER
  // kombiniert ("Wakeboard · Anfänger · Gr. 38 ×2"), weil erst die
  // Kombination sagt, welches Board vorbereitet werden muss. Neopren wird
  // nur gezaehlt, wenn tatsaechlich ein Anzug geliehen wird.
  const guestInfoSummaries = useMemo(() => {
    const byGroup = new Map<string, GuestInfoSummary>();
    const setupMaps = new Map<string, Map<string, EquipmentSetup>>();
    for (const bundle of dayBundles) {
      const t = bundle.primary;
      if (t.subscriptionId || t.vereinId != null) continue;
      const key = t.service?.name ?? t.subscription?.name ?? t.ticketTypeName ?? "Sonstige";
      let summary = byGroup.get(key);
      if (!summary) {
        summary = { answered: 0, total: 0, setups: [], neopren: new Map(), labels: new Map(), tickets: [] };
        byGroup.set(key, summary);
        setupMaps.set(key, new Map());
      }
      summary.total++;
      summary.tickets.push(t);
      // Die Infos haengen je nach Buchungsweg an irgendeiner Teilbuchung des
      // Gastes - erste gefuellte gewinnt.
      const info = bundle.members.find(
        (m) => m.guestInfo && Object.keys(m.guestInfo).length > 0,
      )?.guestInfo;
      if (!info || Object.keys(info).length === 0) continue;
      summary.answered++;

      let sport: string | null = null;
      let level: string | null = null;
      let shoe: string | null = null;
      let neoprenFlag: string | null = null;
      let neoprenSize: string | null = null;

      for (const [label, value] of Object.entries(info)) {
        if (!value) continue;
        switch (classifyInfoLabel(label)) {
          case "name":
            // Teilnehmername ist individuell und nicht aggregierbar.
            break;
          case "sport":
            sport = value;
            break;
          case "level":
            level = value;
            break;
          case "shoe":
            shoe = value;
            break;
          case "neoprenFlag":
            neoprenFlag = value;
            break;
          case "neoprenSize":
            neoprenSize = value;
            break;
          default: {
            let values = summary.labels.get(label);
            if (!values) {
              values = new Map();
              summary.labels.set(label, values);
            }
            values.set(value, (values.get(value) ?? 0) + 1);
          }
        }
      }

      // Board-Setup: Sport + Level + Schuhgroesse als EIN Eintrag zaehlen.
      if (sport || level || shoe) {
        const setups = setupMaps.get(key)!;
        const setupKey = `${sport ?? ""}|${level ?? ""}|${shoe ?? ""}`;
        const existing = setups.get(setupKey);
        if (existing) existing.count++;
        else setups.set(setupKey, { sport, level, shoe, count: 1 });
      }

      // Neopren: nur zaehlen wenn geliehen wird (bzw. eine Groesse angegeben
      // ist, ohne dass explizit "Nein" gewaehlt wurde).
      if ((neoprenFlag && isYes(neoprenFlag)) || (neoprenSize && !neoprenFlag)) {
        const sizeKey = neoprenSize ?? "Größe offen";
        summary.neopren.set(sizeKey, (summary.neopren.get(sizeKey) ?? 0) + 1);
      }
    }
    for (const [key, summary] of byGroup) {
      summary.setups = [...setupMaps.get(key)!.values()].sort(compareSetups);
    }
    return byGroup;
  }, [dayBundles]);

  if (error) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 text-white flex items-center justify-center">
        <p className="text-rose-400 text-lg">{error}</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white flex flex-col kiosk-surface">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-2.5 flex items-center justify-between gap-3 safe-top">
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <img src="/logo-dark.png" alt="EMP Access" className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight leading-tight truncate">
              {data?.monitorName ?? "Check-in"}
            </h1>
            <p className="text-[11px] text-slate-400 whitespace-nowrap leading-tight">
              EMP Access · Check-in Monitor
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
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
                    "flex items-center gap-2 px-3 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95 disabled:opacity-60 whitespace-nowrap",
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
                  <span className="hidden 2xl:inline max-w-[12rem] truncate">{d.name}</span>
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
                    title={`${items.length} weitere Türen öffnen`}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95 whitespace-nowrap",
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
                    <span>{label}</span>
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
          {/* Vertikaler Divider zwischen Tueren-Cluster und Aktions-Cluster,
              damit der User die Funktion auf einen Blick trennt. */}
          <span className="hidden md:block h-7 w-px bg-slate-700/60 mx-0.5" aria-hidden />
          <button
            onClick={() => { setAddTicketPrefill(undefined); setAddTicketOpen(true); }}
            title="Neues Ticket anlegen"
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <Plus className="h-5 w-5 shrink-0" />
            <span className="hidden xl:inline">Ticket</span>
          </button>
          <button
            onClick={() => setBulkOverlayOpen(true)}
            title="Mehrere Tickets oder Bändchen auf einmal anlegen"
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-3 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <Layers className="h-5 w-5 shrink-0" />
            <span className="hidden xl:inline">Serie</span>
          </button>
          <button
            onClick={() => { setAnnouncementError(null); setAnnouncementOpen(true); }}
            title="Hinweis an die Live-Monitore schicken"
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95",
              announcementSentAt
                ? "bg-emerald-600 text-white"
                : "bg-amber-600 hover:bg-amber-500 text-white",
            )}
          >
            {announcementSentAt ? <Check className="h-5 w-5 shrink-0" /> : <Megaphone className="h-5 w-5 shrink-0" />}
            <span className="hidden xl:inline">
              {announcementSentAt ? "Gesendet" : "Hinweis"}
            </span>
          </button>
          <button
            onClick={() => setLockerOverlayOpen(true)}
            title="Schließfächer verwalten"
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-3 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <Lock className="h-5 w-5 shrink-0" />
            <span className="hidden xl:inline">Schließfächer</span>
          </button>
          <button
            onClick={() => setLostItemsOverlayOpen(true)}
            title="Fundsachen verwalten"
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <PackageSearch className="h-5 w-5 shrink-0" />
            <span className="hidden xl:inline">Fundsachen</span>
          </button>
          <button
            onClick={() => setScanMode(true)}
            title="Scan-Modus aktivieren"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-xl font-semibold text-sm transition-colors active:scale-95"
          >
            <ScanLine className="h-5 w-5 shrink-0" />
            <span className="hidden xl:inline">Scannen</span>
          </button>
          <span className="hidden md:block h-7 w-px bg-slate-700/60 mx-0.5" aria-hidden />
          <LiveClock />
          <button
            onClick={() => { setRefreshing(true); refreshRef.current?.(); setTimeout(() => setRefreshing(false), 800); }}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors active:scale-95"
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

        {/* Zugebuchtes Verleihmaterial des Tages (aus ANNY). */}
        <RentalOverviewPanel tickets={dayTickets} />

        {/* Slot-Auslastung (ANNY-verknuepfte Services). Wird nur gerendert,
            wenn mindestens ein Service auch tatsaechlich Slots hat - sonst
            ist die Section leer und stoerend. */}
        {slotOverview && slotOverview.services.some((sv) => sv.slots.length > 0 || sv.totalEmpBookings > 0) && (
          <SlotOverviewSection
            data={slotOverview}
            currentDate={date}
            onBlockSlot={handleBlockSlot}
            onUnblockSlot={handleUnblockSlot}
            blockBusyKey={blockBusyKey}
            onPick={(p) => {
              // Klick auf Service/Slot in der Auslastung -> Ticket-Erstellen-
              // Overlay direkt mit Service vorbelegt aufmachen und ins
              // RFID-Feld springen (Standard-Workflow: Bändchen scannen).
              setAddTicketPrefill({
                serviceId: p.serviceId,
                slotDate: p.slotDate,
                slotStart: p.slotStart,
                slotEnd: p.slotEnd,
                focusRfid: true,
              });
              setAddTicketOpen(true);
            }}
          />
        )}

        {/* Upcoming */}
        {filteredUpcoming.length > 0 && (
          <Section title="Nächste Gäste" icon={Clock} count={filteredUpcoming.length} color="amber">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredUpcoming.map(({ primary: t, members }) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  bundleSize={members.length}
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
              {[...serviceGroups.entries()].map(([groupName, bundles]) => {
                // Leere Gruppen werden ohnehin durch das filteredPending-
                // Verfahren rausgefiltert; defensiv noch ein expliziter Skip
                // damit kein Header ohne Inhalt erscheint.
                if (bundles.length === 0) return null;
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
                        {bundles.length}
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
                        {(() => {
                          const summary = guestInfoSummaries.get(groupName);
                          return summary ? (
                            <GuestInfoSummaryPanel
                              summary={summary}
                              groupName={groupName}
                              dateStr={date}
                              accountName={data?.accountName ?? ""}
                            />
                          ) : null;
                        })()}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {bundles.map(({ primary: t, members }) => (
                            <TicketCard
                              key={t.id}
                              ticket={t}
                              bundleSize={members.length}
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
              {filteredCheckedIn.map(({ primary: t, members }) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  bundleSize={members.length}
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
          onSaveSlot={(slotStart, slotEnd) => handleUpdateTicket(selectedTicket.id, { slotStart, slotEnd })}
          availableSlots={
            selectedTicket.serviceId != null
              ? slotOverview?.services.find((sv) => sv.serviceId === selectedTicket.serviceId)?.slots ?? []
              : []
          }
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
          onSaveNotes={(notes) => handleUpdateTicket(selectedTicket.id, { notes })}
          onSaveGuestInfo={(guestInfo) => handleUpdateTicket(selectedTicket.id, { guestInfo })}
          onPause={(duration, reason) =>
            handlePauseTicket(selectedTicket.id, "pause", { duration, reason })
          }
          onResume={() => handlePauseTicket(selectedTicket.id, "resume")}
          bundleParts={selectedBundleParts}
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

      {/* Fundsachen overlay */}
      {lostItemsOverlayOpen && (
        <LostItemsOverlay
          token={token}
          onClose={() => setLostItemsOverlayOpen(false)}
        />
      )}

      {/* Serien-Erstellung: Bons und RFID-Bändchen */}
      {bulkOverlayOpen && (
        <BulkOverlay
          token={token}
          accountName={data?.accountName ?? ""}
          areas={data?.areas ?? []}
          services={data?.services ?? []}
          subscriptions={data?.allSubscriptions ?? []}
          onClose={() => setBulkOverlayOpen(false)}
          onCreated={() => { refreshRef.current?.(); }}
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

      {/* Warnung vom Drehkreuz: jemand ohne gueltigen Scan durchgegangen */}
      <TailgateAlertPopup token={token} />
    </div>
  );
}

/* ──── Sub-components ──── */
