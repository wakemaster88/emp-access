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
