"use client";

/**
 * Räume-Seite: eine Tab-Leiste im Kopf (Übersicht, ein Tab je Raum, Ohne Raum)
 * und darunter genau eine Ansicht. Die Übersicht ist das Lagebild aller
 * Räume, ein Raum-Tab zeigt die Raumkarte in voller Breite, "Ohne Raum"
 * ordnet lose Geräte zu. Die gewählte Ansicht steht in der URL (?raum=…),
 * damit ein Link direkt in einen Raum führt.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Plus, Search } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { RoomPanel, roomHasEquipment, type RoomPanelTab } from "@/components/raeume/room-panel";
import { ClimateDialog } from "@/components/raeume/climate-dialog";
import { RoomEquipmentDialog, type Placed } from "@/components/raeume/room-equipment-dialog";
import { ErrorLine, apiRequest, deviceMetaLabel } from "@/components/raeume/shared";
import { useDeviceStatuses, useNow } from "@/components/raeume/status";
import { useMowerStates } from "@/components/raeume/mower-card";
import { RoomTabs, type RoomTabItem, type RoomView } from "@/components/raeume/room-tabs";
import { Overview, type OverviewFilter } from "@/components/raeume/overview";
import { AssignView } from "@/components/raeume/assign-view";
import { summarizeRoom, upcomingAcrossRooms } from "@/components/raeume/room-summary";
import { groupLooseItems, splitByKind, type LooseItem } from "@/lib/room-overview";
import type { MowerAction } from "@/lib/mower";
import type { ZoneAction } from "@/components/raeume/zone-row";
import type { NetworkItem, RaeumeData, RoomCamera, RoomDevice, RoomZone } from "@/components/raeume/types";
import { cn } from "@/lib/utils";

/** Wartezeit, bevor nach einer Schaltaktion neu abgefragt wird. */
const STATUS_SETTLE_MS = 1200;

/**
 * Der Abspieler meldet den neuen Zustand erst mit dem naechsten Heartbeat;
 * so lange warten, bevor die Seite neu laedt.
 */
const ZONE_SETTLE_MS = 2500;

const ASSIGN_PARAM = "ohne-raum";
const UPCOMING_LIMIT = 8;

function viewFromParam(raw: string | null): RoomView {
  if (!raw) return { kind: "overview" };
  if (raw === ASSIGN_PARAM) return { kind: "assign" };
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? { kind: "room", id } : { kind: "overview" };
}

function paramFromView(view: RoomView): string | null {
  if (view.kind === "overview") return null;
  return view.kind === "assign" ? ASSIGN_PARAM : String(view.id);
}

export function RaeumeClient({ data, readonly }: { data: RaeumeData; readonly: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setViewState] = useState<RoomView>(() => viewFromParam(params.get("raum")));
  const [tabHint, setTabHint] = useState<RoomPanelTab | undefined>(undefined);
  const [showEmpty, setShowEmpty] = useState(false);
  const [filter, setFilter] = useState<OverviewFilter>("all");
  const [query, setQuery] = useState("");
  const [equipmentRoom, setEquipmentRoom] = useState<{
    id: number;
    name: string;
    icon: string | null;
    scheduleId: number | null;
  } | null>(null);
  const [climateRoomId, setClimateRoomId] = useState<number | null>(null);
  const [error, setError] = useState("");

  // Zurück/Vor im Browser folgt der URL.
  useEffect(() => {
    const onPop = () => setViewState(viewFromParam(new URLSearchParams(window.location.search).get("raum")));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setView = useCallback((next: RoomView, tab?: RoomPanelTab) => {
    setViewState(next);
    setTabHint(tab);
    const url = new URL(window.location.href);
    const param = paramFromView(next);
    if (param) url.searchParams.set("raum", param);
    else url.searchParams.delete("raum");
    window.history.pushState(null, "", url);
  }, []);

  // Nur Shelly-Geraete haben eine Statusabfrage. Geraete ohne Raum bleiben
  // aussen vor: dort geht es ums Zuordnen, nicht ums Schalten.
  const shellyIds = useMemo(
    () =>
      data.rooms
        .flatMap((room) => room.devices)
        .filter((device) => device.type === "SHELLY")
        .map((device) => device.id),
    [data.rooms],
  );
  const { statuses, refresh } = useDeviceStatuses(shellyIds);
  const nowMs = useNow(new Date(data.renderedAt).getTime());
  const hasMowers = useMemo(
    () => data.rooms.some((room) => room.devices.some((device) => device.type === "MAMMOTION_MOWER")),
    [data.rooms],
  );
  const { live: mowers, refreshSoon: refreshMowers } = useMowerStates(hasMowers);

  const placedDevices: Placed<RoomDevice>[] = useMemo(
    () => [
      ...data.rooms.flatMap((room) => room.devices.map((item) => ({ item, roomId: room.id }))),
      ...data.looseDevices.map((item) => ({ item, roomId: null })),
    ],
    [data.rooms, data.looseDevices],
  );
  const placedCameras: Placed<RoomCamera>[] = useMemo(
    () => [
      ...data.rooms.flatMap((room) => room.cameras.map((item) => ({ item, roomId: room.id }))),
      ...data.looseCameras.map((item) => ({ item, roomId: null })),
    ],
    [data.rooms, data.looseCameras],
  );
  const placedZones: Placed<RoomZone>[] = useMemo(
    () => [
      ...data.rooms.flatMap((room) => room.zones.map((item) => ({ item, roomId: room.id }))),
      ...data.looseZones.map((item) => ({ item, roomId: null })),
    ],
    [data.rooms, data.looseZones],
  );
  const allShellys = useMemo(
    () => placedDevices.map((p) => p.item).filter((d) => d.type === "SHELLY"),
    [placedDevices],
  );
  const roomNames = useMemo(
    () => new Map(data.rooms.map((room) => [room.id, room.name])),
    [data.rooms],
  );

  const networkByRoom = useMemo(() => {
    const map = new Map<number, NetworkItem[]>();
    for (const item of data.network) {
      if (item.roomId != null) map.set(item.roomId, [...(map.get(item.roomId) ?? []), item]);
    }
    return map;
  }, [data.network]);

  // Jeder Raum wird genau einmal verdichtet; Tabs, Kacheln und Spuren lesen daraus.
  const summaries = useMemo(
    () => data.rooms.map((room) => summarizeRoom(room, statuses, mowers, nowMs, data.timezone)),
    [data.rooms, statuses, mowers, nowMs, data.timezone],
  );
  const upcoming = useMemo(() => upcomingAcrossRooms(data.rooms, nowMs, UPCOMING_LIMIT), [data.rooms, nowMs]);

  const tabItems: RoomTabItem[] = summaries.map((s) => ({
    id: s.room.id,
    name: s.room.name,
    dot: s.alerts.length > 0 ? "alert" : s.present ? "present" : s.open === true ? "open" : s.open === false ? "closed" : "none",
    badge: s.alerts.length > 0 ? s.alerts.length : null,
    empty: !roomHasEquipment(s.room) && !networkByRoom.has(s.room.id),
  }));

  const q = query.trim().toLowerCase();
  const visibleSummaries = q ? summaries.filter((s) => s.haystack.includes(q)) : summaries;

  // Lose Elemente, nach Ort im Namen gruppiert.
  const looseItems: LooseItem[] = useMemo(
    () => [
      ...data.looseDevices.map((d) => ({
        key: `d${d.id}`,
        kind: "device" as const,
        id: d.id,
        name: d.name,
        meta: deviceMetaLabel(d.type, d.category),
      })),
      ...data.looseCameras.map((c) => ({ key: `c${c.id}`, kind: "camera" as const, id: c.id, name: c.name, meta: "Kamera" })),
      ...data.looseZones.map((z) => ({ key: `z${z.id}`, kind: "zone" as const, id: z.id, name: z.name, meta: "Beschallung" })),
    ],
    [data.looseDevices, data.looseCameras, data.looseZones],
  );
  const namedRooms = useMemo(() => data.rooms.map((r) => ({ id: r.id, name: r.name })), [data.rooms]);
  const looseGroups = useMemo(() => groupLooseItems(looseItems, namedRooms), [looseItems, namedRooms]);
  const looseCount = looseItems.length;

  async function handleAction(device: RoomDevice, action: string): Promise<string | null> {
    setError("");
    const res = await apiRequest<{ error?: string }>(
      `/api/devices/${device.id}/action`,
      "POST",
      { action },
    );
    if (!res.ok) return res.message;
    // Der Endpunkt meldet 200 auch dann, wenn der Befehl das Gerät nicht
    // erreicht hat – die Ursache steht dann in `error`.
    const remoteError = res.data?.error;
    setTimeout(refresh, STATUS_SETTLE_MS);
    // Hue: Zustand ist der letzte Befehl; die Seite neu laden, sobald der Hub geschaltet hat.
    if (device.type === "HUE_LIGHT") setTimeout(() => router.refresh(), 6_000);
    return remoteError ?? null;
  }

  async function handleMowerAction(device: RoomDevice, action: MowerAction, planId?: string): Promise<string | null> {
    setError("");
    const res = await apiRequest<{ error?: string }>(`/api/devices/${device.id}/mower`, "POST", { action, planId });
    if (!res.ok) return res.message;
    refreshMowers();
    return null;
  }

  async function handleZoneAction(zone: RoomZone, action: ZoneAction): Promise<string | null> {
    setError("");
    const res = await apiRequest<{ error?: string }>(
      `/api/audio/zones/${zone.id}/control`,
      "POST",
      { action },
    );
    if (!res.ok) return res.message;
    setTimeout(() => router.refresh(), ZONE_SETTLE_MS);
    return null;
  }

  /**
   * Lose Elemente einem Raum zuordnen. Die Raum-API ersetzt je Art die ganze
   * Liste, darum werden die vorhandenen IDs des Raums mitgeschickt; Arten
   * ohne neue Elemente bleiben unberührt.
   */
  async function assignLoose(items: LooseItem[], roomId: number): Promise<string | null> {
    const split = splitByKind(items);
    const room = data.rooms.find((r) => r.id === roomId);
    const body: { deviceIds?: number[]; cameraIds?: number[]; audioZoneIds?: number[] } = {};
    if (split.deviceIds.length) body.deviceIds = [...(room?.devices.map((d) => d.id) ?? []), ...split.deviceIds];
    if (split.cameraIds.length) body.cameraIds = [...(room?.cameras.map((c) => c.id) ?? []), ...split.cameraIds];
    if (split.zoneIds.length) body.audioZoneIds = [...(room?.zones.map((z) => z.id) ?? []), ...split.zoneIds];
    const res = await apiRequest(`/api/schliessanlage/rooms/${roomId}`, "PUT", body);
    if (!res.ok) return res.message;
    router.refresh();
    return null;
  }

  async function createRoom(name: string): Promise<{ id: number } | { error: string }> {
    const res = await apiRequest<{ id?: number }>("/api/schliessanlage/rooms", "POST", { name });
    if (!res.ok) return { error: res.message };
    if (typeof res.data?.id !== "number") return { error: "Raum wurde angelegt, aber ohne Kennung zurückgemeldet." };
    return { id: res.data.id };
  }

  const climateRoom = climateRoomId != null ? data.rooms.find((r) => r.id === climateRoomId) ?? null : null;
  const openEquipment = (room: (typeof data.rooms)[number]) =>
    setEquipmentRoom({ id: room.id, name: room.name, icon: room.icon, scheduleId: room.schedule?.id ?? null });

  const activeRoom = view.kind === "room" ? data.rooms.find((r) => r.id === view.id) ?? null : null;
  const effectiveView: RoomView = view.kind === "room" && !activeRoom ? { kind: "overview" } : view;

  if (data.rooms.length === 0 && looseCount === 0) {
    return (
      <section className="glass-card">
        <EmptyState
          icon={Building2}
          title="Noch keine Räume angelegt"
          description="Räume, Türen und Schlösser werden in der Schließanlage gepflegt und erscheinen dann hier als Leitstand."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/schliessanlage">In der Schließanlage anlegen</Link>
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <RoomTabs
            items={tabItems}
            view={effectiveView}
            looseCount={looseCount}
            showEmpty={showEmpty}
            onToggleEmpty={() => setShowEmpty((v) => !v)}
            onSelect={(next) => setView(next)}
          />
        </div>
        {effectiveView.kind === "overview" && (
          <div className="relative lg:w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Raum oder Gerät suchen …"
              aria-label="Raum oder Gerät suchen"
              className={cn(
                "h-9 w-full rounded-full border border-(--glass-border) bg-(--glass-bg) pl-9 pr-3 text-[13px] shadow-[inset_0_1px_0_var(--glass-highlight)] backdrop-blur-xl",
                "placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring",
              )}
            />
          </div>
        )}
      </div>
      <ErrorLine message={error} />

      {effectiveView.kind === "overview" && (
        <>
          {data.rooms.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Noch keine Räume. Lege unter „Ohne Raum“ einen Raum an oder pflege Räume in der{" "}
              <Link href="/schliessanlage" className="underline hover:text-primary">
                Schließanlage
              </Link>
              .
            </p>
          ) : visibleSummaries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Keine Treffer.</p>
          ) : (
            <Overview
              summaries={visibleSummaries}
              upcoming={upcoming}
              filter={filter}
              onFilter={setFilter}
              nowMs={nowMs}
              timezone={data.timezone}
              readonly={readonly}
              onOpenRoom={(roomId, tab) => setView({ kind: "room", id: roomId }, tab)}
              onAction={handleAction}
              onZoneAction={handleZoneAction}
            />
          )}
          {!readonly && (
            <div className="flex justify-end">
              <NewRoomButton />
            </div>
          )}
        </>
      )}

      {effectiveView.kind === "room" && activeRoom && (
        <RoomPanel
          key={`${activeRoom.id}:${tabHint ?? ""}`}
          room={activeRoom}
          statuses={statuses}
          nowMs={nowMs}
          timezone={data.timezone}
          readonly={readonly}
          onAction={handleAction}
          onZoneAction={handleZoneAction}
          onEdit={() => openEquipment(activeRoom)}
          onClimate={() => setClimateRoomId(activeRoom.id)}
          network={networkByRoom.get(activeRoom.id) ?? []}
          mowers={mowers}
          onMowerAction={handleMowerAction}
          wide
          initialTab={tabHint}
        />
      )}

      {effectiveView.kind === "assign" && (
        <AssignView groups={looseGroups} rooms={namedRooms} readonly={readonly} onAssign={assignLoose} onCreateRoom={createRoom} />
      )}

      {climateRoom && (
        <ClimateDialog
          roomId={climateRoom.id}
          roomName={climateRoom.name}
          roomScheduleName={climateRoom.schedule?.name ?? null}
          climate={climateRoom.climate}
          roomDevices={climateRoom.devices}
          allShellys={allShellys}
          scheduleOptions={data.scheduleOptions}
          onClose={() => setClimateRoomId(null)}
        />
      )}

      {equipmentRoom && (
        <RoomEquipmentDialog
          roomId={equipmentRoom.id}
          roomName={equipmentRoom.name}
          devices={placedDevices}
          cameras={placedCameras}
          zones={placedZones}
          roomNames={roomNames}
          scheduleOptions={data.scheduleOptions}
          currentScheduleId={equipmentRoom.scheduleId}
          roomIcon={equipmentRoom.icon}
          network={data.network}
          open
          onClose={() => setEquipmentRoom(null)}
        />
      )}
    </div>
  );
}

/** Neuen Raum direkt aus der Raumuebersicht anlegen. */
function NewRoomButton() {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await apiRequest("/api/schliessanlage/rooms", "POST", { name: name.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setName("");
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Neuer Raum
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="Name, z. B. Büro"
        maxLength={120}
        className="h-9 w-44 rounded-control border border-border/70 bg-background/70 px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || !name.trim()}
        className="h-9 rounded-control bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
      >
        {busy ? "…" : "Anlegen"}
      </button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </span>
  );
}
