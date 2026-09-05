"use client";

/**
 * Ticketkarte in der Gaesteliste des Check-in-Kiosks.
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { Badge } from "@/components/ui/badge";
import { Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PackageSearch } from "lucide-react";
import type { CheckinTicket, TicketAddOn, TicketExtra } from "./checkin-types";
import { calcAge, formatTicketTimeLabel, isRentalAddOn, personName } from "./checkin-utils";

export function TicketCard({
  ticket,
  onTap,
  onCheckin,
  checkingIn,
  checked,
  isSub,
  highlight,
  bundleSize = 1,
}: {
  ticket: CheckinTicket;
  onTap: () => void;
  onCheckin?: () => void;
  checkingIn?: boolean;
  checked?: boolean;
  isSub?: boolean;
  highlight?: string;
  /** Anzahl der ANNY-Teilbuchungen hinter dieser Karte. > 1 bei Kombi-
   *  Tickets, die mehrere Bereiche abdecken (z.B. Aquapark + Strandbad). */
  bundleSize?: number;
}) {
  const extras = (ticket.extras ?? []) as TicketExtra[];
  const addOns = (ticket.addOns ?? []) as TicketAddOn[];
  const needsPhoto = (ticket.service?.requiresPhoto || ticket.subscription?.requiresPhoto) && !ticket.profileImage;
  const needsRfid = (ticket.service?.requiresRfid || ticket.subscription?.requiresRfid) && !ticket.rfidCode;
  // ANNY-Sync-Status:
  //   * Service hat keinen ANNY-Link        -> kein Badge
  //   * ANNY-Link + annyBookingId vorhanden -> "ANNY ✓" (gruen)
  //   * ANNY-Link, aber kein annyBookingId  -> "ANNY ?" (amber, nicht synchronisiert)
  // Quelle: server liefert ticket.service.hasAnnyLink + ticket.annyBookingId.
  const annyState: "synced" | "unsynced" | null = ticket.service?.hasAnnyLink
    ? ticket.annyBookingId
      ? "synced"
      : "unsynced"
    : null;

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
        {/* In ANNY zugebuchtes Verleihmaterial. Absichtlich auffaellig, weil das
            Personal es beim Check-in herausgeben muss. */}
        {addOns.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {addOns.map((a, i) => (
              <span
                key={i}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-md font-semibold inline-flex items-center gap-1",
                  isRentalAddOn(a.name)
                    ? "bg-fuchsia-500/25 text-fuchsia-200 ring-1 ring-fuchsia-500/40"
                    : "bg-slate-700/50 text-slate-300",
                )}
                title={a.note ? `${a.name} (${a.note})` : a.name}
              >
                {isRentalAddOn(a.name) && <PackageSearch className="h-2.5 w-2.5" />}
                {a.quantity > 1 ? `${a.quantity}× ` : ""}{a.name}
              </span>
            ))}
          </div>
        )}
        {/* Gaeste-Infos aus Info-Anfragen (Teilnehmername, Schuhgroesse,
            Level, Neopren etc.) - beschleunigt den Kurs-Check-in. */}
        {ticket.guestInfo && Object.keys(ticket.guestInfo).length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {Object.entries(ticket.guestInfo).map(([label, value]) => (
              <span key={label} className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md font-medium">
                {label === "Teilnehmer" ? value : `${label}: ${value}`}
              </span>
            ))}
          </div>
        )}
        {(needsPhoto || needsRfid || annyState || ticket.infoPending || bundleSize > 1) && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {bundleSize > 1 && (
              <span
                className="text-[10px] bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded-md font-medium"
                title={`Kombi-Ticket aus ${bundleSize} ANNY-Buchungen (mehrere Bereiche). Wird gemeinsam eingecheckt.`}
              >
                Kombi {bundleSize}×
              </span>
            )}
            {needsPhoto && <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded-md font-medium">Foto fehlt</span>}
            {needsRfid && <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded-md font-medium">RFID fehlt</span>}
            {ticket.infoPending && (
              <span
                className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded-md font-medium"
                title="Info-Anfrage verschickt, aber noch nicht beantwortet."
              >
                Infos fehlen
              </span>
            )}
            {annyState === "synced" && (
              <span
                className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-md font-medium"
                title={`ANNY-Booking ${ticket.annyBookingId?.slice(0, 8) ?? ""}…`}
              >
                ANNY ✓
              </span>
            )}
            {annyState === "unsynced" && (
              <span
                className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-md font-medium"
                title="ANNY-Link existiert, dieses Ticket wurde aber nicht zu ANNY synchronisiert (vor Sync-Feature angelegt oder Sync fehlgeschlagen)."
              >
                ANNY ?
              </span>
            )}
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

