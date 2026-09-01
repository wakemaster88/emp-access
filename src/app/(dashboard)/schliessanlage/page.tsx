import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { SchliessanlageClient } from "@/components/schliessanlage/schliessanlage-client";
import type {
  CameraOption,
  DeviceOption,
  DoorRow,
  HandoverRow,
  KeyRow,
  LockOption,
  RoomRow,
} from "@/components/schliessanlage/types";
import { safeAuth } from "@/lib/auth";
import { holderDisplayName } from "@/lib/keying";
import { lockPathLabel } from "@/lib/keying-queries";
import { superAdminClient, tenantClient, type TenantDb } from "@/lib/prisma";

export default async function SchliessanlagePage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  // Explizit als `TenantDb` typisiert: bei der Menge an Queries auf dieser
  // Seite laeuft TypeScript sonst beim strukturellen Vergleich der beiden
  // Client-Typen in "excessive stack depth" (vgl. Hinweis in lib/prisma.ts).
  const db: TenantDb = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [rooms, doors, locks, keys, holders, employees, policies, handovers] = await Promise.all([
    db.keyRoom.findMany({
      where: accountFilter,
      orderBy: [{ building: "asc" }, { name: "asc" }],
    }),
    db.keyDoor.findMany({
      where: accountFilter,
      include: { locks: { include: { _count: { select: { keys: true } } }, orderBy: { id: "asc" } } },
      orderBy: [{ name: "asc" }],
    }),
    db.keyLock.findMany({
      where: accountFilter,
      include: { door: { include: { room: true } } },
      orderBy: [{ doorId: "asc" }, { id: "asc" }],
    }),
    db.keyItem.findMany({
      where: accountFilter,
      include: { locks: { include: { lock: { include: { door: { include: { room: true } } } } } } },
      orderBy: [{ keyNumber: "asc" }],
    }),
    db.keyHolder.findMany({
      where: accountFilter,
      orderBy: [{ lastName: "asc" }, { company: "asc" }],
    }),
    // Mitarbeiter sind Tickets mit source = EMP_CONTROL (siehe /employees).
    db.ticket.findMany({
      where: { ...accountFilter, source: "EMP_CONTROL" },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        email: true,
        ticketTypeName: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { name: "asc" }],
    }),
    db.keyPolicyTemplate.findMany({
      where: accountFilter,
      orderBy: [{ name: "asc" }, { version: "desc" }],
    }),
    db.keyHandover.findMany({
      where: accountFilter,
      include: {
        holder: true,
        policyTemplate: { select: { id: true, name: true, version: true } },
        items: { include: { key: true }, orderBy: { id: "asc" } },
        signatures: {
          select: {
            id: true,
            kind: true,
            token: true,
            expiresAt: true,
            signedAt: true,
            signedName: true,
            createdAt: true,
          },
          orderBy: { id: "desc" },
        },
      },
      orderBy: { issuedAt: "desc" },
    }),
  ]);

  // Getrennt geladen: hält die Tupel-Inferenz des grossen Promise.all klein.
  const [devices, cameras] = await Promise.all([
    db.device.findMany({
      where: accountFilter,
      select: { id: true, name: true, type: true, category: true, keyRoomId: true },
      orderBy: { name: "asc" },
    }),
    db.camera.findMany({
      where: accountFilter,
      select: { id: true, name: true, kind: true, keyRoomId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const deviceOptions: DeviceOption[] = devices.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    category: d.category,
    roomId: d.keyRoomId,
  }));
  const cameraOptions: CameraOption[] = cameras.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    roomId: c.keyRoomId,
  }));

  const doorRows: DoorRow[] = doors.map((d) => ({
    id: d.id,
    roomId: d.roomId,
    name: d.name,
    doorNumber: d.doorNumber,
    notes: d.notes,
    locks: d.locks.map((l) => ({
      id: l.id,
      doorId: l.doorId,
      lockNumber: l.lockNumber,
      lockType: l.lockType,
      system: l.system,
      manufacturer: l.manufacturer,
      installedAt: l.installedAt ? l.installedAt.toISOString() : null,
      notes: l.notes,
      keyCount: l._count.keys,
      deviceId: l.deviceId,
    })),
  }));

  const roomRows: RoomRow[] = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    number: r.number,
    building: r.building,
    floor: r.floor,
    notes: r.notes,
    doors: doorRows.filter((d) => d.roomId === r.id),
  }));

  const lockOptions: LockOption[] = locks.map((l) => ({
    id: l.id,
    label: lockPathLabel(l),
  }));
  const lockLabelById = new Map(lockOptions.map((l) => [l.id, l.label]));

  const keyRows: KeyRow[] = keys.map((k) => ({
    id: k.id,
    keyNumber: k.keyNumber,
    label: k.label,
    level: k.level,
    status: k.status,
    notes: k.notes,
    lockIds: k.locks.map((l) => l.lockId),
    lockLabels: k.locks.map((l) => lockLabelById.get(l.lockId) ?? lockPathLabel(l.lock)),
  }));

  const handoverRows: HandoverRow[] = handovers.map((h) => ({
    id: h.id,
    holderId: h.holderId,
    holderName: holderDisplayName(h.holder),
    holderEmail: h.holder.email,
    issuedAt: h.issuedAt.toISOString(),
    issuedByName: h.issuedByName,
    dueAt: h.dueAt ? h.dueAt.toISOString() : null,
    deposit: h.deposit,
    status: h.status,
    notes: h.notes,
    policy: h.policyTemplate,
    items: h.items.map((i) => ({
      id: i.id,
      keyId: i.keyId,
      keyNumber: i.key.keyNumber,
      keyLabel: i.key.label,
      level: i.key.level,
      itemStatus: i.itemStatus,
      returnedAt: i.returnedAt ? i.returnedAt.toISOString() : null,
    })),
    signatures: h.signatures.map((s) => ({
      id: s.id,
      kind: s.kind,
      token: s.token,
      expiresAt: s.expiresAt.toISOString(),
      signedAt: s.signedAt ? s.signedAt.toISOString() : null,
      signedName: s.signedName,
      createdAt: s.createdAt.toISOString(),
    })),
  }));

  return (
    <>
      <Header title="Schließanlage" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <SchliessanlageClient
          data={{
            rooms: roomRows,
            looseDoors: doorRows.filter((d) => d.roomId === null),
            lockOptions,
            deviceOptions,
            cameraOptions,
            keys: keyRows,
            holders: holders.map((h) => ({
              id: h.id,
              ticketId: h.ticketId,
              firstName: h.firstName,
              lastName: h.lastName,
              company: h.company,
              email: h.email,
              phone: h.phone,
              displayName: holderDisplayName(h),
            })),
            employees: employees.map((e) => ({
              id: e.id,
              name: [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name,
              email: e.email,
              ticketTypeName: e.ticketTypeName,
            })),
            policies: policies.map((p) => ({
              id: p.id,
              name: p.name,
              version: p.version,
              bodyText: p.bodyText,
              liabilityText: p.liabilityText,
              isActive: p.isActive,
              createdAt: p.createdAt.toISOString(),
            })),
            handovers: handoverRows,
          }}
          readonly={isSuperAdmin}
        />
      </div>
    </>
  );
}
