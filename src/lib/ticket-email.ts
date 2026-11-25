/**
 * Tickets eines Kontos zu einer E-Mail-Adresse finden, Groß- und
 * Kleinschreibung egal.
 *
 * Vergleicht `lower("email") = lower(trim(Eingabe))` und nutzt so den Index
 * "Ticket_accountId_lower_email_idx" (Migration
 * 20261124210000_ticket_email_lower_index). Für eine gesäuberte Adresse
 * (`normalizeEmail`) liefert das dieselben Tickets wie
 * `email: equalsInsensitive(adresse)`: `%`, `_` und `\` zählen wörtlich,
 * Leerzeichen um die gespeicherte Adresse herum zählen mit, Tickets ohne
 * Adresse kommen nie mit. Die gespeicherten Adressen bleiben, wie sie sind.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { equalsInsensitive } from "./like-escape";

/**
 * Bis zu so vielen Ticket-IDs gehen als `id IN (...)` in die Folgeabfrage.
 * Postgres nimmt je Abfrage höchstens 32.767 Parameter.
 */
export const MAX_EMAIL_TICKET_IDS = 10_000;

/** IDs aller Tickets des Kontos mit dieser Adresse, die neuesten zuerst; leer ohne Adresse. */
export async function ticketIdsByEmail(accountId: number, email: string | null | undefined): Promise<number[]> {
  if (typeof email !== "string" || email.trim() === "") return [];
  const rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id" FROM "Ticket"
    WHERE "accountId" = ${accountId} AND lower("email") = lower(trim(${email}))
    ORDER BY "id" DESC
  `);
  return rows.map((r) => Number(r.id));
}

/**
 * Prisma-Filter für die Tickets einer Adresse, deren IDs `ticketIdsByEmail`
 * geliefert hat: `id IN (ids)`. Hat die Adresse mehr als
 * `MAX_EMAIL_TICKET_IDS` Tickets, vergleicht der Filter stattdessen die
 * Adresse selbst (`equalsInsensitive`), mit demselben Ergebnis für eine
 * gesäuberte Adresse.
 */
export function ticketEmailWhere(ids: number[], email: string): Prisma.TicketWhereInput {
  return ids.length > MAX_EMAIL_TICKET_IDS ? { email: equalsInsensitive(email) } : { id: { in: ids } };
}
