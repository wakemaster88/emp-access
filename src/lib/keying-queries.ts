/**
 * Geteilte Prisma-Includes der Schliessanlage. Liegen bewusst hier und nicht in
 * den Route-Dateien: `route.ts` darf nur HTTP-Handler exportieren.
 */

import type { TenantDb } from "./prisma";

/** Geraete-/Kamerakennung, wie sie in der Schliessanlage angezeigt wird. */
export const deviceSummarySelect = {
  id: true,
  name: true,
  type: true,
  category: true,
} as const;

export const cameraSummarySelect = {
  id: true,
  name: true,
  kind: true,
} as const;

export const lockWithPathInclude = {
  door: { include: { room: true } },
  device: { select: deviceSummarySelect },
} as const;

const locksWithDevice = {
  include: { device: { select: deviceSummarySelect } },
  orderBy: { id: "asc" as const },
} as const;

export const roomInclude = {
  doors: {
    include: { locks: locksWithDevice },
    orderBy: { name: "asc" as const },
  },
  devices: { select: deviceSummarySelect, orderBy: { name: "asc" as const } },
  cameras: { select: cameraSummarySelect, orderBy: { name: "asc" as const } },
} as const;

export const doorInclude = {
  room: true,
  locks: locksWithDevice,
} as const;

export const keyItemInclude = {
  locks: { include: { lock: { include: lockWithPathInclude } } },
} as const;

export const holderTicketSelect = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  ticketTypeName: true,
} as const;

export const holderInclude = {
  ticket: { select: holderTicketSelect },
} as const;

export const handoverInclude = {
  holder: { include: holderInclude },
  policyTemplate: { select: { id: true, name: true, version: true } },
  items: {
    include: { key: { include: keyItemInclude } },
    orderBy: { id: "asc" as const },
  },
  signatures: {
    select: {
      id: true,
      kind: true,
      token: true,
      expiresAt: true,
      signedName: true,
      signedAt: true,
      createdAt: true,
      pdf: false,
    },
    orderBy: { id: "desc" as const },
  },
} as const;

/**
 * Setzt Geraete- und Kamera-Zuordnung eines Raums vollersetzend: was nicht mehr
 * in der Liste steht, faellt auf "kein Raum" zurueck. Ein Geraet haengt immer
 * nur in genau einem Raum, deshalb genuegen Updates auf der Fremdschluessel-
 * spalte statt einer eigenen Zuordnungstabelle.
 */
export async function syncRoomEquipment(
  db: TenantDb,
  accountId: number,
  roomId: number,
  input: { deviceIds?: number[]; cameraIds?: number[] },
): Promise<void> {
  if (input.deviceIds) {
    const next = [...new Set(input.deviceIds)];
    await db.device.updateMany({
      where: { accountId, keyRoomId: roomId, ...(next.length && { id: { notIn: next } }) },
      data: { keyRoomId: null },
    });
    if (next.length) {
      await db.device.updateMany({
        where: { accountId, id: { in: next } },
        data: { keyRoomId: roomId },
      });
    }
  }

  if (input.cameraIds) {
    const next = [...new Set(input.cameraIds)];
    await db.camera.updateMany({
      where: { accountId, keyRoomId: roomId, ...(next.length && { id: { notIn: next } }) },
      data: { keyRoomId: null },
    });
    if (next.length) {
      await db.camera.updateMany({
        where: { accountId, id: { in: next } },
        data: { keyRoomId: roomId },
      });
    }
  }
}

/** Lesbarer Pfad eines Schlosses: "Gebäude · Raum · Tür (Schließung)". */
export function lockPathLabel(lock: {
  lockNumber: string | null;
  door: { name: string; doorNumber: string | null; room: { name: string; building: string | null } | null };
}): string {
  const parts = [
    lock.door.room?.building,
    lock.door.room?.name,
    lock.door.doorNumber ? `${lock.door.name} (${lock.door.doorNumber})` : lock.door.name,
  ].filter(Boolean);
  const path = parts.join(" · ");
  return lock.lockNumber ? `${path} [${lock.lockNumber}]` : path;
}
