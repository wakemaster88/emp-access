/**
 * Laufende Abos mit „Fahrer offen“ (Abos › „Fahrer offen“).
 *
 * Das Abo hat ein Kundenkonto, aber noch keine Person: Meist steht an einem
 * Kids-Abo das Geburtsdatum der Eltern, oder zwei Fahr-Abos mit denselben
 * Daten laufen gleichzeitig (siehe lib/customer-person). Die Liste zeigt je
 * Abo die Personen des Kontos zur Auswahl; zugeordnet wird über
 * `PUT /api/tickets/[id]/rider`.
 */
import type { PrismaClient, TicketStatus } from "@prisma/client";
import { personLabel } from "./abos-without-email";

const RUNNING: TicketStatus[] = ["VALID", "REDEEMED", "PAUSED"];

export interface RiderOpenPerson {
  id: number;
  name: string;
  /** ISO-Datum (YYYY-MM-DD) oder null. */
  birthDate: string | null;
  /** Laufende Abos der Person, z. B. „Ride Abo“. */
  abos: string[];
}

export interface RiderOpenRow {
  id: number;
  aboName: string | null;
  status: TicketStatus;
  /** Ende der Laufzeit, ISO; null = offen. */
  endDate: string | null;
  /** Name und Geburtsdatum am Abo (bei anny die des Kontoinhabers). */
  ticketName: string;
  ticketBirthDate: string | null;
  lastName: string | null;
  email: string;
  persons: RiderOpenPerson[];
}

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export async function loadRidersOpen(db: PrismaClient, accountId: number, now: Date = new Date()): Promise<RiderOpenRow[]> {
  const running = {
    subscriptionId: { not: null },
    status: { in: RUNNING },
    OR: [{ endDate: null }, { endDate: { gt: now } }],
  };
  const tickets = await db.ticket.findMany({
    where: { accountId, ...running, customerId: { not: null }, riderProfileId: null },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      birthDate: true,
      endDate: true,
      status: true,
      subscription: { select: { name: true } },
      customer: {
        select: {
          email: true,
          persons: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              birthDate: true,
              tickets: { where: running, select: { subscription: { select: { name: true } } }, take: 10 },
            },
            orderBy: { id: "asc" },
            take: 20,
          },
        },
      },
    },
    orderBy: [{ endDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: 200,
  });

  return tickets
    .filter((t) => t.customer != null)
    .map((t) => ({
      id: t.id,
      aboName: t.subscription?.name ?? null,
      status: t.status,
      endDate: t.endDate?.toISOString() ?? null,
      ticketName: personLabel(t),
      ticketBirthDate: isoDay(t.birthDate),
      lastName: t.lastName?.trim() || null,
      email: t.customer!.email,
      persons: t.customer!.persons.map((p) => ({
        id: p.id,
        name: [p.firstName, p.lastName].filter((v) => v?.trim()).join(" ").trim() || "Ohne Namen",
        birthDate: isoDay(p.birthDate),
        abos: p.tickets.map((x) => x.subscription?.name).filter((v): v is string => !!v),
      })),
    }));
}
