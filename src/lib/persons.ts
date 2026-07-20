import { prisma } from "@/lib/prisma";
import { controlShelly } from "@/lib/shelly";

const SHELLY_ACTIONS = ["ON", "OFF", "TOGGLE"] as const;
export const PERSON_LIST_TYPES = ["WHITELIST", "BLACKLIST"] as const;
export type PersonListType = (typeof PERSON_LIST_TYPES)[number];

async function triggerShellyForPerson(
  accountId: number,
  person: {
    id: number;
    shellyDeviceId: number | null;
    shellyAction: string;
    timerSeconds: number | null;
    cooldownMinutes: number;
    lastTriggeredAt: Date | null;
    shellyDevice: {
      ipAddress: string | null;
      shellyId: string | null;
      shellyAuthKey: string | null;
    } | null;
  },
  seenAt: Date
): Promise<{ shellyTriggered: boolean; shellyOk: boolean | null }> {
  if (!person.shellyDeviceId || !person.shellyDevice) {
    return { shellyTriggered: false, shellyOk: null };
  }

  const cooldownMs = Math.max(1, person.cooldownMinutes) * 60_000;
  if (
    person.lastTriggeredAt &&
    seenAt.getTime() - person.lastTriggeredAt.getTime() < cooldownMs
  ) {
    return { shellyTriggered: false, shellyOk: null };
  }

  const action = (
    SHELLY_ACTIONS.includes(person.shellyAction as (typeof SHELLY_ACTIONS)[number])
      ? person.shellyAction
      : "ON"
  ).toLowerCase() as "on" | "off" | "toggle";

  const cloud = await prisma.apiConfig.findFirst({
    where: { accountId, provider: "SHELLY" },
    select: { baseUrl: true },
  });

  const shellyOk = await controlShelly(
    {
      ipAddress: person.shellyDevice.ipAddress,
      shellyId: person.shellyDevice.shellyId,
      shellyAuthKey: person.shellyDevice.shellyAuthKey,
      cloudServer: cloud?.baseUrl ?? undefined,
    },
    action,
    person.timerSeconds ?? undefined
  );

  await prisma.listedPerson.update({
    where: { id: person.id },
    data: { lastTriggeredAt: seenAt },
  });

  return { shellyTriggered: true, shellyOk };
}

/**
 * PERSON-Ereignis einer Kamera (idealerweise mit Gesichtsschnappschuss).
 * Mit Snapshot: immer Historie-Eintrag unter Personen.
 * Shelly nur fuer Eintraege mit triggerOnDetection an genau dieser Kamera.
 */
export async function processCameraPersonEvent(opts: {
  accountId: number;
  cameraId: number;
  seenAt?: Date;
  snapshot?: Buffer | null;
}): Promise<{ sightings: number; triggered: number }> {
  const seenAt = opts.seenAt ?? new Date();
  const snapshot = opts.snapshot?.length ? opts.snapshot : null;

  const people = await prisma.listedPerson.findMany({
    where: {
      accountId: opts.accountId,
      isActive: true,
      cameraId: opts.cameraId,
      OR: [{ trackHistory: true }, { triggerOnDetection: true }],
    },
    include: { shellyDevice: true },
  });

  let sightings = 0;
  let triggered = 0;

  // Snapshot allein reicht fuer Historie; sonst nur wenn trackHistory konfiguriert.
  const trackAnonymous =
    Boolean(snapshot) || people.some((p) => p.trackHistory);

  if (trackAnonymous) {
    const preferBlacklist = people.some((p) => p.listType === "BLACKLIST" && p.trackHistory);
    const hasTracked = people.some((p) => p.trackHistory);
    await prisma.personSighting.create({
      data: {
        accountId: opts.accountId,
        cameraId: opts.cameraId,
        source: "CAMERA_PERSON",
        listType: preferBlacklist ? "BLACKLIST" : hasTracked ? "WHITELIST" : null,
        matched: false,
        seenAt,
        ...(snapshot ? { snapshot } : {}),
      },
    });
    sightings++;
  }

  for (const person of people.filter((p) => p.triggerOnDetection)) {
    const r = await triggerShellyForPerson(opts.accountId, person, seenAt);
    if (!r.shellyTriggered && r.shellyOk == null) continue;

    await prisma.personSighting.create({
      data: {
        accountId: opts.accountId,
        cameraId: opts.cameraId,
        listedPersonId: person.id,
        source: "CAMERA_PERSON",
        listType: person.listType,
        matched: true,
        shellyTriggered: r.shellyTriggered,
        shellyOk: r.shellyOk,
        seenAt,
        ...(snapshot ? { snapshot } : {}),
      },
    });
    sightings++;
    if (r.shellyTriggered) triggered++;
  }

  return { sightings, triggered };
}

/** Manuelle Sichtung einer konkreten List-Person (z. B. Hausverbot bestätigt). */
export async function processManualPersonSighting(opts: {
  accountId: number;
  listedPersonId: number;
  cameraId?: number | null;
  notes?: string | null;
  seenAt?: Date;
  triggerShelly?: boolean;
}): Promise<{
  sightingId: number;
  shellyTriggered: boolean;
  shellyOk: boolean | null;
}> {
  const seenAt = opts.seenAt ?? new Date();
  const person = await prisma.listedPerson.findFirst({
    where: { id: opts.listedPersonId, accountId: opts.accountId },
    include: { shellyDevice: true },
  });
  if (!person) throw new Error("Person nicht gefunden");

  let shellyTriggered = false;
  let shellyOk: boolean | null = null;

  if (opts.triggerShelly !== false && person.shellyDeviceId) {
    await prisma.listedPerson.update({
      where: { id: person.id },
      data: { lastTriggeredAt: null },
    });
    const refreshed = { ...person, lastTriggeredAt: null };
    const r = await triggerShellyForPerson(opts.accountId, refreshed, seenAt);
    shellyTriggered = r.shellyTriggered;
    shellyOk = r.shellyOk;
  }

  const sighting = await prisma.personSighting.create({
    data: {
      accountId: opts.accountId,
      cameraId: opts.cameraId ?? person.cameraId,
      listedPersonId: person.id,
      source: "MANUAL",
      listType: person.listType,
      matched: true,
      shellyTriggered,
      shellyOk,
      notes: opts.notes?.trim() || null,
      seenAt,
    },
  });

  return { sightingId: sighting.id, shellyTriggered, shellyOk };
}
