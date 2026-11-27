import { Prisma } from "@prisma/client";
import { prisma, type TenantDb } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/day-guest";
import { ANNY_CONSENT_TEXT, SYSTEM_GROUP_NAME, annyGroupPlan, type AnnyAboContact, type SystemGroupKey } from "./rules";

/**
 * Gruppen der Abonnenten mit Datenbank. Feste Gruppen („Website“, „Abos aus
 * anny“) legt emp-access bei Bedarf selbst an; eigene Gruppen legt die
 * Verwaltung an. Läuft mit dem rohen Client (Cron, öffentliche Anmeldung)
 * und filtert selbst nach accountId.
 */

/** ID der festen Gruppe; legt sie beim ersten Mal an. */
export async function ensureSystemGroup(accountId: number, key: SystemGroupKey): Promise<number> {
  const found = await prisma.newsletterGroup.findUnique({ where: { accountId_key: { accountId, key } }, select: { id: true } });
  if (found) return found.id;
  const name = SYSTEM_GROUP_NAME[key];
  // Eine eigene Gruppe mit demselben Namen wird zur festen Gruppe.
  const sameName = await prisma.newsletterGroup.findUnique({
    where: { accountId_name: { accountId, name } },
    select: { id: true, key: true },
  });
  if (sameName && !sameName.key) {
    await prisma.newsletterGroup.update({ where: { id: sameName.id }, data: { key } });
    return sameName.id;
  }
  try {
    const created = await prisma.newsletterGroup.create({ data: { accountId, key, name }, select: { id: true } });
    return created.id;
  } catch (err) {
    // Gleichzeitig angelegt: die andere Anfrage hat gewonnen.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await prisma.newsletterGroup.findUnique({ where: { accountId_key: { accountId, key } }, select: { id: true } });
      if (again) return again.id;
    }
    throw err;
  }
}

/** Abonnenten einer Gruppe zuordnen (schon zugeordnete bleiben). */
export async function addGroupMembers(accountId: number, groupId: number, subscriberIds: number[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < subscriberIds.length; i += 1_000) {
    const r = await prisma.newsletterGroupMember.createMany({
      data: subscriberIds.slice(i, i + 1_000).map((subscriberId) => ({ accountId, groupId, subscriberId })),
      skipDuplicates: true,
    });
    added += r.count;
  }
  return added;
}

/** Nach so langer Zeit gleicht der Cron die Gruppe „Abos aus anny“ erneut ab. */
export const ANNY_SYNC_EVERY_MS = 60 * 60 * 1000;

export interface AnnySyncResult {
  abos: number;
  created: number;
  members: number;
  removed: number;
}

/**
 * Gruppe „Abos aus anny“ mit den laufenden anny-Abos abgleichen. Nur wenn
 * der Schalter in den Einstellungen an ist. Neue Adressen kommen als
 * angemeldet hinein (Bestandskunden); wer sich abgemeldet hat, bleibt
 * abgemeldet. Endet ein Abo, verlässt die Person nur die Gruppe.
 */
export async function syncAnnyAboGroup(accountId: number, now: Date = new Date()): Promise<AnnySyncResult | null> {
  const config = await prisma.newsletterConfig.findUnique({ where: { accountId }, select: { annyAutoSubscribe: true } });
  if (!config?.annyAutoSubscribe) return null;

  const tickets = await prisma.ticket.findMany({
    where: {
      accountId,
      source: "ANNY",
      subscriptionId: { not: null },
      status: { in: ["VALID", "REDEEMED", "PAUSED"] },
      OR: [{ endDate: null }, { endDate: { gt: now } }],
      email: { not: null },
    },
    select: { email: true, firstName: true, lastName: true, name: true },
  });
  const abos: AnnyAboContact[] = [];
  for (const t of tickets) {
    const email = normalizeEmail(t.email);
    if (!email) continue;
    const name = [t.firstName, t.lastName].map((v) => v?.trim()).filter(Boolean).join(" ") || t.name.trim() || null;
    abos.push({ email, name: name ? name.slice(0, 100) : null });
  }

  const groupId = await ensureSystemGroup(accountId, "anny-abos");
  const emails = [...new Set(abos.map((a) => a.email))];
  const [subscribers, members] = await Promise.all([
    emails.length
      ? prisma.newsletterSubscriber.findMany({ where: { accountId, email: { in: emails } }, select: { id: true, email: true } })
      : Promise.resolve([]),
    prisma.newsletterGroupMember.findMany({ where: { accountId, groupId }, select: { subscriberId: true } }),
  ]);
  const plan = annyGroupPlan(abos, subscribers, members.map((m) => m.subscriberId));

  let created = 0;
  const memberIds = [...plan.memberIds];
  if (plan.create.length) {
    const r = await prisma.newsletterSubscriber.createMany({
      data: plan.create.map((a) => ({
        accountId,
        email: a.email,
        name: a.name,
        source: "anny",
        status: "ACTIVE",
        consentText: ANNY_CONSENT_TEXT,
        consentAt: now,
      })),
      skipDuplicates: true,
    });
    created = r.count;
    const fresh = await prisma.newsletterSubscriber.findMany({
      where: { accountId, email: { in: plan.create.map((a) => a.email) } },
      select: { id: true },
    });
    memberIds.push(...fresh.map((s) => s.id));
  }
  await addGroupMembers(accountId, groupId, memberIds);
  if (plan.removeIds.length) {
    await prisma.newsletterGroupMember.deleteMany({ where: { accountId, groupId, subscriberId: { in: plan.removeIds } } });
  }
  await prisma.newsletterConfig.update({ where: { accountId }, data: { annySyncedAt: now } });
  return { abos: emails.length, created, members: memberIds.length, removed: plan.removeIds.length };
}

/** Für den Cron: alle Mandanten mit Schalter an, deren Abgleich älter als eine Stunde ist. */
export async function syncDueAnnyGroups(now: Date = new Date()): Promise<number> {
  const due = await prisma.newsletterConfig.findMany({
    where: {
      annyAutoSubscribe: true,
      OR: [{ annySyncedAt: null }, { annySyncedAt: { lt: new Date(now.getTime() - ANNY_SYNC_EVERY_MS) } }],
    },
    select: { accountId: true },
    take: 10,
  });
  let done = 0;
  for (const c of due) {
    try {
      if (await syncAnnyAboGroup(c.accountId, now)) done++;
    } catch (err) {
      console.error("[newsletter] Abgleich anny-Abos fehlgeschlagen:", err instanceof Error ? err.message : err);
    }
  }
  return done;
}

/** Wie viele angemeldete Abonnenten eine Aussendung an diese Gruppen erreicht (leer: alle). */
export function recipientsWhere(accountId: number, groupIds: number[]): Prisma.NewsletterSubscriberWhereInput {
  return {
    accountId,
    status: "ACTIVE",
    ...(groupIds.length ? { groups: { some: { groupId: { in: groupIds }, accountId } } } : {}),
  };
}

export interface GroupCounts {
  id: number;
  name: string;
  key: string | null;
  /** Alle Mitglieder, auch abgemeldete. */
  members: number;
  /** Davon angemeldet. */
  active: number;
}

/** Gruppen des Mandanten mit Anzahl der Mitglieder (alle und angemeldete). */
export async function loadGroupRows(db: TenantDb, accountId: number): Promise<GroupCounts[]> {
  const [groups, all, active] = await Promise.all([
    db.newsletterGroup.findMany({ where: { accountId }, orderBy: { name: "asc" }, select: { id: true, name: true, key: true } }),
    db.newsletterGroupMember.groupBy({ by: ["groupId"], where: { accountId }, _count: { _all: true } }),
    db.newsletterGroupMember.groupBy({ by: ["groupId"], where: { accountId, subscriber: { status: "ACTIVE" } }, _count: { _all: true } }),
  ]);
  return groups.map((g) => ({
    ...g,
    members: all.find((c) => c.groupId === g.id)?._count._all ?? 0,
    active: active.find((c) => c.groupId === g.id)?._count._all ?? 0,
  }));
}
