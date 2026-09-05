"use client";

/**
 * Ticket-Detail-Overlay des Check-in-Kiosks (Ansehen, Bearbeiten, Drucken).
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { useEffect, useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, ScanLine, Users, Camera, Loader2, X, Package, Fingerprint, Pencil, Printer, TicketX, Plus, StickyNote, Pause, Play, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { PackageSearch, Layers } from "lucide-react";
import { printTicket } from "./checkin-print";
import type { BundlePart, CheckinTicket, ScanEntry, SlotOverviewSlot, TicketAddOn, TicketExtra } from "./checkin-types";
import { InfoRow, RfidInput } from "./checkin-ui";
import { calcAge, formatTicketTimeLabel, isRentalAddOn, personName } from "./checkin-utils";

export function TicketOverlay({
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
  onSaveSlot,
  availableSlots,
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
  onSaveNotes,
  onSaveGuestInfo,
  onPause,
  onResume,
  bundleParts,
}: {
  ticket: CheckinTicket;
  onClose: () => void;
  onCheckin: () => void;
  checkingIn: boolean;
  editMode: "photo" | "rfid" | "dates" | "person" | "slot" | "notes" | "pause" | "guestInfo" | null;
  setEditMode: (m: "photo" | "rfid" | "dates" | "person" | "slot" | "notes" | "pause" | "guestInfo" | null) => void;
  onSaveDates: (startDate: string | null, endDate: string | null) => void;
  onSavePerson: (person: { firstName: string | null; lastName: string | null; birthDate: string | null }) => void;
  onSaveSlot: (slotStart: string | null, slotEnd: string | null) => void;
  availableSlots: SlotOverviewSlot[];
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
  onSaveNotes: (notes: string | null) => void;
  onSaveGuestInfo: (info: Record<string, string> | null) => void;
  onPause: (duration: string, reason: string) => void;
  onResume: () => void;
  /** Teiltickets eines Kombi-Tickets. Leer bei normalen Einzeltickets. */
  bundleParts: BundlePart[];
}) {
  const extras = (ticket.extras ?? []) as TicketExtra[];
  const addOns = (ticket.addOns ?? []) as TicketAddOn[];
  const isSub = !!ticket.subscriptionId;
  // Vereinsmitglieder (vereinId) wie Abos behandeln: tagesbezogener Check-in
  // über das checkedIn-Flag, nicht über dauerhaftes REDEEMED.
  const isRecurring = isSub || !!ticket.vereinId;
  const isChecked = isRecurring ? ticket.checkedIn : (ticket.checkedIn || ticket.status === "REDEEMED");

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

  // Notiz- und Pause-Eingabe: initial mit dem aktuellen Ticket-Stand
  // befuellt. Beim Oeffnen des Editors (Button-Klick) wird der State
  // explizit auf den aktuellen Wert zurueckgesetzt, sodass ein Speichern
  // -> Wieder-Oeffnen den frischen Server-Stand anzeigt.
  const [noteInput, setNoteInput] = useState(ticket.notes ?? "");
  const [pauseDurationChoice, setPauseDurationChoice] = useState<string>("1d");
  const [pauseReasonInput, setPauseReasonInput] = useState("");

  // Gaeste-Infos-Editor: Label/Wert-Zeilen aus ticket.guestInfo plus eine
  // Leerzeile zum Ergaenzen neuer Felder. Wird beim Oeffnen des Editors
  // frisch aus dem Ticket-Stand befuellt.
  const [guestInfoDraft, setGuestInfoDraft] = useState<{ label: string; value: string }[]>([]);
  const openGuestInfoEditor = () => {
    const entries = Object.entries(ticket.guestInfo ?? {}).map(([label, value]) => ({ label, value }));
    setGuestInfoDraft([...entries, { label: "", value: "" }]);
    setEditMode("guestInfo");
  };
  const saveGuestInfo = () => {
    const info: Record<string, string> = {};
    for (const row of guestInfoDraft) {
      const label = row.label.trim();
      const value = row.value.trim();
      if (label && value) info[label] = value;
    }
    onSaveGuestInfo(Object.keys(info).length > 0 ? info : null);
  };

  const isPaused = ticket.status === "PAUSED";
  const pauseInfo = (() => {
    const ext = (ticket.extras as unknown) as Record<string, unknown> | null;
    if (!ext || Array.isArray(ext)) return null;
    const pausedUntilRaw = ext.pausedUntil;
    const reasonRaw = ext.pauseReason;
    const pausedAtRaw = ext.pausedAt;
    return {
      pausedAt: typeof pausedAtRaw === "string" ? pausedAtRaw : null,
      pausedUntil: typeof pausedUntilRaw === "string" ? pausedUntilRaw : null,
      reason: typeof reasonRaw === "string" && reasonRaw ? reasonRaw : null,
    };
  })();
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
                isPaused
                  ? "bg-orange-500/25 text-orange-200"
                  : isChecked
                    ? "bg-emerald-500/25 text-emerald-200"
                    : "bg-sky-500/25 text-sky-200"
              )}>
                {isPaused ? "Pausiert" : isChecked ? "Eingecheckt" : "Ausstehend"}
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

        {/* In ANNY zugebuchtes Verleihmaterial - das gibt das Personal beim
            Check-in heraus. */}
        {addOns.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-800">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              <PackageSearch className="h-3.5 w-3.5 inline mr-1.5" />Verleihmaterial
            </p>
            <div className="flex flex-wrap gap-2">
              {addOns.map((a, i) => (
                <span
                  key={i}
                  className={cn(
                    "text-sm px-3 py-1.5 rounded-xl font-semibold border",
                    isRentalAddOn(a.name)
                      ? "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/40"
                      : "bg-slate-800/60 text-slate-300 border-slate-700",
                  )}
                >
                  {a.quantity > 1 ? `${a.quantity}× ` : ""}{a.name}
                  {a.note && <span className="ml-1.5 text-xs font-normal opacity-70">{a.note}</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Gaeste-Infos (Antworten aus Info-Anfragen, z. B. Ferienkurs:
            Sport, Schuhgroesse, Level, Neopren). Klick oeffnet den
            Label/Wert-Editor - das Personal kann vor Ort korrigieren oder
            fehlende Infos direkt erfassen. */}
        {editMode === "guestInfo" ? (
          <div className="px-5 py-3 border-b border-slate-800 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              <ClipboardList className="h-3.5 w-3.5 inline mr-1.5" />Gäste-Infos
            </p>
            <div className="space-y-1.5">
              {guestInfoDraft.map((row, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => {
                      const next = [...guestInfoDraft];
                      next[i] = { ...next[i], label: e.target.value };
                      // Letzte Zeile befuellt -> neue Leerzeile anhaengen.
                      if (i === next.length - 1 && e.target.value) next.push({ label: "", value: "" });
                      setGuestInfoDraft(next);
                    }}
                    placeholder="Feld (z. B. Schuhgröße)"
                    className="w-2/5 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => {
                      const next = [...guestInfoDraft];
                      next[i] = { ...next[i], value: e.target.value };
                      setGuestInfoDraft(next);
                    }}
                    placeholder="Wert"
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveGuestInfo}
                disabled={updatingTicket}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95"
              >
                {updatingTicket && editMode === "guestInfo" ? (
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                ) : (
                  "Speichern"
                )}
              </button>
              <button
                type="button"
                onClick={() => setEditMode(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-semibold transition-colors active:scale-95"
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : ticket.guestInfo && Object.keys(ticket.guestInfo).length > 0 ? (
          <div className="px-5 py-3 border-b border-slate-800">
            <button
              type="button"
              onClick={openGuestInfoEditor}
              className="w-full text-left group"
            >
              <p className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-2 flex items-center">
                <ClipboardList className="h-3.5 w-3.5 inline mr-1.5" />Gäste-Infos
                <Pencil className="h-3 w-3 text-slate-600 group-hover:text-slate-400 transition-colors ml-auto" />
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(ticket.guestInfo).map(([label, value]) => (
                  <span key={label} className="text-sm bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 px-3 py-1.5 rounded-xl font-medium">
                    <span className="text-cyan-400/80 text-xs mr-1">{label}</span>
                    {value}
                  </span>
                ))}
              </div>
            </button>
          </div>
        ) : (
          <div className="px-5 py-3 border-b border-slate-800">
            <button
              type="button"
              onClick={openGuestInfoEditor}
              className="w-full flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors group"
            >
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">
                {ticket.infoPending
                  ? "Infos angefragt, noch keine Antwort – manuell erfassen"
                  : "Gäste-Infos erfassen"}
              </span>
              <Plus className="h-3 w-3 text-slate-600 group-hover:text-slate-400 transition-colors ml-auto shrink-0" />
            </button>
          </div>
        )}

        {/* Info */}
        <div className="px-5 py-3 border-b border-slate-800 space-y-2">
          <InfoRow label="RFID" value={ticket.rfidCode ?? "–"} icon={Fingerprint} />
          {ticket.accessArea && bundleParts.length === 0 && (
            <InfoRow label="Bereich" value={ticket.accessArea.name} icon={Users} />
          )}
          {/* Kombi-Ticket: die einzelnen ANNY-Buchungen auflisten. Ohne das
              sieht das Personal nur eine Karte und kann nicht pruefen, welche
              Bereiche der Gast abgedeckt hat und ob wirklich alle
              Teilbuchungen eingecheckt sind. */}
          {bundleParts.length > 0 && (
            <div className="rounded-xl border border-sky-800/50 bg-sky-950/30 p-2.5 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <Layers className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="font-semibold text-sky-300">
                  Kombi-Ticket · {bundleParts.length} Bereiche
                </span>
              </div>
              {bundleParts.map(({ ticket: part, areaName }) => {
                const partChecked = part.checkedIn || part.status === "REDEEMED";
                return (
                  <div key={part.id} className="flex items-center gap-2 text-xs">
                    {partChecked ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    )}
                    <span className="font-medium text-slate-200 shrink-0">{areaName}</span>
                    {part.barcode && (
                      <span className="font-mono text-[10px] text-slate-500 truncate">
                        {part.barcode}
                      </span>
                    )}
                    <span
                      className={cn(
                        "ml-auto shrink-0 text-[10px] font-semibold",
                        partChecked ? "text-emerald-400" : "text-slate-500",
                      )}
                    >
                      {partChecked ? "eingecheckt" : "offen"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {ticket.barcode && bundleParts.length === 0 && (
            <InfoRow label="Barcode" value={ticket.barcode} icon={ScanLine} />
          )}
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

          {/* Slot-Wechsel: nur fuer Slot-Services (ANNY hat fuer den Service
              Slots geliefert). Day-Pass-Services haben availableSlots=[] und
              zeigen den Button nicht. */}
          {availableSlots.length > 0 && (
            editMode === "slot" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium w-16 shrink-0">Slot</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto monitor-scrollbar pr-1">
                  {availableSlots.map((slot) => {
                    const isCurrent = ticket.slotStart === slot.startTime;
                    const empAdd = isCurrent ? 0 : 1;
                    const remainingAfter = slot.remaining != null ? slot.remaining - empAdd : null;
                    const blocked = !isCurrent && (
                      !slot.available
                      || (slot.remaining != null && slot.remaining <= 0)
                    );
                    const baseColor = isCurrent
                      ? "bg-indigo-600 border-indigo-400 text-white"
                      : blocked
                        ? "bg-rose-950/40 border-rose-800/60 text-rose-400 cursor-not-allowed opacity-60"
                        : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200";
                    return (
                      <button
                        key={`${slot.startTime}-${slot.endTime}`}
                        type="button"
                        disabled={blocked || updatingTicket}
                        onClick={() => {
                          if (blocked) return;
                          if (isCurrent) { setEditMode(null); return; }
                          onSaveSlot(slot.startTime, slot.endTime);
                        }}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
                          baseColor,
                        )}
                      >
                        <div className="tabular-nums">{slot.startTime}</div>
                        {slot.capacity != null && (
                          <div className="text-[10px] opacity-80 mt-0.5">
                            {isCurrent
                              ? `aktuell · ${slot.remaining ?? "?"}/${slot.capacity}`
                              : blocked
                                ? "voll"
                                : `${remainingAfter ?? "?"}/${slot.capacity} frei`}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setEditMode(null)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors active:scale-95"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditMode("slot")}
                className="flex items-center gap-2 text-xs w-full text-left group"
              >
                <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span className="text-slate-400 font-medium w-16 shrink-0">Slot</span>
                <span className="text-slate-200 truncate">
                  {ticket.slotStart && ticket.slotEnd
                    ? `${ticket.slotStart}–${ticket.slotEnd}`
                    : "Slot wählen"}
                </span>
                <Pencil className="h-3 w-3 text-slate-600 group-hover:text-slate-400 transition-colors ml-auto shrink-0" />
              </button>
            )
          )}
        </div>

        {/* Pausierungs-Hinweis (read-only) - sichtbar, wenn das Ticket aktuell
            pausiert ist. Zeigt Begruendung und (falls gesetzt) das Ende der
            Pause an. Das Aufheben der Pause passiert ueber den "Fortsetzen"-
            Button im Actions-Block weiter unten. */}
        {isPaused && (
          <div className="px-5 py-3 border-b border-slate-800 bg-orange-500/5">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-xl bg-orange-500/20 flex items-center justify-center shrink-0">
                <Pause className="h-4 w-4 text-orange-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-orange-200">Pausiert</p>
                <p className="text-xs text-orange-200/70 mt-0.5">
                  {pauseInfo?.pausedUntil
                    ? `bis ${new Date(pauseInfo.pausedUntil).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} Uhr`
                    : "unbegrenzt"}
                </p>
                {pauseInfo?.reason && (
                  <p className="text-xs text-orange-100/80 mt-1 italic">
                    „{pauseInfo.reason}&ldquo;
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Notizen - Freitext, das Personal schreibt z. B.
            "kommt morgen mit Kind", "Schluessel nicht zurueckgegeben".
            Klick auf den Block oeffnet einen Inline-Editor (textarea). */}
        <div className="px-5 py-3 border-b border-slate-800">
          {editMode === "notes" ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                <StickyNote className="h-3.5 w-3.5 inline mr-1.5" />Notiz
              </p>
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Notiz hinzufügen…"
                rows={3}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onSaveNotes(noteInput.trim() || null)}
                  disabled={updatingTicket}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95"
                >
                  {updatingTicket && editMode === "notes" ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : (
                    "Speichern"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNoteInput(ticket.notes ?? "");
                    setEditMode(null);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-semibold transition-colors active:scale-95"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : ticket.notes ? (
            <button
              type="button"
              onClick={() => { setNoteInput(ticket.notes ?? ""); setEditMode("notes"); }}
              className="w-full flex items-start gap-3 text-left group"
            >
              <div className="h-8 w-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                <StickyNote className="h-4 w-4 text-amber-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-300 uppercase tracking-wider">Notiz</p>
                <p className="text-sm text-amber-100 mt-0.5 whitespace-pre-wrap break-words">
                  {ticket.notes}
                </p>
              </div>
              <Pencil className="h-3 w-3 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0 mt-1" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setNoteInput(""); setEditMode("notes"); }}
              className="w-full flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors group"
            >
              <StickyNote className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">Notiz hinzufügen</span>
              <Plus className="h-3 w-3 text-slate-600 group-hover:text-slate-400 transition-colors ml-auto shrink-0" />
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
          {/* Check-in button - bei PAUSED ausgeblendet (Scan wuerde 'status_paused'
              ablehnen). Stattdessen erscheint der "Pause aufheben"-Button. */}
          {!isPaused && !isChecked && !isSub && ticket.service?.allowManualCheckin !== false && (
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

          {/* Pause / Resume - bei VALID/REDEEMED zeigt sich der Pause-
              Picker (Dauer + Begruendung), bei PAUSED ein "Fortsetzen"-Button. */}
          {!isPaused ? (
            editMode === "pause" ? (
              <div className="rounded-2xl border border-orange-500/30 bg-orange-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Pause className="h-4 w-4 text-orange-400" />
                  <p className="text-sm font-bold text-orange-300">Ticket pausieren</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "1h", label: "1 Stunde" },
                    { value: "1d", label: "1 Tag" },
                    { value: "1w", label: "1 Woche" },
                    { value: "1m", label: "1 Monat" },
                    { value: "unbegrenzt", label: "Unbegrenzt" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPauseDurationChoice(opt.value)}
                      className={cn(
                        "py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95",
                        pauseDurationChoice === opt.value
                          ? "bg-orange-600 text-white"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={pauseReasonInput}
                  onChange={(e) => setPauseReasonInput(e.target.value)}
                  placeholder="Begründung (optional)"
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onPause(pauseDurationChoice, pauseReasonInput.trim());
                      setEditMode(null);
                    }}
                    disabled={updatingTicket}
                    className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 active:scale-95"
                  >
                    {updatingTicket ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                    Pausieren
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditMode(null)}
                    className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-semibold transition-colors active:scale-95"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPauseDurationChoice("1d");
                  setPauseReasonInput("");
                  setEditMode("pause");
                }}
                disabled={updatingTicket}
                className="w-full bg-orange-600/15 hover:bg-orange-600/25 text-orange-300 border border-orange-500/30 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-[0.98] disabled:opacity-50"
              >
                <Pause className="h-4 w-4" />
                Pausieren
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={onResume}
              disabled={updatingTicket}
              className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors active:scale-[0.98] disabled:opacity-50"
            >
              {updatingTicket ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Pause aufheben
            </button>
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
