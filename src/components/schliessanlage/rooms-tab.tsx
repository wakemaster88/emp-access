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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
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
  // Rückfrage vor dem Löschen (docs/design-regeln.md, Abschnitt 18); der Inhalt bleibt stehen, solange der Dialog ausblendet.
  const [pendingDelete, setPendingDelete] = useState<{ url: string; title: string; description?: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function askRemove(url: string, title: string, description?: string) {
    setPendingDelete({ url, title, description });
    setConfirmOpen(true);
  }

  async function remove(url: string) {
    setError("");
    const res = await apiRequest(url, "DELETE");
    if (!res.ok) setError(res.message);
    else router.refresh();
  }

  const doorCount = rooms.reduce((sum, r) => sum + r.doors.length, 0) + looseDoors.length;
  const roomNames = new Map(rooms.map((r) => [r.id, r.name]));
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  // Tür als Zeile mit Haarlinie (die Liste trennt mit divide-y), Schlösser eingerückt an einer Haarlinie (keine eigene Fläche).
  const renderDoor = (door: DoorRow) => (
    <div key={door.id} className="py-2">
      {/* Handlungen rechts; reicht der Platz nicht (Handy), rutschen sie in eine zweite Zeile, statt den Namen abzuschneiden. */}
      <div className="flex flex-wrap items-start gap-x-2">
        <DoorOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 basis-[11rem]">
          <p className="truncate text-sm font-medium text-foreground">
            {door.name}
            {door.doorNumber && (
              <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{door.doorNumber}</span>
            )}
          </p>
          {door.notes && <p className="truncate text-[11px] text-muted-foreground">{door.notes}</p>}
        </div>
        {!readonly && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setLockDialog({ lock: null, doorId: door.id })}
              className="text-muted-foreground hover:text-primary max-sm:size-11"
              title="Schloss hinzufügen"
              aria-label="Schloss hinzufügen"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setDoorDialog({ door, roomId: door.roomId })}
              className="text-muted-foreground hover:text-primary max-sm:size-11"
              title="Tür bearbeiten"
              aria-label="Tür bearbeiten"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                askRemove(
                  `/api/schliessanlage/doors/${door.id}`,
                  `Tür "${door.name}" inkl. ihrer Schlösser wirklich löschen?`,
                )
              }
              className="text-muted-foreground hover:text-destructive max-sm:size-11"
              title="Tür löschen"
              aria-label="Tür löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {door.locks.length > 0 && (
        <div className="mt-1.5 ml-2 space-y-1 border-l border-border pl-4">
          {door.locks.map((lock) => (
            <div
              key={lock.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1"
            >
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="font-mono text-[11px] text-foreground">
                {lock.lockNumber || "ohne Nummer"}
              </span>
              <span className="text-[11px] text-muted-foreground">{lockTypeLabel(lock.lockType)}</span>
              {lock.system && <span className="min-w-0 truncate text-[11px] text-muted-foreground">· {lock.system}</span>}
              {lock.deviceId != null && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"
                  title="Wird elektronisch geöffnet"
                >
                  <Zap className="h-3 w-3" />
                  {deviceById.get(lock.deviceId)?.name ?? "Gerät"}
                </span>
              )}
              <span
                className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums"
                title={`${lock.keyCount} Schlüssel zugeordnet`}
              >
                <KeyRound className="h-3 w-3" />
                {lock.keyCount}
              </span>
              {!readonly && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setLockDialog({ lock, doorId: door.id })}
                    className="text-muted-foreground hover:text-primary max-sm:size-11"
                    title="Schloss bearbeiten"
                    aria-label="Schloss bearbeiten"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                      askRemove(
                        `/api/schliessanlage/locks/${lock.id}`,
                        `Schloss "${lock.lockNumber || lock.id}" wirklich löschen?`,
                        "Schlüssel bleiben erhalten, verlieren aber diese Zuordnung.",
                      )
                    }
                    className="text-muted-foreground hover:text-destructive max-sm:size-11"
                    title="Schloss löschen"
                    aria-label="Schloss löschen"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
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
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="tabular-nums">
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
                className="max-sm:h-11"
              >
                <DoorOpen className="mr-1 h-3.5 w-3.5" />
                Tür
              </Button>
              <Button
                size="sm"
                onClick={() => setRoomDialog({ room: null })}
                className="max-sm:h-11"
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
          <EmptyHint icon={DoorOpen}>Noch keine Räume angelegt. Beginne mit einem Raum oder einer Außentür.</EmptyHint>
        )}

        {rooms.map((room) => {
          const isOpen = expanded.has(room.id);
          const roomDevices = devices.filter((d) => d.roomId === room.id);
          const roomCameras = cameras.filter((c) => c.roomId === room.id);
          return (
            <div key={room.id} className="glass-tile">
              {/* Kopfzeile des Raums: Aufklappen links, Handlungen rechts (brechen auf dem Handy um). */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 p-2.5 sm:gap-y-2">
                <button
                  type="button"
                  onClick={() => toggle(room.id)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 basis-[13rem] items-center gap-2.5 rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:min-h-11"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <IconChip icon={Building2} tone="neutral" size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {room.name}
                      </span>
                      {room.number && (
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{room.number}</span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[room.building, room.floor].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
                {/* Zahlen und Handlungen rechts; auf dem Handy gemeinsam in der zweiten Zeile (Zahlen unter dem Namen),
                    damit der Raumname die erste Zeile ganz bekommt und nicht abgeschnitten wird. */}
                <div className="ml-auto flex shrink-0 items-center gap-2 max-sm:basis-full max-sm:justify-between max-sm:pl-16">
                  {/* Zähler brechen als Ganzes um ("0 Türen" bleibt zusammen), wenn neben den Aktionen kein Platz ist. */}
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
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
                    <span className="whitespace-nowrap">
                      {room.doors.length} {room.doors.length === 1 ? "Tür" : "Türen"}
                    </span>
                  </span>
                  {!readonly && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDoorDialog({ door: null, roomId: room.id })}
                        className="text-muted-foreground hover:text-primary max-sm:size-11"
                        title="Tür hinzufügen"
                        aria-label="Tür hinzufügen"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setRoomDialog({ room })}
                        className="text-muted-foreground hover:text-primary max-sm:size-11"
                        title="Raum bearbeiten"
                        aria-label="Raum bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          askRemove(
                            `/api/schliessanlage/rooms/${room.id}`,
                            `Raum "${room.name}" wirklich löschen?`,
                            `Die Türen bleiben erhalten und rutschen auf "ohne Raum".`,
                          )
                        }
                        className="text-muted-foreground hover:text-destructive max-sm:size-11"
                        title="Raum löschen"
                        aria-label="Raum löschen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-border px-2.5 pb-2.5">
                  {room.doors.length === 0 ? (
                    <p className="py-3 text-center text-[11px] text-muted-foreground">
                      Noch keine Tür in diesem Raum.
                    </p>
                  ) : (
                    <div className="divide-y divide-border">{room.doors.map(renderDoor)}</div>
                  )}

                  {(roomDevices.length > 0 || roomCameras.length > 0) && (
                    <div className="flex flex-wrap gap-1 border-t border-border pt-2.5">
                      {roomDevices.map((d) => (
                        <Badge
                          key={`d${d.id}`}
                          variant="secondary"
                          title={deviceMetaLabel(d.type, d.category)}
                          className="max-w-full font-medium"
                        >
                          <Cpu className="text-muted-foreground" />
                          <span className="truncate">{d.name}</span>
                        </Badge>
                      ))}
                      {roomCameras.map((c) => (
                        <Badge
                          key={`c${c.id}`}
                          variant="secondary"
                          title={c.kind}
                          className="max-w-full font-medium"
                        >
                          <Cctv className="text-muted-foreground" />
                          <span className="truncate">{c.name}</span>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {looseDoors.length > 0 && (
          <div className="glass-tile px-2.5 pt-2.5 pb-0.5">
            <p className="text-label">
              Türen ohne Raumzuordnung
            </p>
            <div className="divide-y divide-border">{looseDoors.map(renderDoor)}</div>
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

      {/* Löschen immer mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18); Fehler zeigt die ErrorLine oben. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent {...(pendingDelete?.description ? {} : { "aria-describedby": undefined })}>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete?.title}</AlertDialogTitle>
            {pendingDelete?.description && (
              <AlertDialogDescription>{pendingDelete.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="max-sm:h-11">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="max-sm:h-11"
              onClick={() => {
                if (pendingDelete) void remove(pendingDelete.url);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
