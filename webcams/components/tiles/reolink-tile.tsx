"use client";

import { useState } from "react";
import { TileFrame } from "./tile-frame";
import { WebRTCVideo } from "./webrtc-video";
import { SnapshotImage } from "./snapshot-image";
import { DigitalZoom, FixedView } from "./digital-zoom";
import type { WidgetView } from "@/lib/types";
import { REOLINK_CAPS, type Cam, type ReolinkWidget } from "@/lib/types";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Battery,
  CameraOff,
  KeyRound,
  Radio,
  Users,
} from "lucide-react";
import { usePeopleCount } from "@/components/use-people-counters";
import { useEmpAccessForCam } from "@/components/use-emp-access";

interface ReolinkTileProps {
  widget: ReolinkWidget;
  cam: Cam | undefined;
  go2rtcUrl: string;
  focused: boolean;
  onFocus?: () => void;
  /** Erhöht durch ControlPanel, um WebRTC-Reconnect zu erzwingen. */
  reloadKey?: number;
}

export function ReolinkTile({
  widget,
  cam,
  go2rtcUrl,
  focused,
  onFocus,
  reloadKey = 0,
}: ReolinkTileProps) {
  const [errored, setErrored] = useState(false);
  // Lokale Kopie des fixierten Ausschnitts — sofort wirksam, ohne auf den
  // nächsten Config-Poll (5 s) zu warten. `undefined` = noch nicht geändert.
  const [localView, setLocalView] = useState<WidgetView | null | undefined>(undefined);
  const view = localView === undefined ? (widget.view ?? null) : localView;

  const saveView = async (v: WidgetView | null) => {
    setLocalView(v);
    try {
      const { view: _drop, ...rest } = widget;
      await fetch(`/api/widgets/${widget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v ? { ...rest, view: v } : rest),
      });
    } catch {
      // Speichern fehlgeschlagen — lokaler State bleibt, nächster Poll korrigiert.
    }
  };
  const counter = usePeopleCount(cam?.id);
  const counterEnabled = !!cam?.peopleCounter?.enabled;
  const empEvents = useEmpAccessForCam(cam?.id);
  const empOverlay =
    cam?.empAccess.enabled &&
    cam.empAccess.deviceIds.length > 0 &&
    empEvents.length > 0;

  if (!cam) {
    return (
      <TileFrame title={widget.title}>
        <div className="flex h-full items-center justify-center text-sm text-white/60">
          <CameraOff className="mr-2 size-4" />
          Cam nicht konfiguriert
        </div>
      </TileFrame>
    );
  }

  if (!cam.enabled) {
    return (
      <TileFrame title={widget.title}>
        <div className="flex h-full items-center justify-center text-sm text-white/60">
          Cam deaktiviert
        </div>
      </TileFrame>
    );
  }

  const caps = REOLINK_CAPS[cam.model];
  // Stream-Wahl: focus = main, sonst sub
  const streamAlias = focused ? `${cam.id}_main` : `${cam.id}_sub`;
  const useSnapshot = caps.battery && !focused;
  // Panorama-Cams (Duo 3, ~32:9): nie croppen — das halbe Bild wäre weg.
  const fit = caps.wide ? "contain" : "cover";

  const badge = (
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/50">
      {caps.battery && <Battery className="size-3" />}
      <span>{cam.model}</span>
      {!useSnapshot && <Radio className="size-3 text-emerald-400" />}
    </div>
  );

  return (
    <TileFrame
      title={widget.title}
      showTitleBar={widget.showTitleBar}
      focused={focused}
      badge={badge}
      onClick={onFocus}
    >
      {(() => {
        const media = useSnapshot ? (
          <SnapshotImage
            url={`${go2rtcUrl.replace(/\/$/, "")}/api/frame.jpeg?src=${encodeURIComponent(streamAlias)}`}
            intervalMs={3000}
            fit={fit}
            onError={() => setErrored(true)}
          />
        ) : (
          <WebRTCVideo
            go2rtcUrl={go2rtcUrl}
            src={streamAlias}
            audio={focused && caps.audio2way}
            reloadKey={reloadKey}
            snapshotUrl={`/api/cams/${cam.id}/snapshot`}
            fit={fit}
            onConnected={() => setErrored(false)}
            onError={() => setErrored(true)}
          />
        );
        // Fokus-Modus: interaktiver Digital-Zoom mit Pin zum Fixieren.
        // (Auch bei optischem Zoom verfügbar — der Pin gilt der Übersicht.)
        if (focused) {
          return (
            <DigitalZoom initialView={view} onSaveView={saveView}>
              {media}
            </DigitalZoom>
          );
        }
        // Übersicht: fixierten Ausschnitt statisch anwenden.
        return view ? <FixedView view={view}>{media}</FixedView> : media;
      })()}
      {errored && (
        <div className="absolute right-2 top-2 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-300">
          Verbindungsfehler
        </div>
      )}
      {counterEnabled && counter?.mode === "crossing" && (
        <div
          className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white shadow-sm backdrop-blur-sm tabular-nums"
          title={
            counter.lastError
              ? `Fehler: ${counter.lastError}`
              : counter.lastUpdate
                ? `zuletzt: ${new Date(counter.lastUpdate).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${counter.fps} fps`
                : "noch keine Daten"
          }
        >
          <span className="flex items-center gap-0.5 text-emerald-300">
            <ArrowDownLeft className="size-3" />
            {counter.in}
          </span>
          <span className="flex items-center gap-0.5 text-rose-300">
            <ArrowUpRight className="size-3" />
            {counter.out}
          </span>
          <span className="border-l border-white/20 pl-1.5 font-medium">
            {counter.delta >= 0 ? `+${counter.delta}` : counter.delta}
          </span>
        </div>
      )}
      {counterEnabled && counter?.mode === "presence" && (
        <div
          className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white shadow-sm backdrop-blur-sm"
          title={
            counter.lastError
              ? `Fehler: ${counter.lastError}`
              : counter.lastUpdate
                ? `zuletzt: ${new Date(counter.lastUpdate).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                : "noch keine Daten"
          }
        >
          <Users className="size-3 opacity-80" />
          <span className="font-medium tabular-nums">
            {counter.count !== null && counter.count !== undefined
              ? counter.count
              : "…"}
          </span>
        </div>
      )}
      {counterEnabled && !counter && (
        <div
          className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white/70 shadow-sm backdrop-blur-sm"
          title="noch keine Daten"
        >
          <Users className="size-3 opacity-60" />
          <span className="tabular-nums">…</span>
        </div>
      )}
      {empOverlay && (
        <div className="absolute bottom-2 right-2 max-w-[min(92%,220px)] space-y-1">
          {empEvents.slice(0, 4).map((ev) => (
            <div
              key={ev.id}
              className={
                ev.kind === "valid"
                  ? "rounded-md border border-emerald-500/35 bg-black/65 px-2 py-1 text-[10px] leading-tight text-emerald-100 shadow-sm backdrop-blur-sm"
                  : ev.kind === "invalid"
                    ? "rounded-md border border-rose-500/40 bg-black/65 px-2 py-1 text-[10px] leading-tight text-rose-100 shadow-sm backdrop-blur-sm"
                    : "rounded-md border border-white/15 bg-black/65 px-2 py-1 text-[10px] leading-tight text-white/85 shadow-sm backdrop-blur-sm"
              }
              title={
                ev.detail
                  ? `${ev.summary}\n${ev.detail}`
                  : `${ev.summary} · ${new Date(ev.ts).toLocaleString("de-DE")}`
              }
            >
              <div className="flex items-start gap-1">
                <KeyRound className="mt-0.5 size-3 shrink-0 opacity-80" />
                <span className="line-clamp-3 break-words">{ev.summary}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </TileFrame>
  );
}
