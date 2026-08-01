// Warnung, wenn ein Abo-/Service-Ticket ohne Karte gespeichert wird, obwohl
// der Tarif eine verlangt (`requiresRfid`).
//
// Ohne Code ist so ein Ticket nicht scanbar. Besitzt die Person noch ein
// aelteres Ticket mit der Karte, findet der Scanner beim Vorzeigen nur dieses -
// und weist ab, sobald es abgelaufen ist. Genau dieser Fall ist in der Praxis
// aufgetreten (Abo verlaengert, Karte blieb am alten Ticket haengen).

import type { PrismaClient } from "@prisma/client";
import { findPredecessorTicket } from "@/lib/ticket-predecessor";

export type MissingCardWarning = {
  code: "MISSING_CARD";
  message: string;
  /** Ticket derselben Person, das aktuell eine Karte traegt (falls vorhanden). */
  predecessorTicketId?: number;
};

type TicketLike = {
  id: number;
  rfidCode: string | null;
  qrCode: string | null;
  barcode: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  subscriptionId: number | null;
  serviceId: number | null;
};

export async function buildMissingCardWarning(
  db: PrismaClient,
  accountId: number,
  ticket: TicketLike,
): Promise<MissingCardWarning | null> {
  if (ticket.rfidCode || ticket.qrCode || ticket.barcode) return null;
  if (ticket.subscriptionId == null && ticket.serviceId == null) return null;

  const [sub, svc] = await Promise.all([
    ticket.subscriptionId != null
      ? db.subscription.findUnique({
          where: { id: ticket.subscriptionId },
          select: { requiresRfid: true },
        })
      : null,
    ticket.serviceId != null
      ? db.service.findUnique({
          where: { id: ticket.serviceId },
          select: { requiresRfid: true },
        })
      : null,
  ]);

  if (!sub?.requiresRfid && !svc?.requiresRfid) return null;

  const predecessor = await findPredecessorTicket(db.ticket, accountId, {
    firstName: ticket.firstName,
    lastName: ticket.lastName,
    email: ticket.email,
    excludeTicketId: ticket.id,
  });

  if (predecessor?.rfidCode) {
    return {
      code: "MISSING_CARD",
      message:
        "Dieses Ticket hat keinen Code, der Tarif verlangt aber eine Karte. "
        + "Die Person hat noch ein aelteres Ticket mit Karte - bitte die Karte "
        + "auf dieses Ticket umhaengen, sonst wird beim Scannen weiter das alte "
        + "Ticket gefunden.",
      predecessorTicketId: predecessor.ticketId,
    };
  }

  return {
    code: "MISSING_CARD",
    message:
      "Dieses Ticket hat keinen Code, der Tarif verlangt aber eine Karte. "
      + "Ohne Karte ist kein Zutritt moeglich.",
  };
}
