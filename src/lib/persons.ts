import { prisma } from "@/lib/prisma";
import { controlShelly } from "@/lib/shelly";
import {
  maybeSurveillanceAlert,
  maybeSurveillanceTelegramAlert,
} from "@/lib/surveillance";
import { sendPushToAccount } from "@/lib/web-push";
import { storeSightingSnapshot } from "@/lib/blob-store";

const SHELLY_ACTIONS = ["ON", "OFF", "TOGGLE"] as const;
export const PERSON_LIST_TYPES = ["WHITELIST", "BLACKLIST"] as const;
export type PersonListType = (typeof PERSON_LIST_TYPES)[number];

const EMBEDDING_DIMS = 512;

export function floatsToEmbeddingBytes(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i++) buf.writeFloatLE(values[i], i * 4);
  return buf;
}

export function embeddingBytesToFloats(bytes: Uint8Array | Buffer): number[] {
  const buf = Buffer.from(bytes);
  const out: number[] = [];
  for (let i = 0; i + 3 < buf.length; i += 4) out.push(buf.readFloatLE(i));
  return out;
}

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

/** Überwachungs-Push + Telegram für Personenerkennung (nicht für Whitelist). */
function firePersonSurveillanceAlerts(opts: {
  accountId: number;
  cameraId: number;
  snapshot: Uint8Array | null;
  detail: string;
  at: Date;
}) {
  maybeSurveillanceAlert({
    accountId: opts.accountId,
    cameraId: opts.cameraId,
    type: "PERSON",
    at: opts.at,
  }).catch((err) => console.error("[persons] surveillance push failed:", err));

  if (!opts.snapshot?.length) return;
  maybeSurveillanceTelegramAlert({
    accountId: opts.accountId,
    cameraId: opts.cameraId,
    type: "PERSON",
    snapshot: opts.snapshot,
    detail: opts.detail,
    at: opts.at,
  }).catch((err) => console.error("[persons] surveillance telegram failed:", err));
}

/**
 * PERSON-Ereignis mit optionalem Face-Match vom Hub.
 * Shelly nur bei Identity-Match + triggerOnDetection.
 */
export async function processCameraPersonEvent(opts: {
  accountId: number;
  cameraId: number;
  seenAt?: Date;
  snapshot?: Buffer | null;
  matchedPersonId?: number | null;
  matchScore?: number | null;
  matchMethod?: string | null;
}): Promise<{ sightings: number; triggered: number }> {
  const seenAt = opts.seenAt ?? new Date();
  const snapshot =
    opts.snapshot?.length ? new Uint8Array(opts.snapshot) : null;
  // Bild in den Blob-Speicher; die Bytes bleiben nur fuer Telegram/Push im Speicher.
  const storedSnapshot = await storeSightingSnapshot("person-sightings", opts.accountId, snapshot);

  let sightings = 0;
  let triggered = 0;

  if (opts.matchedPersonId) {
    const person = await prisma.listedPerson.findFirst({
      where: {
        id: opts.matchedPersonId,
        accountId: opts.accountId,
        isActive: true,
      },
      include: { shellyDevice: true },
    });
    if (!person) {
      // Fallback: anonym speichern
    } else {
      let shellyTriggered = false;
      let shellyOk: boolean | null = null;
      if (person.triggerOnDetection) {
        const r = await triggerShellyForPerson(opts.accountId, person, seenAt);
        shellyTriggered = r.shellyTriggered;
        shellyOk = r.shellyOk;
        if (r.shellyTriggered) triggered++;
      }

      if (person.notifyOnDetection) {
        const cam = await prisma.camera.findFirst({
          where: { id: opts.cameraId, accountId: opts.accountId },
          select: { name: true },
        });
        const scorePct =
          opts.matchScore != null ? ` (${Math.round(opts.matchScore * 100)}%)` : "";
        sendPushToAccount(opts.accountId, {
          title: `Person erkannt: ${person.name}`,
          body: `${cam?.name ?? "Kamera"}${scorePct}`,
          url: "/personen",
          tag: `person-match-${person.id}`,
        }).catch((err) => console.error("[persons] push failed:", err));
      }

      await prisma.personSighting.create({
        data: {
          accountId: opts.accountId,
          cameraId: opts.cameraId,
          listedPersonId: person.id,
          source: "CAMERA_PERSON",
          listType: person.listType,
          matched: true,
          matchScore: opts.matchScore ?? null,
          matchMethod: opts.matchMethod ?? "FACE_EMBEDDING",
          shellyTriggered,
          shellyOk,
          seenAt,
          ...storedSnapshot,
        },
        // select {id}: RETURNING soll die Snapshot-Bytes nicht zurueckuebertragen.
        select: { id: true },
      });
      sightings++;

      // Überwachung: Whitelist-Personen weder Push noch Telegram.
      if (person.listType !== "WHITELIST") {
        const scorePct =
          opts.matchScore != null ? `${Math.round(opts.matchScore * 100)}% Match` : null;
        firePersonSurveillanceAlerts({
          accountId: opts.accountId,
          cameraId: opts.cameraId,
          snapshot,
          detail: [person.name, person.listType, scorePct].filter(Boolean).join(" · "),
          at: seenAt,
        });
      }

      return { sightings, triggered };
    }
  }

  // Unbekannt: Historie mit Snapshot (oder wenn irgendwo trackHistory aktiv).
  const trackers = await prisma.listedPerson.count({
    where: {
      accountId: opts.accountId,
      isActive: true,
      trackHistory: true,
    },
  });
  if (!snapshot && trackers === 0) return { sightings: 0, triggered: 0 };

  await prisma.personSighting.create({
    data: {
      accountId: opts.accountId,
      cameraId: opts.cameraId,
      source: "CAMERA_PERSON",
      listType: null,
      matched: false,
      matchScore: opts.matchScore ?? null,
      matchMethod: null,
      seenAt,
      ...storedSnapshot,
    },
    // select {id}: RETURNING soll die Snapshot-Bytes nicht zurueckuebertragen.
    select: { id: true },
  });
  sightings++;

  firePersonSurveillanceAlerts({
    accountId: opts.accountId,
    cameraId: opts.cameraId,
    snapshot,
    detail: "Unbekannte Person",
    at: seenAt,
  });

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
      matchMethod: "MANUAL",
      shellyTriggered,
      shellyOk,
      notes: opts.notes?.trim() || null,
      seenAt,
    },
  });

  return { sightingId: sighting.id, shellyTriggered, shellyOk };
}

/** Bestehende anonyme/Kamera-Sichtung einer ListedPerson zuordnen + FACE_ENROLL Task. */
export async function assignPersonToSighting(opts: {
  accountId: number;
  sightingId: number;
  listedPersonId: number;
}): Promise<{
  id: number;
  listedPersonId: number;
  listType: string;
  matched: boolean;
  enrollTaskId: number | null;
}> {
  const sighting = await prisma.personSighting.findFirst({
    where: { id: opts.sightingId, accountId: opts.accountId },
    select: { id: true, snapshotBlob: true, snapshot: true },
  });
  if (!sighting) throw new Error("Sichtung nicht gefunden");
  const hasSnapshot = Boolean(sighting.snapshotBlob) || Boolean(sighting.snapshot?.length);

  const person = await prisma.listedPerson.findFirst({
    where: { id: opts.listedPersonId, accountId: opts.accountId },
    select: { id: true, listType: true },
  });
  if (!person) throw new Error("Person nicht gefunden");

  const updated = await prisma.personSighting.update({
    where: { id: sighting.id },
    data: {
      listedPersonId: person.id,
      listType: person.listType,
      matched: true,
      matchMethod: "MANUAL",
    },
    select: {
      id: true,
      listedPersonId: true,
      listType: true,
      matched: true,
    },
  });

  let enrollTaskId: number | null = null;
  if (hasSnapshot) {
    const task = await prisma.hubTask.create({
      data: {
        accountId: opts.accountId,
        type: "FACE_ENROLL",
        payload: {
          sightingId: sighting.id,
          listedPersonId: person.id,
        },
      },
      select: { id: true },
    });
    enrollTaskId = task.id;
  }

  return {
    id: updated.id,
    listedPersonId: updated.listedPersonId!,
    listType: updated.listType!,
    matched: updated.matched,
    enrollTaskId,
  };
}

export async function storePersonFaceEmbedding(opts: {
  accountId: number;
  listedPersonId: number;
  embedding: number[];
  model?: string;
  sourceSightingId?: number | null;
}): Promise<{ id: number }> {
  if (opts.embedding.length < 64) {
    throw new Error("Embedding zu kurz");
  }
  // Auf typische Dimensionalitaet begrenzen (buffalo_l = 512).
  const values = opts.embedding.slice(0, EMBEDDING_DIMS);
  const person = await prisma.listedPerson.findFirst({
    where: { id: opts.listedPersonId, accountId: opts.accountId },
    select: { id: true },
  });
  if (!person) throw new Error("Person nicht gefunden");

  const row = await prisma.personFaceEmbedding.create({
    data: {
      accountId: opts.accountId,
      listedPersonId: person.id,
      embedding: new Uint8Array(floatsToEmbeddingBytes(values)),
      model: opts.model ?? "buffalo_l",
      sourceSightingId: opts.sourceSightingId ?? null,
    },
    select: { id: true },
  });
  return row;
}
