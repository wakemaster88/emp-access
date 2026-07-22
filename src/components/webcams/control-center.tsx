"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  ZoomIn, ZoomOut, Cctv, RefreshCw, Loader2, AlertTriangle,
  Lightbulb, Moon, Siren, Crosshair, MapPin, Radio, Settings2,
  Gamepad2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WebRTCVideo } from "./webrtc-video";

export interface WebcamRow {
  id: number;
  name: string;
  host: string;
  channel: number;
  snapshotAt: string | null;
  lastSeenAt: string | null;
}

interface ControlCenterProps {
  cameras: WebcamRow[];
  hubOnline: boolean;
}

interface Preset {
  id: number;
  name: string;
}

type PtzOp =
  | "Left" | "Right" | "Up" | "Down"
  | "LeftUp" | "LeftDown" | "RightUp" | "RightDown"
  | "ZoomInc" | "ZoomDec";

async function control(
  cameraId: number,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    const res = await fetch(`/api/cameras/${cameraId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, result: data.result };
  } catch {
    return { ok: false, error: "Netzwerkfehler" };
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/* ---------------------------------------------------------------------------
 * go2rtc-Anbindung (Live-Video): Läuft lokal auf dem Kiosk-Mac (Port 1984).
 * Die Streams werden über /api/streams entdeckt und per Kamera-IP den
 * Kameras aus der Datenbank zugeordnet. Funktioniert nur, wenn der Browser
 * go2rtc im LAN erreicht (lokales Dashboard oder gleiches Netz).
 * ------------------------------------------------------------------------- */

const GO2RTC_STORAGE_KEY = "empAccess.go2rtcUrl";

function defaultGo2rtcUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:1984";
  // Dashboard und go2rtc laufen i. d. R. auf demselben Rechner.
  return `http://${window.location.hostname}:1984`;
}

interface Go2rtcInfo {
  url: string;
  reachable: boolean | null;
  /** Kamera-IP/Host -> Stream-Basisname (ohne _main/_sub). */
  byHost: Record<string, string>;
}

function useGo2rtc(): [Go2rtcInfo, (url: string) => void] {
  const [url, setUrl] = useState("");
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [byHost, setByHost] = useState<Record<string, string>>({});

  useEffect(() => {
    setUrl(localStorage.getItem(GO2RTC_STORAGE_KEY) || defaultGo2rtcUrl());
  }, []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    async function probe() {
      try {
        const res = await fetch(`${url.replace(/\/$/, "")}/api/streams`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Record<
          string,
          { producers?: Array<{ url?: string }> } | null
        >;
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const [name, info] of Object.entries(data ?? {})) {
          const producerUrl = info?.producers?.[0]?.url ?? "";
          // Host aus rtsp://user:pass@HOST:port/... extrahieren.
          const m = producerUrl.match(/@([^:/@]+)[:/]/);
          if (!m) continue;
          const base = name.replace(/_(main|sub)$/, "");
          // _sub bevorzugen wir später explizit; hier nur Basisname merken.
          if (!(m[1] in map)) map[m[1]] = base;
        }
        setByHost(map);
        setReachable(true);
      } catch {
        if (!cancelled) {
          setReachable(false);
          setByHost({});
        }
      }
    }

    probe();
    const t = setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [url]);

  const save = useCallback((next: string) => {
    const cleaned = next.trim().replace(/\/$/, "");
    localStorage.setItem(GO2RTC_STORAGE_KEY, cleaned);
    setReachable(null);
    setUrl(cleaned || defaultGo2rtcUrl());
  }, []);

  return [{ url, reachable, byHost }, save];
}

const PTZ_PAD: Array<{ op: PtzOp | null; icon: React.ElementType | null }> = [
  { op: "LeftUp", icon: ArrowUpLeft },
  { op: "Up", icon: ArrowUp },
  { op: "RightUp", icon: ArrowUpRight },
  { op: "Left", icon: ArrowLeft },
  { op: null, icon: null },
  { op: "Right", icon: ArrowRight },
  { op: "LeftDown", icon: ArrowDownLeft },
  { op: "Down", icon: ArrowDown },
  { op: "RightDown", icon: ArrowDownRight },
];

function CameraPanel({
  cam,
  hubOnline,
  go2rtcUrl,
  streamBase,
}: {
  cam: WebcamRow;
  hubOnline: boolean;
  /** go2rtc-Basis-URL, wenn erreichbar – sonst null (nur Standbild). */
  go2rtcUrl: string | null;
  /** Stream-Basisname in go2rtc (ohne _main/_sub) oder null. */
  streamBase: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [snapshotAt, setSnapshotAt] = useState(cam.snapshotAt);
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [spotlightOn, setSpotlightOn] = useState(false);
  const [sirenOn, setSirenOn] = useState(false);
  const [speed, setSpeed] = useState(32);
  const [hd, setHd] = useState(false);
  const [live, setLive] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  const run = useCallback(
    async (key: string, action: string, payload: Record<string, unknown> = {}) => {
      setBusy(key);
      setError("");
      const r = await control(cam.id, action, payload);
      if (!r.ok) setError(r.error ?? "Fehler");
      setBusy(null);
      return r;
    },
    [cam.id]
  );

  async function refreshSnapshot() {
    const r = await run("snapshot", "snapshot");
    if (r.ok) {
      const now = new Date().toISOString();
      setSnapshotAt(now);
      router.refresh();
    }
  }

  async function loadPresets() {
    setPresetsLoading(true);
    const r = await control(cam.id, "presets");
    if (r.ok) {
      const result = r.result as { presets?: Preset[] } | undefined;
      setPresets(result?.presets ?? []);
    } else {
      setError(r.error ?? "Presets konnten nicht geladen werden");
    }
    setPresetsLoading(false);
  }

  async function toggleSpotlight(on: boolean) {
    setSpotlightOn(on);
    const r = await run("spotlight", "spotlight", { on, brightness: 100 });
    if (!r.ok) setSpotlightOn(!on);
  }

  async function toggleSiren(on: boolean) {
    if (on && !confirm(`Sirene an "${cam.name}" wirklich auslösen?`)) return;
    setSirenOn(on);
    const r = await run("siren", "siren", { on });
    if (!r.ok) setSirenOn(!on);
  }

  const disabled = !hubOnline || busy !== null;

  return (
    <>
      <div className="group relative aspect-video overflow-hidden rounded-md bg-slate-900 flex items-center justify-center">
        {go2rtcUrl && streamBase ? (
          <WebRTCVideo
            go2rtcUrl={go2rtcUrl}
            src={`${streamBase}_${hd ? "main" : "sub"}`}
            snapshotUrl={snapshotAt ? `/api/cameras/${cam.id}/snapshot` : undefined}
            onConnected={() => setLive(true)}
            onError={() => setLive(false)}
          />
        ) : snapshotAt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/cameras/${cam.id}/snapshot?t=${encodeURIComponent(snapshotAt)}`}
            alt={`Schnappschuss ${cam.name}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <Cctv className="h-10 w-10 text-slate-300 dark:text-slate-600" />
        )}

        {/* Name unten links, dezenter Verlauf – wie im alten Kiosk. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-6">
          <span className="text-xs font-medium text-white drop-shadow">
            {cam.name}
          </span>
          {!(go2rtcUrl && streamBase) && snapshotAt && (
            <span className="float-right font-mono text-[10px] text-white/70">
              {fmtTime(snapshotAt)}
            </span>
          )}
        </div>

        {go2rtcUrl && streamBase && live && (
          <Badge className="absolute top-1.5 left-1.5 bg-rose-600/90 text-white gap-1 text-[9px] h-4 px-1">
            <Radio className="h-2.5 w-2.5" /> LIVE
          </Badge>
        )}

        {/* Buttons nur bei Hover einblenden, damit das Grid ruhig bleibt. */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {go2rtcUrl && streamBase && (
            <Button
              variant="secondary"
              size="sm"
              className={cn(
                "h-7 px-1.5 text-[10px] font-semibold bg-black/50 hover:bg-black/70",
                hd ? "text-emerald-400" : "text-white"
              )}
              title={hd ? "Auf Vorschau-Qualität (sub) wechseln" : "Auf volle Qualität (main) wechseln"}
              onClick={() => setHd((v) => !v)}
            >
              HD
            </Button>
          )}
          {!(go2rtcUrl && streamBase) && (
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white"
              title="Neuen Schnappschuss anfordern"
              onClick={refreshSnapshot}
              disabled={disabled}
            >
              {busy === "snapshot"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 bg-black/50 hover:bg-black/70 text-white"
            title="Kamera steuern (PTZ, Licht, IR, Sirene)"
            onClick={() => setControlsOpen(true)}
          >
            <Gamepad2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Dialog open={controlsOpen} onOpenChange={setControlsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6">
              <span className="truncate">{cam.name}</span>
              <span className="text-xs font-mono font-normal text-slate-400 shrink-0">
                {cam.host}{cam.channel > 0 ? ` · K${cam.channel}` : ""}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
        <div className="flex gap-4">
          {/* PTZ-Pad */}
          <div className="grid grid-cols-3 gap-1 shrink-0">
            {PTZ_PAD.map((cell, i) =>
              cell.op ? (
                <Button
                  key={cell.op}
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  title={cell.op}
                  disabled={disabled}
                  onClick={() => run(`ptz-${cell.op}`, "ptz", { op: cell.op, speed })}
                >
                  {busy === `ptz-${cell.op}`
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : cell.icon && <cell.icon className="h-4 w-4" />}
                </Button>
              ) : (
                <div key={`center-${i}`} className="h-9 w-9 flex items-center justify-center">
                  <Crosshair className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                </div>
              )
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1"
                disabled={disabled}
                onClick={() => run("zoom-in", "ptz", { op: "ZoomInc", speed })}
              >
                {busy === "zoom-in"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ZoomIn className="h-3.5 w-3.5" />}
                Zoom
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1"
                disabled={disabled}
                onClick={() => run("zoom-out", "ptz", { op: "ZoomDec", speed })}
              >
                {busy === "zoom-out"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ZoomOut className="h-3.5 w-3.5" />}
                Weit
              </Button>
            </div>

            <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8">Geschwindigkeit: langsam</SelectItem>
                <SelectItem value="32">Geschwindigkeit: normal</SelectItem>
                <SelectItem value="56">Geschwindigkeit: schnell</SelectItem>
              </SelectContent>
            </Select>

            {presets === null ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1"
                disabled={disabled || presetsLoading}
                onClick={loadPresets}
              >
                {presetsLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <MapPin className="h-3.5 w-3.5" />}
                Presets laden
              </Button>
            ) : presets.length === 0 ? (
              <p className="text-xs text-slate-400 text-center">Keine Presets gespeichert</p>
            ) : (
              <Select
                onValueChange={(v) => run("preset", "ptz", { op: "ToPos", presetId: Number(v) })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Preset anfahren …" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
            <div className="flex items-center gap-1.5 text-sm">
              <Lightbulb className={cn("h-4 w-4", spotlightOn ? "text-amber-500" : "text-slate-400")} />
              Licht
            </div>
            <Switch
              checked={spotlightOn}
              onCheckedChange={toggleSpotlight}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 gap-2">
            <div className="flex items-center gap-1.5 text-sm shrink-0">
              <Moon className="h-4 w-4 text-slate-400" />
              IR
            </div>
            <Select
              defaultValue="Auto"
              onValueChange={(v) => run("ir", "ir", { state: v })}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-xs w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Auto">Auto</SelectItem>
                <SelectItem value="On">An</SelectItem>
                <SelectItem value="Off">Aus</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
            <div className="flex items-center gap-1.5 text-sm">
              <Siren className={cn("h-4 w-4", sirenOn ? "text-rose-500" : "text-slate-400")} />
              Sirene
            </div>
            <Switch
              checked={sirenOn}
              onCheckedChange={toggleSiren}
              disabled={disabled}
            />
          </div>
        </div>

            {error && (
              <p className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WebcamControlCenter({ cameras, hubOnline }: ControlCenterProps) {
  const [go2rtc, saveGo2rtcUrl] = useGo2rtc();
  const [showSettings, setShowSettings] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  // Online-Zaehlung clientseitig im Effekt (Date.now ist im Render tabu)
  // und minuetlich aktualisieren.
  const [online, setOnline] = useState<number | null>(null);
  useEffect(() => {
    function countOnline() {
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      setOnline(
        cameras.filter(
          (c) => c.lastSeenAt && new Date(c.lastSeenAt).getTime() > fiveMinAgo
        ).length
      );
    }
    countOnline();
    const t = setInterval(countOnline, 60_000);
    return () => clearInterval(t);
  }, [cameras]);

  return (
    <div className="space-y-2">
      {!hubOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Der lokale Hub ist offline – Kamera-Steuerung ist erst wieder möglich, wenn er läuft.
        </div>
      )}

      {go2rtc.reachable === false && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-4 py-3 text-sm text-sky-800 dark:text-sky-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          go2rtc ({go2rtc.url}) ist aus diesem Browser nicht erreichbar – es werden Standbilder
          statt Live-Video gezeigt. Live-Video funktioniert nur im lokalen Netz (z.&nbsp;B. über
          das lokale Dashboard).
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="gap-1.5">
          <Cctv className="h-3.5 w-3.5" />
          {cameras.length} Kameras
        </Badge>
        <Badge
          className={cn(
            "gap-1.5",
            go2rtc.reachable
              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          )}
        >
          <Radio className="h-3.5 w-3.5" />
          {go2rtc.reachable ? "Live-Video aktiv" : "Nur Standbilder"}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-slate-400"
          title="go2rtc-Adresse konfigurieren"
          onClick={() => {
            setUrlDraft(go2rtc.url);
            setShowSettings((v) => !v);
          }}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        {showSettings && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveGo2rtcUrl(urlDraft);
              setShowSettings(false);
            }}
          >
            <Input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="http://192.168.1.202:1984"
              className="h-8 w-64 font-mono text-xs"
            />
            <Button type="submit" size="sm" className="h-8">Speichern</Button>
          </form>
        )}
        <Badge
          className={cn(
            "gap-1.5",
            (online ?? 0) > 0
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", (online ?? 0) > 0 ? "bg-emerald-500" : "bg-slate-400")} />
          {online ?? "–"} online
        </Badge>
      </div>

      {cameras.length === 0 ? (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-slate-500">
            <Cctv className="h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="font-medium text-slate-600 dark:text-slate-400">
              Keine aktiven Reolink-Kameras
            </p>
            <p className="text-sm text-center max-w-md">
              Lege unter „Kameras“ zuerst deine Reolink-Kameras an – hier steuerst du
              anschließend PTZ, Presets, Scheinwerfer, IR und Sirene.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-1.5">
          {cameras.map((c) => (
            <CameraPanel
              key={c.id}
              cam={c}
              hubOnline={hubOnline}
              go2rtcUrl={go2rtc.reachable ? go2rtc.url : null}
              streamBase={go2rtc.byHost[c.host] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
