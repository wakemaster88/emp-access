"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Cctv,
  ChevronDown,
  ChevronRight,
  Cpu,
  DoorOpen,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DoorDialog } from "@/components/schliessanlage/door-dialog";
import { LockDialog } from "@/components/schliessanlage/lock-dialog";
import { RoomDialog } from "@/components/schliessanlage/room-dialog";
import {
  EmptyHint,
  ErrorLine,
  apiRequest,
  deviceMetaLabel,
  lockTypeLabel,
} from "@/components/schliessanlage/shared";
import type {
  CameraOption,
  DeviceOption,
  DoorRow,
  LockRow,
  RoomRow,
} from "@/components/schliessanlage/types";
import { cn } from "@/lib/utils";

interface Props {
  rooms: RoomRow[];
  looseDoors: DoorRow[];
  devices: DeviceOption[];
  cameras: CameraOption[];
  readonly: boolean;
}

export function RoomsTab({ rooms, looseDoors, devices, cameras, readonly }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [roomDialog, setRoomDialog] = useState<{ room: RoomRow | null } | null>(null);
  const [doorDialog, setDoorDialog] = useState<{ door: DoorRow | null; roomId: number | null } | null>(null);
  const [lockDialog, setLockDialog] = useState<{ lock: LockRow | null; doorId: number } | null>(null);
  const [error, setError] = useState("");

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function remove(url: string, question: string) {
    if (!confirm(question)) return;
    setError("");
    const res = await apiRequest(url, "DELETE");
    if (!res.ok) setError(res.message);
    else router.refresh();
  }

  const doorCount = rooms.reduce((sum, r) => sum + r.doors.length, 0) + looseDoors.length;
  const roomNames = new Map(rooms.map((r) => [r.id, r.name]));
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  const renderDoor = (door: DoorRow) => (
    <div
      key={door.id}
      className="rounded-md border border-border bg-white p-2 dark:border-border dark:bg-card/40"
    >
      <div className="flex items-start gap-2">
        <DoorOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground/90">
            {door.name}
            {door.doorNumber && (
              <span className="ml-1.5 font-mono text-[11px] text-muted-foreground/70">{door.doorNumber}</span>
            )}
          </p>
          {door.notes && <p className="truncate text-[11px] text-muted-foreground/70">{door.notes}</p>}
        </div>
        {!readonly && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setLockDialog({ lock: null, doorId: door.id })}
              className="p-1 text-muted-foreground/70 hover:text-primary"
              title="Schloss hinzufügen"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setDoorDialog({ door, roomId: door.roomId })}
              className="p-1 text-muted-foreground/70 hover:text-primary"
              title="Tür bearbeiten"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                remove(
                  `/api/schliessanlage/doors/${door.id}`,
                  `Tür "${door.name}" inkl. ihrer Schlösser wirklich löschen?`,
                )
              }
              className="p-1 text-muted-foreground/70 hover:text-destructive"
              title="Tür löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {door.locks.length > 0 && (
        <div className="mt-1.5 space-y-1 pl-6">
          {door.locks.map((lock) => (
            <div
              key={lock.id}
              className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1 dark:bg-muted/50"
            >
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
              <span className="font-mono text-[11px] text-foreground/80">
                {lock.lockNumber || "ohne Nummer"}
              </span>
              <span className="text-[10px] text-muted-foreground/70">{lockTypeLabel(lock.lockType)}</span>
              {lock.system && <span className="truncate text-[10px] text-muted-foreground/70">· {lock.system}</span>}
              {lock.deviceId != null && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-primary"
                  title="Wird elektronisch geöffnet"
                >
                  <Zap className="h-2.5 w-2.5" />
                  {deviceById.get(lock.deviceId)?.name ?? "Gerät"}
                </span>
              )}
              <span
                className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70"
                title={`${lock.keyCount} Schlüssel zugeordnet`}
              >
                <KeyRound className="h-2.5 w-2.5" />
                {lock.keyCount}
              </span>
              {!readonly && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setLockDialog({ lock, doorId: door.id })}
                    className="p-0.5 text-muted-foreground/70 hover:text-primary"
                    title="Schloss bearbeiten"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      remove(
                        `/api/schliessanlage/locks/${lock.id}`,
                        `Schloss "${lock.lockNumber || lock.id}" wirklich löschen? Schlüssel bleiben erhalten, verlieren aber diese Zuordnung.`,
                      )
                    }
                    className="p-0.5 text-muted-foreground/70 hover:text-destructive"
                    title="Schloss löschen"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base sm:text-xl">
              {rooms.length} Räume · {doorCount} Türen
            </CardTitle>
            <CardDescription>
              Struktur der Anlage: Räume enthalten Türen, Türen enthalten Schlösser. Türen ohne Raum
              sind Gemeinschafts- oder Außentüren.
            </CardDescription>
          </div>
          {!readonly && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDoorDialog({ door: null, roomId: null })}
                className="h-8"
              >
                <DoorOpen className="mr-1 h-3.5 w-3.5" />
                Tür
              </Button>
              <Button
                size="sm"
                onClick={() => setRoomDialog({ room: null })}
                className="h-8 bg-primary hover:bg-primary/90"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Raum
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        <ErrorLine message={error} />

        {rooms.length === 0 && looseDoors.length === 0 && (
          <EmptyHint>Noch keine Räume angelegt. Beginne mit einem Raum oder einer Außentür.</EmptyHint>
        )}

        {rooms.map((room) => {
          const isOpen = expanded.has(room.id);
          const roomDevices = devices.filter((d) => d.roomId === room.id);
          const roomCameras = cameras.filter((c) => c.roomId === room.id);
          return (
            <div
              key={room.id}
              className="rounded-md border border-border"
            >
              <div className="flex items-center gap-2 p-2">
                <button
                  type="button"
                  onClick={() => toggle(room.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                  )}
                  <Building2 className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium text-foreground/90">
                    {room.name}
                  </span>
                  {room.number && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{room.number}</span>
                  )}
                  <span className="shrink-0 text-[11px] text-muted-foreground/70">
                    {[room.building, room.floor].filter(Boolean).join(" · ")}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground/70">
                    {roomDevices.length > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5"
                        title={`${roomDevices.length} Geräte in diesem Raum`}
                      >
                        <Cpu className="h-3 w-3" />
                        {roomDevices.length}
                      </span>
                    )}
                    {roomCameras.length > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5"
                        title={`${roomCameras.length} Kameras für diesen Raum`}
                      >
                        <Cctv className="h-3 w-3" />
                        {roomCameras.length}
                      </span>
                    )}
                    <span>
                      {room.doors.length} {room.doors.length === 1 ? "Tür" : "Türen"}
                    </span>
                  </span>
                </button>
                {!readonly && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setDoorDialog({ door: null, roomId: room.id })}
                      className="p-1 text-muted-foreground/70 hover:text-primary"
                      title="Tür hinzufügen"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoomDialog({ room })}
                      className="p-1 text-muted-foreground/70 hover:text-primary"
                      title="Raum bearbeiten"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        remove(
                          `/api/schliessanlage/rooms/${room.id}`,
                          `Raum "${room.name}" wirklich löschen? Die Türen bleiben erhalten und rutschen auf "ohne Raum".`,
                        )
                      }
                      className="p-1 text-muted-foreground/70 hover:text-destructive"
                      title="Raum löschen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {isOpen && (
                <div className={cn("space-y-1.5 border-t border-border/60 p-2 dark:border-border")}>
                  {room.doors.length === 0 ? (
                    <p className="py-2 text-center text-[11px] text-muted-foreground/70">
                      Noch keine Tür in diesem Raum.
                    </p>
                  ) : (
                    room.doors.map(renderDoor)
                  )}

                  {(roomDevices.length > 0 || roomCameras.length > 0) && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {roomDevices.map((d) => (
                        <span
                          key={`d${d.id}`}
                          title={deviceMetaLabel(d.type, d.category)}
                          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-muted dark:text-foreground/80"
                        >
                          <Cpu className="h-2.5 w-2.5 text-muted-foreground/70" />
                          {d.name}
                        </span>
                      ))}
                      {roomCameras.map((c) => (
                        <span
                          key={`c${c.id}`}
                          title={c.kind}
                          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-muted dark:text-foreground/80"
                        >
                          <Cctv className="h-2.5 w-2.5 text-muted-foreground/70" />
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {looseDoors.length > 0 && (
          <div className="rounded-md border border-dashed border-input p-2 dark:border-border">
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              Türen ohne Raumzuordnung
            </p>
            <div className="space-y-1.5">{looseDoors.map(renderDoor)}</div>
          </div>
        )}
      </CardContent>

      {roomDialog && (
        <RoomDialog
          room={roomDialog.room}
          devices={devices}
          cameras={cameras}
          roomNames={roomNames}
          open
          onClose={() => setRoomDialog(null)}
        />
      )}
      {doorDialog && (
        <DoorDialog
          door={doorDialog.door}
          defaultRoomId={doorDialog.roomId}
          rooms={rooms}
          open
          onClose={() => setDoorDialog(null)}
        />
      )}
      {lockDialog && (
        <LockDialog
          lock={lockDialog.lock}
          doorId={lockDialog.doorId}
          devices={devices}
          open
          onClose={() => setLockDialog(null)}
        />
      )}
    </Card>
  );
}
