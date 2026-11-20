/**
 * Kundenkonto in der Kunden-App: „Neues Abo: Für wen ist es?“
 *
 * Wer sich mit der Adresse eines Kontos angemeldet hat, sieht die Abos des
 * Kontos, bei denen noch niemand als Fahrer eingetragen ist („Fahrer
 * offen“), und sagt, wer damit fährt: er selbst, eine Person der Familie
 * oder eine neue (lib/customers `assignRider`). Neue Personen kommen danach
 * von selbst in seine Familie.
 */
import { prisma } from "./prisma";

const RUNNING = ["VALID", "REDEEMED", "PAUSED"] as const;

export interface KontoOpenAbo {
  ticketId: number;
  aboName: string;
  endDate: Date | null;
  /** Nachname am Abo, als Vorschlag für eine neue Person. */
  lastName: string | null;
}

export interface KontoPerson {
  id: number;
  name: string;
  birthDate: Date | null;
}

export interface KontoRiders {
  customerId: number;
  abos: KontoOpenAbo[];
  /** Personen des Kontos; die angemeldete Person zuerst. */
  persons: KontoPerson[];
}

/**
 * Offene Abos des Kontos, wenn `profileId` sich mit dessen Adresse
 * angemeldet hat; sonst null.
 */
export async function kontoRidersFor(profileId: number, now: Date = new Date()): Promise<KontoRiders | null> {
  const me = await prisma.riderProfile.findUnique({
    where: { id: profileId },
    select: { id: true, accountId: true, email: true, customer: { select: { id: true, email: true, aliasEmails: true } } },
  });
  const c = me?.customer;
  if (!me || !c || !me.email || ![c.email, ...c.aliasEmails].includes(me.email)) return null;
  const [abos, persons] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        accountId: me.accountId,
        customerId: c.id,
        subscriptionId: { not: null },
        riderProfileId: null,
        status: { in: [...RUNNING] },
        OR: [{ endDate: null }, { endDate: { gt: now } }],
      },
      select: { id: true, lastName: true, endDate: true, subscription: { select: { name: true } } },
      orderBy: [{ endDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: 10,
    }),
    prisma.riderProfile.findMany({
      where: { accountId: me.accountId, customerId: c.id },
      select: { id: true, firstName: true, lastName: true, birthDate: true },
      orderBy: { id: "asc" },
      take: 20,
    }),
  ]);
  return {
    customerId: c.id,
    abos: abos.map((t) => ({ ticketId: t.id, aboName: t.subscription?.name ?? "Abo", endDate: t.endDate, lastName: t.lastName })),
    persons: persons
      .map((p) => ({
        id: p.id,
        name: [p.firstName, p.lastName].filter((v) => v?.trim()).join(" ").trim() || (p.id === me.id ? "Ich" : "Ohne Namen"),
        birthDate: p.birthDate,
      }))
      .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id)),
  };
}
