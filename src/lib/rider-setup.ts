/**
 * Seite „Zugang einrichten“ (`/app/<token>/einrichten`) persönlich machen
 * (Aaron, 20.11.2026: „personalisiert“): wen der Link meint, welches Abo und
 * bei welchem Betrieb.
 */
import { prisma } from "./prisma";
import { isAdultAt, isKidsSubscriptionName } from "./customer-person";
import { berlinYmd } from "./berlin-day";

const ABO_STATUS = ["VALID", "REDEEMED", "PAUSED"] as const;

export interface SetupGreeting {
  /** Vorname der Person; null, wenn keiner bekannt ist. */
  firstName: string | null;
  accountName: string;
  abo: { name: string; endDate: Date | null } | null;
  /** Volljährig (Geburtsdatum der Person); null, wenn unbekannt. */
  adult: boolean | null;
  /** Kids Abo: das Abo eines Kindes. */
  kids: boolean;
}

export async function setupGreeting(profileId: number, now: Date = new Date()): Promise<SetupGreeting | null> {
  const p = await prisma.riderProfile.findUnique({
    where: { id: profileId },
    select: {
      firstName: true,
      birthDate: true,
      account: { select: { name: true } },
      tickets: {
        where: { subscriptionId: { not: null } },
        select: { firstName: true, status: true, endDate: true, subscription: { select: { name: true } } },
        orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { id: "desc" }],
        take: 10,
      },
    },
  });
  if (!p) return null;
  // Laufendes Abo zuerst, sonst das zuletzt gültige.
  const abo = p.tickets.find((t) => (ABO_STATUS as readonly string[]).includes(t.status)) ?? p.tickets[0] ?? null;
  const first = p.firstName?.trim() || abo?.firstName?.trim() || null;
  return {
    firstName: first ? first.split(/\s+/)[0] : null,
    accountName: p.account.name,
    abo: abo ? { name: abo.subscription?.name ?? "Abo", endDate: abo.endDate } : null,
    adult: isAdultAt(p.birthDate, now),
    kids: isKidsSubscriptionName(abo?.subscription?.name),
  };
}

/** „Dein Ride Abo läuft bis 28.02.2027.“ und Varianten. */
export function aboSentence(abo: SetupGreeting["abo"], whose: string, now: Date = new Date()): string | null {
  if (!abo) return null;
  if (!abo.endDate) return `${whose} ${abo.name} läuft ohne Enddatum.`;
  const [y, m, d] = berlinYmd(abo.endDate).split("-");
  return abo.endDate.getTime() < now.getTime()
    ? `${whose} ${abo.name} lief bis ${d}.${m}.${y}.`
    : `${whose} ${abo.name} läuft bis ${d}.${m}.${y}.`;
}
