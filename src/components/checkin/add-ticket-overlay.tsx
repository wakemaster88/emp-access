"use client";

/**
 * Overlay zum Anlegen eines Tickets im Check-in-Kiosk.
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { Clock, ScanLine, Loader2, X, CalendarDays, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ServiceData } from "./checkin-types";
import { annyReasonLabel } from "./checkin-utils";

export const ADD_EMPTY = {
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

export function toDateInput(val: string | Date | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}


/** Kurse bekommen die Slot-Maske; Stundenkarten nicht – auch nicht über ANNY. */
export function isCourseSlotService(svc: {
  name?: string;
  defaultValidityType?: string | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
}): boolean {
  if (svc.defaultValidityType === "TIME_SLOT") return true;
  if (svc.defaultSlotStart && svc.defaultSlotEnd) return true;
  return /kurs/i.test(svc.name ?? "");
}

export async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
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
export async function postTicketWithRetry(
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

export function AddTicketOverlay({
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
    serviceId?: number;
    slotDate?: string;
    slotStart?: string;
    slotEnd?: string;
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
  };
}) {
  const voucher = prefill?.voucher;
  const [firstName, setFirstName] = useState(prefill?.firstName ?? "");
  const [lastName, setLastName] = useState(prefill?.lastName ?? "");
  const [code, setCode] = useState(prefill?.rfidCode ?? "");
  // Service-Vorauswahl: erst voucher (alter Gutschein-Flow), dann
  // prefill.serviceId (neuer Slot-Auslastungs-Flow), sonst "none".
  const [serviceId, setServiceId] = useState(
    voucher?.serviceId != null
      ? String(voucher.serviceId)
      : prefill?.serviceId != null
        ? String(prefill.serviceId)
        : "none",
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
  // Wenn aus der Slot-Auslastung ein konkreter Slot uebergeben wurde,
  // setzen wir startDate/endDate direkt als "yyyy-mm-ddTHH:MM"-String -
  // gleiche Form wie der datetime-local-Input. Bei Day-Pass nur das
  // Datum als "yyyy-mm-dd" - das single-Mode-Input nimmt das auf.
  const [startDate, setStartDate] = useState(() => {
    if (prefill?.slotDate && prefill?.slotStart) {
      return `${prefill.slotDate}T${prefill.slotStart}`;
    }
    return prefill?.slotDate ?? "";
  });
  const [endDate, setEndDate] = useState(() => {
    if (prefill?.slotDate && prefill?.slotEnd) {
      return `${prefill.slotDate}T${prefill.slotEnd}`;
    }
    return "";
  });
  const [loading, setLoading] = useState(false);
  // Ref aufs Code/RFID-Input. Wenn prefill.focusRfid=true gesetzt war
  // (Klick aus der Slot-Auslastung), fokussieren wir beim Mount sofort
  // dort - der Mitarbeiter muss nur noch das Baendchen scannen.
  const codeInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (prefill?.focusRfid) {
      // requestAnimationFrame: das Overlay slidet rein, focus erst nach
      // erstem Paint setzen, sonst wird er bei manchen iOS-Versionen
      // verschluckt.
      requestAnimationFrame(() => {
        codeInputRef.current?.focus();
        codeInputRef.current?.select();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slot-Auswahl aus ANNY (nur bei TIME_SLOT-Services). `slotDate` haelt den
  // gewaehlten Tag im Slot-Picker; daraus wird beim Slot-Klick startDate /
  // endDate gesetzt. `slots` kommt aus /slots-Endpoint, `hasAnnyLink`
  // entscheidet, ob das Slot-Grid oder das datetime-local-Fallback gezeigt
  // wird.
  const [slotDate, setSlotDate] = useState(prefill?.slotDate ?? "");
  const [slots, setSlots] = useState<
    Array<{
      startTime: string;
      endTime: string;
      startIso: string;
      endIso: string;
      available?: boolean;
      capacity?: number;
      remaining?: number;
      unavailabilityType?: string;
    }>
  >([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsLoaded, setSlotsLoaded] = useState(false);
  const [hasAnnyLink, setHasAnnyLink] = useState(false);
  const [slotsNote, setSlotsNote] = useState<string>("");
  // ANNY-Service-Typ: "slot" = Slot-Picker (Anfaengerkurs, etc.),
  // "day" = Tagespass (Strandbad, etc. - kein Slot-Picker).
  const [slotServiceType, setSlotServiceType] = useState<"slot" | "day" | null>(null);

  // Effektiver Datums-Modus fuer die UI:
  //   * Kurse (Zeitslot, feste Kurszeit, Name „Kurs“) -> Slot-Maske
  //   * DURATION (Stundenkarte) -> nur Datum
  //   * sonst -> "single", ANNY-Kurse nach Bestätigung "slot"
  const dateMode: "single" | "datetime" = useMemo(() => {
    if (serviceId !== "none") {
      const svc = services.find((s) => String(s.id) === serviceId);
      if (svc && isCourseSlotService(svc)) return "datetime";
      // Stundenkarten nie in den Slot-Modus – auch nicht, solange ANNY
      // noch nicht geantwortet hat (sonst wird aus „1 Stunde“ ein Zeitslot).
      if (svc?.defaultValidityType === "DURATION") return "single";
      // Andere ANNY-Kurse ohne TIME_SLOT-Default: erst nach Bestätigung.
      if (svc?.hasAnnyLink && slotServiceType === "slot") return "datetime";
    }
    if (voucher?.validityType === "DURATION") return "single";
    if (voucher?.validityType === "TIME_SLOT") return "datetime";
    return "single";
  }, [serviceId, services, voucher, slotServiceType]);
  const [error, setError] = useState("");

  // Slots fuer (Service, slotDate) aus ANNY ziehen. Re-fetch bei Wechsel von
  // Service oder Datum. Bei dateMode != "datetime" deaktiviert (Tagestickets
  // brauchen keine Slot-Liste).
  useEffect(() => {
    if (serviceId === "none" || !slotDate) {
      setSlots([]);
      setSlotsLoaded(false);
      setHasAnnyLink(false);
      setSlotsNote("");
      setSlotServiceType(null);
      return;
    }
    // Wenn der Service KEINEN ANNY-Link hat (und kein TIME_SLOT ist), gar
    // nicht erst beim /slots-Endpoint nachfragen.
    const svc = services.find((s) => String(s.id) === serviceId);
    const wantsSlots =
      (svc != null && isCourseSlotService(svc))
      || (svc?.hasAnnyLink === true && svc?.defaultValidityType !== "DURATION");
    if (!wantsSlots) {
      setSlots([]);
      setSlotsLoaded(false);
      setHasAnnyLink(false);
      setSlotsNote("");
      setSlotServiceType(null);
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
      .then(
        (data: {
          slots?: typeof slots;
          hasAnnyLink?: boolean;
          note?: string;
          serviceType?: "slot" | "day";
          serviceInfo?: unknown;
        }) => {
          if (cancelled) return;
          setSlots(Array.isArray(data.slots) ? data.slots : []);
          setHasAnnyLink(Boolean(data.hasAnnyLink));
          setSlotsNote(typeof data.note === "string" ? data.note : "");
          setSlotServiceType(data.serviceType ?? null);
          setSlotsLoaded(true);
        },
      )
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
        setHasAnnyLink(false);
        setSlotsNote("");
        setSlotServiceType(null);
        setSlotsLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId, slotDate, token, services]);

  const [pendingConflict, setPendingConflict] = useState<{
    label: string;
    type: string | null;
    payload: Record<string, unknown>;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Slot-Pflicht: Bei Kursen mit ANNY-Slots MUSS ein konkreter Slot
    // gewaehlt sein, sonst landet die Buchung als Ganztags-Ticket ohne
    // Uhrzeit (slotStart/slotEnd leer) - dann fehlt im Monitor die Uhrzeit.
    // Erst wenn ein Slot geklickt wurde, traegt startDate eine Uhrzeit
    // ("yyyy-mm-ddTHH:mm"), aus der unten slotStart/slotEnd abgeleitet wird.
    if (
      dateMode === "datetime"
      && hasAnnyLink
      && slots.length > 0
      && !(startDate && startDate.includes("T"))
    ) {
      setError("Bitte einen Slot mit Uhrzeit wählen.");
      return;
    }

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
        // Kurszeit auch ohne TIME_SLOT-Validitaet uebernehmen: ein Ferienkurs
        // laeuft taeglich 10:00–12:00, das Ticket gilt aber als DATE_RANGE
        // ueber die ganze Kurswoche. Ohne slotStart/slotEnd steht so ein
        // manuell angelegter Teilnehmer im Monitor unter "Ohne feste Uhrzeit"
        // statt bei seiner Kursgruppe.
        if (payload.slotStart == null && svc.defaultSlotStart && svc.defaultSlotEnd) {
          payload.slotStart = svc.defaultSlotStart;
          payload.slotEnd = svc.defaultSlotEnd;
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
      // Stundenkarten (DURATION) bleiben DURATION, auch wenn ANNY-Slots
      // fuer die Kapazitaet gewaehlt wurden – sonst startet der Timer nie
      // und das Drehkreuz blockt die naechste Runde mit no_exit_registered.
      // Kurse ohne DURATION-Default werden zum TIME_SLOT (Anfaengerkurs
      // mit DATE_RANGE/NULL im Service).
      if (payload.validityType !== "DURATION") {
        payload.validityType = "TIME_SLOT";
      }
      if (startDate) {
        const sd = new Date(startDate);
        if (!isNaN(sd.getTime())) {
          payload.startDate = sd.toISOString();
          const t = startDate.split("T")[1];
          // DB-Schema/Validator erwarten exakt HH:MM (5 Zeichen).
          // datetime-local-Inputs oder Slot-Strings koennen je nach
          // Browser/Quelle auch "HH:MM:SS" liefern - die Sekunden
          // schneiden wir hier wieder ab.
          if (t) payload.slotStart = t.slice(0, 5);
        }
      }
      if (endDate) {
        const ed = new Date(endDate);
        if (!isNaN(ed.getTime())) {
          payload.endDate = ed.toISOString();
          const t = endDate.split("T")[1];
          if (t) payload.slotEnd = t.slice(0, 5);
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
    //
    // Wichtig: endDate darf nie vor startDate liegen. Frueher wurde bei
    // fehlendem endDate immer "heute" gesetzt – bei zukuenftigem startDate
    // (z.B. Ferienkurs-Woche) entstand ein invertierter Zeitraum und das
    // Ticket erschien im Monitor an keinem Tag.
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
    const endOfLocalDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    const isDuration = payload.validityType === "DURATION";
    if (!payload.startDate) {
      payload.startDate = dayStart.toISOString();
    }
    if (!payload.endDate && !isDuration) {
      const start = new Date(String(payload.startDate));
      payload.endDate = (
        !isNaN(start.getTime()) ? endOfLocalDay(start) : dayEnd
      ).toISOString();
    }
    if (payload.startDate && payload.endDate && !isDuration) {
      const start = new Date(String(payload.startDate));
      const end = new Date(String(payload.endDate));
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
        payload.endDate = endOfLocalDay(start).toISOString();
      }
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

        // ANNY-Overbooking: Server hat den Verkauf abgelehnt, weil der Slot
        // in ANNY ausgebucht/gesperrt ist. Klarer Hinweis + automatischer
        // Slot-Reload, damit der Mitarbeiter den aktuellen Stand sieht und
        // einen anderen Slot waehlen kann.
        if (
          res.status === 409
          && typeof errVal === "object"
          && errVal
          && errVal.code === "ANNY_SLOT_UNAVAILABLE"
        ) {
          // Slots fuer das aktuell gewaehlte Datum neu laden, damit das
          // Grid sich aktualisiert (anderer Mitarbeiter hat parallel
          // verkauft / ANNY hat den Slot gesperrt).
          if (slotDate && serviceId !== "none") {
            try {
              const r = await fetch(
                `/api/checkin/public/${token}/slots?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(slotDate)}`,
                { cache: "no-store" },
              );
              const fresh = await r.json();
              if (Array.isArray(fresh.slots)) setSlots(fresh.slots);
            } catch { /* refresh ist best-effort */ }
          }
          // Slot-Auswahl resetten, damit der Mitarbeiter aktiv neu klicken
          // muss - haendisch tippen oder versehentliches Re-Submit verhindern.
          setStartDate("");
          setEndDate("");
          setError(
            "Slot in ANNY ausgebucht – bitte einen anderen Slot wählen. Die Slot-Übersicht wurde gerade aktualisiert.",
          );
          setLoading(false);
          return;
        }

        const formErr = typeof errVal === "object" && errVal ? errVal.formErrors?.[0] : undefined;
        // Feld-Fehler MIT Feldnamen anzeigen - sonst sieht der Mitarbeiter
        // eine reine Regex-/Validierungsmeldung ohne Bezug zum Eingabefeld
        // (z.B. taucht ein "slotStart"-Regex-Fehler unter dem Code-Feld auf,
        // was sehr verwirrend ist).
        const fieldErrEntry =
          typeof errVal === "object" && errVal?.fieldErrors
            ? Object.entries(errVal.fieldErrors).find(
                ([, msgs]) => Array.isArray(msgs) && msgs.length > 0,
              )
            : undefined;
        const fieldErr = fieldErrEntry
          ? `${fieldErrEntry[0]}: ${(fieldErrEntry[1] as string[])[0]}`
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
                  // Hauptressource bevorzugt aus `Service.mainAccessAreaId`
                  // (explizit konfiguriert). Nur wenn das Feld leer ist, fallen
                  // wir auf die erste ServiceArea zurueck - dann ist das Ergebnis
                  // aber nicht-deterministisch und sollte vom Admin im
                  // Service-Editor gesetzt werden.
                  const mainId =
                    svc.mainAccessAreaId ?? svc.areaIds?.[0] ?? null;
                  if (mainId != null) setAccessAreaId(String(mainId));
                  // Service-Defaults ins UI-Format uebernehmen, damit der
                  // User sieht, was beim Submit auto-gesetzt werden wuerde
                  // - und es bei Bedarf umstellen kann.
                  const isSlotService =
                    isCourseSlotService(svc)
                    || (!!svc.hasAnnyLink && svc.defaultValidityType !== "DURATION");
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
                      // ANNY-Statuslogik:
                      //   * available === false           -> Slot komplett gesperrt (UI: disabled)
                      //   * remaining === 0 (oder <0)     -> ausgebucht (UI: disabled)
                      //   * sonst                         -> buchbar
                      const isBlocked = s.available === false;
                      const isFull =
                        !isBlocked &&
                        typeof s.remaining === "number" &&
                        s.remaining <= 0;
                      const isDisabled = isBlocked || isFull;
                      const remaining =
                        typeof s.remaining === "number" ? s.remaining : null;
                      const capacity =
                        typeof s.capacity === "number" ? s.capacity : null;
                      // Status-Label:
                      //   * "voll" wenn 0 verbleibend / gesperrt
                      //   * "X frei" wenn Kapazitaet unbekannt
                      //   * "X/Y frei" wenn beide bekannt und unterschiedlich
                      let statusLabel = "";
                      if (isBlocked) {
                        statusLabel = annyReasonLabel(s.unavailabilityType) || "voll";
                      } else if (isFull) {
                        statusLabel = "voll";
                      } else if (remaining != null && capacity != null && capacity !== remaining) {
                        statusLabel = `${remaining}/${capacity} frei`;
                      } else if (remaining != null) {
                        statusLabel = `${remaining} frei`;
                      } else if (capacity != null) {
                        statusLabel = `${capacity} frei`;
                      }
                      // Auslastungs-Prozent fuer den Mini-Bar (gefuellt = belegt).
                      // Nur sichtbar wenn beide Felder bekannt sind und es eine
                      // ehrliche Aussage erlaubt (capacity > 0). Bei isBlocked
                      // forcieren wir 100% (visuell komplett rot).
                      const fillPct =
                        isBlocked
                          ? 100
                          : capacity != null && capacity > 0 && remaining != null
                            ? Math.max(0, Math.min(100, ((capacity - remaining) / capacity) * 100))
                            : null;
                      const fillColor =
                        isDisabled
                          ? "bg-rose-500/70"
                          : fillPct != null && fillPct >= 80
                            ? "bg-amber-500/80"
                            : "bg-emerald-500/70";
                      return (
                        <button
                          key={`${s.startTime}-${s.endTime}`}
                          type="button"
                          disabled={isDisabled}
                          title={
                            isBlocked
                              ? `ANNY: ${s.unavailabilityType || "blockiert"}`
                              : undefined
                          }
                          onClick={() => {
                            if (!slotDate || isDisabled) return;
                            setStartDate(`${slotDate}T${s.startTime}`);
                            setEndDate(`${slotDate}T${s.endTime}`);
                          }}
                          className={cn(
                            "px-3 py-2 rounded-xl border text-sm font-mono font-semibold tabular-nums transition-colors flex flex-col items-center justify-center gap-1",
                            isDisabled
                              ? "bg-slate-900/60 border-slate-800 text-slate-500 cursor-not-allowed"
                              : isSelected
                                ? "bg-emerald-600 border-emerald-500 text-white active:scale-95"
                                : "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:border-slate-600 active:scale-95",
                          )}
                        >
                          <span>{s.startTime}–{s.endTime}</span>
                          {fillPct != null && (
                            <span
                              className={cn(
                                "block w-full h-1 rounded-full overflow-hidden",
                                isSelected ? "bg-emerald-700/60" : "bg-slate-700/60",
                              )}
                              aria-hidden
                            >
                              <span
                                className={cn("block h-full", fillColor)}
                                style={{ width: `${fillPct}%` }}
                              />
                            </span>
                          )}
                          {statusLabel && (
                            <span
                              className={cn(
                                "text-[10px] font-normal leading-tight",
                                isDisabled
                                  ? "text-rose-400/80"
                                  : isSelected
                                    ? "text-emerald-50"
                                    : remaining != null && capacity != null && remaining <= Math.max(1, Math.floor(capacity * 0.2))
                                      ? "text-amber-400"
                                      : "text-emerald-400",
                              )}
                            >
                              {statusLabel}
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
              ref={codeInputRef}
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
