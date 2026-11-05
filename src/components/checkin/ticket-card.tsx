"use client";

/**
 * Ticketkarte in der Gaesteliste des Check-in-Kiosks.
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PackageSearch } from "lucide-react";
import type { CheckinTicket, TicketAddOn, TicketExtra } from "./checkin-types";
import { calcAge, formatTicketTimeLabel, isRentalAddOn, personName } from "./checkin-utils";

/**
 * Kleine Kennzeichen auf der Ticketkarte (Extras, Zusatzbuchungen, Gäste-Infos,
 * Status) sind `Badge`s in ihrer Zustandsvariante, in 11 px wie die Status-Pillen
 * rechts. Freitext (Gäste-Infos, Extras) darf in der schmalen Karte umbrechen.
 */
const chipClass = "text-[11px] font-medium whitespace-normal";

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
        // Kachel in der Abschnittskarte; Scan-Ergebnis als volle Zustandsfläche,
        // Pause in der Hinweisfarbe, eingecheckt in der Erfolgsfarbe.
        "glass-tile flex items-center gap-3 p-3 transition-all duration-700 active:scale-[0.98] cursor-pointer",
        highlight === "GRANTED"
          ? "border-success/70 bg-success/20 ring-2 ring-success/40"
          : highlight === "DENIED"
          ? "border-destructive/70 bg-destructive/20 ring-2 ring-destructive/40"
          : ticket.status === "PAUSED"
          ? "border-warning/40 bg-warning/10 opacity-70"
          : checked
          ? "border-success/35 bg-success/10"
          : "hover:bg-glass-strong"
      )}
    >
      {ticket.profileImage ? (
        <img src={ticket.profileImage} alt="" className="h-12 w-12 rounded-xl object-cover shrink-0 ring-1 ring-glass-border" />
      ) : (
        <div className="h-12 w-12 rounded-xl bg-glass-tile ring-1 ring-inset ring-glass-border flex items-center justify-center shrink-0">
          <Users className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">
          {personName(ticket)}
          {(() => { const a = calcAge(ticket.birthDate); return a != null ? <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">({a})</span> : null; })()}
        </p>
        {(() => {
          const timeLabel = formatTicketTimeLabel(ticket);
          return (
            <p className="text-xs text-muted-foreground truncate">
              {timeLabel}
              {timeLabel && ticket.ticketTypeName ? " · " : ""}
              {ticket.ticketTypeName ?? ""}
            </p>
          );
        })()}
        {isSub && ticket.startDate && ticket.endDate && (
          <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
            {new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
            {" – "}
            {new Date(ticket.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
            {new Date(ticket.endDate) < new Date() && (
              <span className="text-destructive font-semibold ml-1">abgelaufen</span>
            )}
          </p>
        )}
        {isSub && ticket.startDate && !ticket.endDate && (
          <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
            ab {new Date(ticket.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
          </p>
        )}
        {extras.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {extras.map((ex, i) => (
              <Badge key={i} variant="secondary" className={chipClass}>
                {ex.quantity > 1 ? `${ex.quantity}× ` : ""}{ex.name}
              </Badge>
            ))}
          </div>
        )}
        {/* In ANNY zugebuchtes Verleihmaterial. Absichtlich auffaellig, weil das
            Personal es beim Check-in herausgeben muss. */}
        {addOns.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {addOns.map((a, i) => (
              <Badge
                key={i}
                // Verleihmaterial in Akzentfarbe wie in der Tagesübersicht oben,
                // sonstige Zusatzbuchungen als ruhige Pille.
                variant={isRentalAddOn(a.name) ? "default" : "neutral"}
                className={cn(
                  chipClass,
                  "font-semibold",
                  isRentalAddOn(a.name) && "bg-primary/20 text-foreground ring-1 ring-inset ring-primary/45",
                )}
                title={a.note ? `${a.name} (${a.note})` : a.name}
              >
                {isRentalAddOn(a.name) && <PackageSearch />}
                {a.quantity > 1 ? `${a.quantity}× ` : ""}{a.name}
              </Badge>
            ))}
          </div>
        )}
        {/* Gaeste-Infos aus Info-Anfragen (Teilnehmername, Schuhgroesse,
            Level, Neopren etc.) - beschleunigt den Kurs-Check-in. */}
        {ticket.guestInfo && Object.keys(ticket.guestInfo).length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {Object.entries(ticket.guestInfo).map(([label, value]) => (
              <Badge key={label} variant="info" className={chipClass}>
                {label === "Teilnehmer" ? value : `${label}: ${value}`}
              </Badge>
            ))}
          </div>
        )}
        {(needsPhoto || needsRfid || annyState || ticket.infoPending || bundleSize > 1) && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {bundleSize > 1 && (
              <Badge
                variant="info"
                className={chipClass}
                title={`Kombi-Ticket aus ${bundleSize} ANNY-Buchungen (mehrere Bereiche). Wird gemeinsam eingecheckt.`}
              >
                Kombi {bundleSize}×
              </Badge>
            )}
            {needsPhoto && <Badge variant="danger" className={chipClass}>Foto fehlt</Badge>}
            {needsRfid && <Badge variant="danger" className={chipClass}>RFID fehlt</Badge>}
            {ticket.infoPending && (
              <Badge
                variant="danger"
                className={chipClass}
                title="Info-Anfrage verschickt, aber noch nicht beantwortet."
              >
                Infos fehlen
              </Badge>
            )}
            {annyState === "synced" && (
              <Badge
                variant="success"
                className={chipClass}
                title={`ANNY-Booking ${ticket.annyBookingId?.slice(0, 8) ?? ""}…`}
              >
                ANNY ✓
              </Badge>
            )}
            {annyState === "unsynced" && (
              <Badge
                variant="warning"
                className={chipClass}
                title="ANNY-Link existiert, dieses Ticket wurde aber nicht zu ANNY synchronisiert (vor Sync-Feature angelegt oder Sync fehlgeschlagen)."
              >
                ANNY ?
              </Badge>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        {ticket.status === "PAUSED" ? (
          <Badge variant="warning" className="text-[11px] px-2 py-0.5 font-bold">Pausiert</Badge>
        ) : checked ? (
          <Badge variant="success" className="text-[11px] px-2 py-0.5 font-bold">Eingecheckt</Badge>
        ) : onCheckin ? (
          <div className="flex flex-col items-end gap-1">
            {isSub && <Badge variant="secondary" className="text-[11px] px-2 py-0.5 font-bold">Abo</Badge>}
            {/* Touch-Ziel 44 px auf dem Handy, 56 px am Kiosk (Abschnitt 20); die
                Breite folgt dem Text, damit der Name daneben Platz behält.
                `disabled:pointer-events-auto`: Die gesperrte Taste schluckt einen
                zweiten Tipp, statt ihn an die Karte (öffnet das Ticket) durchzureichen. */}
            <Button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCheckin(); }}
              disabled={checkingIn}
              className="h-11 px-3 font-semibold sm:h-14 disabled:pointer-events-auto"
            >
              {checkingIn ? <Loader2 className="animate-spin" /> : "Einchecken"}
            </Button>
          </div>
        ) : isSub ? (
          <Badge variant="secondary" className="text-[11px] px-2 py-0.5 font-bold">Abo</Badge>
        ) : null}
      </div>
    </div>
  );
}

