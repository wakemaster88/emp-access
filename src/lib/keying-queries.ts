/**
 * Geteilte Prisma-Includes der Schliessanlage. Liegen bewusst hier und nicht in
 * den Route-Dateien: `route.ts` darf nur HTTP-Handler exportieren.
 */

export const lockWithPathInclude = {
  door: { include: { room: true } },
} as const;

export const roomInclude = {
  doors: {
    include: { locks: { orderBy: { id: "asc" as const } } },
    orderBy: { name: "asc" as const },
  },
} as const;

export const doorInclude = {
  room: true,
  locks: { orderBy: { id: "asc" as const } },
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
