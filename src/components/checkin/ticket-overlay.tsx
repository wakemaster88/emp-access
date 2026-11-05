"use client";

/**
 * Ticket-Detail-Overlay des Check-in-Kiosks (Ansehen, Bearbeiten, Drucken).
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { useEffect, useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Clock, ScanLine, Users, Camera, Loader2, X, Package, Fingerprint, Pencil, Printer, TicketX, Plus, StickyNote, Pause, Play, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { PackageSearch, Layers } from "lucide-react";
import { printTicket } from "./checkin-print";
import type { BundlePart, CheckinTicket, ScanEntry, SlotOverviewSlot, TicketAddOn, TicketExtra } from "./checkin-types";
import { InfoRow, OverlayGrip, RfidInput, overlayScrimClass, overlaySheetClass } from "./checkin-ui";
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
    <div className={cn("fixed inset-0 z-50 flex items-end sm:items-center justify-center", overlayScrimClass)} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(overlaySheetClass, "w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)] monitor-scrollbar")}
      >
        <OverlayGrip />
        {/* Header */}
        <div className="p-5 border-b border-border flex items-start gap-4">
          {ticket.profileImage ? (
            <img src={ticket.profileImage} alt="" className="h-16 w-16 rounded-tile object-cover ring-2 ring-glass-border" />
          ) : (
            <div className="h-16 w-16 rounded-tile bg-glass-tile ring-1 ring-inset ring-glass-border flex items-center justify-center">
              <Users className="h-7 w-7 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setEditMode(editMode === "person" ? null : "person")}
              className="group relative flex items-center gap-1.5 text-left max-w-full after:absolute after:inset-x-0 after:-inset-y-2 sm:after:-inset-y-3.5"
              title="Name & Geburtstag bearbeiten"
            >
              <h2 className="text-xl font-semibold text-foreground truncate">{personName(ticket)}</h2>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            </button>
            <p className="text-sm text-muted-foreground mt-0.5">
              {ticket.ticketTypeName ?? ticket.service?.name ?? ticket.subscription?.name ?? ""}
              {(() => {
                const a = calcAge(ticket.birthDate);
                return a != null ? <span className="ml-1 text-muted-foreground tabular-nums">· {a} J.</span> : null;
              })()}
            </p>
            {(() => {
              const label = formatTicketTimeLabel(ticket);
              return label ? (
                <p className="text-sm text-muted-foreground tabular-nums mt-0.5">{label} Uhr</p>
              ) : null;
            })()}
            {/* Zustand in seiner festen Farbe: Pause = Hinweis, eingecheckt = Erfolg. */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge
                variant={isPaused ? "warning" : isChecked ? "success" : "info"}
                className="text-xs px-2 py-0.5 font-bold"
              >
                {isPaused ? "Pausiert" : isChecked ? "Eingecheckt" : "Ausstehend"}
              </Badge>
              {isSub && <Badge variant="secondary" className="text-xs px-2 py-0.5 font-bold">Abo</Badge>}
              {ticket.source && <Badge variant="neutral" className="text-xs px-2 py-0.5">{ticket.source}</Badge>}
            </div>
          </div>
          <Button
            variant="secondary"
            size="icon-lg"
            onClick={onClose}
            className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
            aria-label="Schließen"
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Person-Edit */}
        {editMode === "person" && (
          <div className="px-5 py-4 border-b border-border space-y-3 bg-glass-tile">
            <p className="text-label">
              <Users className="h-3.5 w-3.5 inline mr-1.5" />
              Person
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-muted-foreground">Vorname</label>
                <Input
                  type="text"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  className="h-11"
                  placeholder="Max"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-muted-foreground">Nachname</label>
                <Input
                  type="text"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  className="h-11"
                  placeholder="Mustermann"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[13px] font-medium text-muted-foreground">Geburtsdatum</label>
              <Input
                ref={birthDateRef}
                type="date"
                defaultValue={editBirthDate}
                onChange={(e) => setEditBirthDate(e.target.value)}
                className="h-11"
              />
              {(() => {
                const a = calcAge(editBirthDate || null);
                return a != null ? (
                  <p className="text-xs text-muted-foreground tabular-nums">Alter: {a} Jahre</p>
                ) : null;
              })()}
            </div>
            {/* Tasten wie in allen Formularen (Abschnitt 16): Primärhandlung rechts,
                auf dem Handy volle Breite und oben. */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditFirstName(ticket.firstName ?? "");
                  setEditLastName(ticket.lastName ?? "");
                  setEditBirthDate(toDateValue(ticket.birthDate));
                  setEditMode(null);
                }}
                className="h-11 px-4 font-semibold sm:h-14"
              >
                Abbrechen
              </Button>
              <Button
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
                className="h-11 font-semibold sm:h-14 sm:flex-1"
              >
                {updatingTicket && editMode === "person" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  "Speichern"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Extras */}
        {extras.length > 0 && (
          <div className="px-5 py-3 border-b border-border">
            <p className="text-label mb-2">
              <Package className="h-3.5 w-3.5 inline mr-1.5" />Zusatzbuchungen
            </p>
            <div className="flex flex-wrap gap-2">
              {extras.map((ex, i) => (
                <span key={i} className="text-sm bg-glass-tile text-foreground border border-glass-border px-3 py-1.5 rounded-full font-medium">
                  {ex.quantity > 1 ? `${ex.quantity}× ` : ""}{ex.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* In ANNY zugebuchtes Verleihmaterial - das gibt das Personal beim
            Check-in heraus. */}
        {addOns.length > 0 && (
          <div className="px-5 py-3 border-b border-border">
            <p className="text-label mb-2">
              <PackageSearch className="h-3.5 w-3.5 inline mr-1.5" />Verleihmaterial
            </p>
            <div className="flex flex-wrap gap-2">
              {addOns.map((a, i) => (
                <span
                  key={i}
                  className={cn(
                    "text-sm px-3 py-1.5 rounded-full font-semibold border",
                    // Verleihmaterial in Akzentfarbe wie auf der Ticketkarte.
                    isRentalAddOn(a.name)
                      ? "bg-primary/15 text-foreground border-primary/45"
                      : "bg-glass-tile text-muted-foreground border-glass-border",
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
          <div className="px-5 py-3 border-b border-border space-y-2">
            <p className="text-label">
              <ClipboardList className="h-3.5 w-3.5 inline mr-1.5" />Gäste-Infos
            </p>
            <div className="space-y-1.5">
              {guestInfoDraft.map((row, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input
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
                    className="h-11 w-2/5"
                  />
                  <Input
                    type="text"
                    value={row.value}
                    onChange={(e) => {
                      const next = [...guestInfoDraft];
                      next[i] = { ...next[i], value: e.target.value };
                      setGuestInfoDraft(next);
                    }}
                    placeholder="Wert"
                    className="h-11 flex-1"
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditMode(null)}
                className="h-11 px-4 font-semibold sm:h-14"
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                onClick={saveGuestInfo}
                disabled={updatingTicket}
                className="h-11 font-semibold sm:h-14 sm:flex-1"
              >
                {updatingTicket && editMode === "guestInfo" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  "Speichern"
                )}
              </Button>
            </div>
          </div>
        ) : ticket.guestInfo && Object.keys(ticket.guestInfo).length > 0 ? (
          <div className="px-5 py-3 border-b border-border">
            <button
              type="button"
              onClick={openGuestInfoEditor}
              className="w-full text-left group"
            >
              <p className="text-label text-info mb-2 flex items-center">
                <ClipboardList className="h-3.5 w-3.5 inline mr-1.5" />Gäste-Infos
                <Pencil className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors ml-auto" />
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(ticket.guestInfo).map(([label, value]) => (
                  <span key={label} className="text-sm bg-info/15 text-foreground border border-info/35 px-3 py-1.5 rounded-full font-medium">
                    <span className="text-info text-xs mr-1">{label}</span>
                    {value}
                  </span>
                ))}
              </div>
            </button>
          </div>
        ) : (
          <div className="px-5 py-1.5 border-b border-border">
            <button
              type="button"
              onClick={openGuestInfoEditor}
              className="w-full min-h-11 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">
                {ticket.infoPending
                  ? "Infos angefragt, noch keine Antwort – manuell erfassen"
                  : "Gäste-Infos erfassen"}
              </span>
              <Plus className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors ml-auto shrink-0" />
            </button>
          </div>
        )}

        {/* Info */}
        <div className="px-5 py-3 border-b border-border space-y-2">
          <InfoRow label="RFID" value={ticket.rfidCode ?? "–"} icon={Fingerprint} />
          {ticket.accessArea && bundleParts.length === 0 && (
            <InfoRow label="Bereich" value={ticket.accessArea.name} icon={Users} />
          )}
          {/* Kombi-Ticket: die einzelnen ANNY-Buchungen auflisten. Ohne das
              sieht das Personal nur eine Karte und kann nicht pruefen, welche
              Bereiche der Gast abgedeckt hat und ob wirklich alle
              Teilbuchungen eingecheckt sind. */}
          {bundleParts.length > 0 && (
            // Glaskachel; die Info-Farbe trägt der Symbol-Chip, nicht die Fläche.
            <div className="glass-tile p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <IconChip icon={Layers} tone="info" size="sm" />
                <span className="font-semibold text-foreground">
                  Kombi-Ticket · {bundleParts.length} Bereiche
                </span>
              </div>
              {bundleParts.map(({ ticket: part, areaName }) => {
                const partChecked = part.checkedIn || part.status === "REDEEMED";
                return (
                  <div key={part.id} className="flex items-center gap-2 text-xs">
                    {partChecked ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-medium text-foreground shrink-0">{areaName}</span>
                    {part.barcode && (
                      <span className="font-mono text-[11px] text-muted-foreground truncate">
                        {part.barcode}
                      </span>
                    )}
                    <span
                      className={cn(
                        "ml-auto shrink-0 text-[11px] font-semibold",
                        partChecked ? "text-success" : "text-muted-foreground",
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium w-16 shrink-0">Gültig</span>
              </div>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="h-11 flex-1 min-w-0"
                />
                <span className="text-muted-foreground self-center">–</span>
                <Input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="h-11 flex-1 min-w-0"
                />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDateStart(toDateValue(ticket.startDate));
                    setDateEnd(toDateValue(ticket.endDate));
                    setEditMode(null);
                  }}
                  className="h-11 px-4 font-semibold sm:h-14"
                >
                  Abbrechen
                </Button>
                <Button
                  onClick={() => {
                    onSaveDates(
                      dateStart ? new Date(dateStart).toISOString() : null,
                      dateEnd ? new Date(dateEnd).toISOString() : null,
                    );
                  }}
                  disabled={updatingTicket}
                  className="h-11 font-semibold sm:h-14 sm:flex-1"
                >
                  {updatingTicket && editMode === "dates" ? <Loader2 className="animate-spin" /> : "Speichern"}
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditMode("dates")}
              className="flex items-center gap-2 text-xs w-full min-h-11 text-left group"
            >
              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium w-16 shrink-0">Gültig</span>
              <span className="text-foreground tabular-nums truncate">
                {ticket.startDate && ticket.endDate
                  ? `${new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })} – ${new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}${new Date(ticket.endDate) < new Date() ? " (abgelaufen)" : ""}`
                  : ticket.startDate
                    ? `ab ${new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}`
                    : "Nicht gesetzt"}
              </span>
              <Pencil className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors ml-auto shrink-0" />
            </button>
          )}

          {/* Slot-Wechsel: nur fuer Slot-Services (ANNY hat fuer den Service
              Slots geliefert). Day-Pass-Services haben availableSlots=[] und
              zeigen den Button nicht. */}
          {availableSlots.length > 0 && (
            editMode === "slot" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
                    // Aktueller Slot als Auswahl (Akzent), voller Slot rot, freie als Glas.
                    const baseColor = isCurrent
                      ? "bg-primary border-primary text-primary-foreground"
                      : blocked
                        ? "bg-destructive/10 border-destructive/40 text-destructive cursor-not-allowed opacity-60"
                        : "bg-glass-tile hover:bg-glass-strong border-glass-border text-foreground";
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
                          "press min-h-11 rounded-control border px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
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
                {/* Wie die übrigen Editoren: auf dem Handy volle Breite. */}
                <div className="flex flex-col sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setEditMode(null)}
                    className="h-11 font-semibold sm:h-14"
                  >
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditMode("slot")}
                className="flex items-center gap-2 text-xs w-full min-h-11 text-left group"
              >
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground font-medium w-16 shrink-0">Slot</span>
                <span className="text-foreground tabular-nums truncate">
                  {ticket.slotStart && ticket.slotEnd
                    ? `${ticket.slotStart}–${ticket.slotEnd}`
                    : "Slot wählen"}
                </span>
                <Pencil className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors ml-auto shrink-0" />
              </button>
            )
          )}
        </div>

        {/* Pausierungs-Hinweis (read-only) - sichtbar, wenn das Ticket aktuell
            pausiert ist. Zeigt Begruendung und (falls gesetzt) das Ende der
            Pause an. Das Aufheben der Pause passiert ueber den "Fortsetzen"-
            Button im Actions-Block weiter unten. */}
        {isPaused && (
          <div className="px-5 py-3 border-b border-border">
            <Notice tone="warning" icon={Pause} title="Pausiert" compact>
              <p className="tabular-nums">
                {pauseInfo?.pausedUntil
                  ? `bis ${new Date(pauseInfo.pausedUntil).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} Uhr`
                  : "unbegrenzt"}
              </p>
              {pauseInfo?.reason && (
                <p className="text-foreground mt-1 italic">
                  „{pauseInfo.reason}&ldquo;
                </p>
              )}
            </Notice>
          </div>
        )}

        {/* Notizen - Freitext, das Personal schreibt z. B.
            "kommt morgen mit Kind", "Schluessel nicht zurueckgegeben".
            Klick auf den Block oeffnet einen Inline-Editor (textarea). */}
        <div className="px-5 py-3 border-b border-border">
          {editMode === "notes" ? (
            <div className="space-y-2">
              <p className="text-label">
                <StickyNote className="h-3.5 w-3.5 inline mr-1.5" />Notiz
              </p>
              <Textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Notiz hinzufügen…"
                rows={3}
                className="resize-none"
                autoFocus
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setNoteInput(ticket.notes ?? "");
                    setEditMode(null);
                  }}
                  className="h-11 px-4 font-semibold sm:h-14"
                >
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  onClick={() => onSaveNotes(noteInput.trim() || null)}
                  disabled={updatingTicket}
                  className="h-11 font-semibold sm:h-14 sm:flex-1"
                >
                  {updatingTicket && editMode === "notes" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    "Speichern"
                  )}
                </Button>
              </div>
            </div>
          ) : ticket.notes ? (
            <button
              type="button"
              onClick={() => { setNoteInput(ticket.notes ?? ""); setEditMode("notes"); }}
              className="w-full flex items-start gap-3 text-left group"
            >
              {/* Notiz ist ein Hinweis fürs Personal: Hinweisfarbe (warning). */}
              <IconChip icon={StickyNote} tone="warning" />
              <div className="flex-1 min-w-0">
                <p className="text-label text-warning">Notiz</p>
                <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap break-words">
                  {ticket.notes}
                </p>
              </div>
              <Pencil className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 mt-1" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setNoteInput(""); setEditMode("notes"); }}
              className="w-full min-h-11 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              <StickyNote className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">Notiz hinzufügen</span>
              <Plus className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors ml-auto shrink-0" />
            </button>
          )}
        </div>

        {/* Scan history */}
        {ticketScans.length > 0 && (
          <div className="px-5 py-3 border-b border-border">
            <p className="text-label mb-2">
              <ScanLine className="h-3.5 w-3.5 inline mr-1.5" />Scanverlauf
            </p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto monitor-scrollbar">
              {ticketScans.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  {s.result === "GRANTED" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  )}
                  <span className={s.result === "GRANTED" ? "text-success font-semibold" : "text-destructive font-semibold"}>
                    {s.result === "GRANTED" ? "Zugang" : "Abgelehnt"}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(s.scanTime).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground truncate">{s.device?.name ?? "Manuell"}</span>
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
            <Button
              onClick={onCheckin}
              disabled={checkingIn}
              className="w-full h-16 rounded-tile text-lg font-bold gap-3"
            >
              {checkingIn ? (
                <Loader2 className="size-6 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="size-6" />
                  Einchecken
                </>
              )}
            </Button>
          )}

          {/* Photo / RFID buttons */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              onClick={onOpenCamera}
              disabled={updatingTicket}
              className="h-12 font-semibold sm:h-14"
            >
              {updatingTicket && editMode === "photo" ? <Loader2 className="animate-spin" /> : <Camera />}
              Foto {ticket.profileImage ? "ändern" : "aufnehmen"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => { setEditMode(editMode === "rfid" ? null : "rfid"); setRfidInput(ticket.rfidCode ?? ""); }}
              className="h-12 font-semibold sm:h-14"
            >
              <Fingerprint />
              RFID {ticket.rfidCode ? "ändern" : "setzen"}
            </Button>
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
                <Button
                  onClick={() => onSaveRfid()}
                  disabled={!rfidInput.trim() || updatingTicket}
                  className="h-12 px-5 font-semibold sm:h-14"
                >
                  {updatingTicket ? <Loader2 className="animate-spin" /> : "Speichern"}
                </Button>
              </div>
              {rfidConflict && (
                <Notice
                  tone="warning"
                  title={
                    <>
                      <span className="font-bold">RFID bereits vergeben</span> an{" "}
                      <span className="font-semibold">{rfidConflict.existingOwner}</span>
                      {rfidConflict.existingType && <span className="font-normal text-muted-foreground"> ({rfidConflict.existingType})</span>}
                    </>
                  }
                >
                  <p>RFID vom bisherigen Besitzer entfernen und diesem Ticket zuweisen?</p>
                  <div className="flex flex-col-reverse gap-2 mt-3 sm:flex-row">
                    <Button
                      variant="outline"
                      onClick={onCancelRfid}
                      className="h-11 font-semibold sm:h-14 sm:flex-1"
                    >
                      Abbrechen
                    </Button>
                    <Button
                      onClick={onForceRfid}
                      className="h-11 font-semibold sm:h-14 sm:flex-1"
                    >
                      Überschreiben
                    </Button>
                  </div>
                </Notice>
              )}
            </div>
          )}

          {/* Pause / Resume - bei VALID/REDEEMED zeigt sich der Pause-
              Picker (Dauer + Begruendung), bei PAUSED ein "Fortsetzen"-Button. */}
          {!isPaused ? (
            editMode === "pause" ? (
              // Pause = Hinweis (warning): Glaskachel, die Hinweisfarbe trägt der Symbol-Chip.
              <div className="glass-tile p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <IconChip icon={Pause} tone="warning" size="sm" />
                  <p className="text-sm font-semibold text-foreground">Ticket pausieren</p>
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
                        "press min-h-11 py-2.5 rounded-control text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        pauseDurationChoice === opt.value
                          ? "bg-warning text-warning-foreground"
                          : "bg-glass-tile text-foreground ring-1 ring-inset ring-glass-border hover:bg-glass-strong",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <Input
                  type="text"
                  value={pauseReasonInput}
                  onChange={(e) => setPauseReasonInput(e.target.value)}
                  placeholder="Begründung (optional)"
                  className="h-12 px-4"
                />

                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditMode(null)}
                    className="h-12 px-5 font-semibold sm:h-14"
                  >
                    Abbrechen
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      onPause(pauseDurationChoice, pauseReasonInput.trim());
                      setEditMode(null);
                    }}
                    disabled={updatingTicket}
                    className="h-12 font-bold sm:h-14 sm:flex-1"
                  >
                    {updatingTicket ? <Loader2 className="animate-spin" /> : <Pause />}
                    Pausieren
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPauseDurationChoice("1d");
                  setPauseReasonInput("");
                  setEditMode("pause");
                }}
                disabled={updatingTicket}
                className="w-full h-12 font-semibold sm:h-14"
              >
                <Pause className="text-warning" />
                Pausieren
              </Button>
            )
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={onResume}
              disabled={updatingTicket}
              className="w-full h-12 font-semibold sm:h-14"
            >
              {updatingTicket ? <Loader2 className="animate-spin" /> : <Play className="text-success" />}
              Pause aufheben
            </Button>
          )}

          {/* Print button */}
          <Button
            variant="secondary"
            onClick={() => printTicket(ticket, accountName)}
            className="w-full h-12 font-semibold sm:h-14"
          >
            <Printer />
            Ticket drucken
          </Button>

          {/* New ticket for same person */}
          <Button
            variant="outline"
            onClick={onAddTicket}
            className="w-full h-12 font-semibold sm:h-14"
          >
            <Plus />
            Neues Ticket hinzufügen
          </Button>

          {ticket.status !== "CANCELED" && (
            // Stornieren: Glas-Taste mit roter Schrift (kein deckendes Rot in der Liste).
            <Button
              variant="outline"
              onClick={onCancelVoucher}
              disabled={cancellingVoucher}
              className="w-full h-12 font-semibold border-destructive/40 text-destructive hover:bg-destructive/10 sm:h-14"
            >
              <TicketX />
              {cancellingVoucher ? "Wird storniert..." : "Stornieren & Gutschein"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
