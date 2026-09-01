import type { TenantDb } from "@/lib/prisma";
import { holderInclude } from "@/lib/keying-queries";

export type HolderInput = {
  ticketId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export type CreateHolderResult =
  | { ok: true; holderId: number }
  | { ok: false; message: string };

/**
 * Legt einen Schluesselnehmer an. Bei Mitarbeitern (Ticket mit
 * `source = EMP_CONTROL`) werden Name und Mail aus dem Ticket gespiegelt,
 * damit das Protokoll auch nach dem Loeschen des Tickets lesbar bleibt.
 */
export async function createHolder(
  db: TenantDb,
  accountId: number,
  data: HolderInput,
): Promise<CreateHolderResult> {
  let firstName = data.firstName?.trim() || null;
  let lastName = data.lastName?.trim() || null;
  let email = data.email?.trim() || null;

  if (data.ticketId != null) {
    const ticket = await db.ticket.findFirst({
      where: { id: data.ticketId, accountId },
      select: { id: true, name: true, firstName: true, lastName: true, email: true },
    });
    if (!ticket) return { ok: false, message: "Mitarbeiter nicht gefunden" };

    firstName = firstName ?? ticket.firstName ?? null;
    lastName = lastName ?? ticket.lastName ?? ticket.name;
    email = email ?? ticket.email ?? null;
  }

  const holder = await db.keyHolder.create({
    data: {
      accountId,
      ticketId: data.ticketId ?? null,
      firstName,
      lastName,
      company: data.company?.trim() || null,
      email,
      phone: data.phone?.trim() || null,
      notes: data.notes?.trim() || null,
    },
    include: holderInclude,
  });
  return { ok: true, holderId: holder.id };
}
