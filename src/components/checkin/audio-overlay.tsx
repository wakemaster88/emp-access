"use client";

/**
 * Taste „Audio“ im Kopf des Check-in-Monitors und ihr Blatt: Spielt der
 * Monitor eine Audio-Zone (Audio › Zonen › Abspieler „Monitor im Browser“),
 * lässt sie sich hier starten, stoppen, leiser und lauter stellen und die
 * Musik stumm schalten. Durchsagen klingen auch bei stummer Musik.
 *
 * Steuert über den Server, also von jedem Gerät mit diesem Link. Spielt das
 * Gerät selbst, wirken Stumm und Lautstärke hier sofort (`monitorPlayer`).
 * Ohne Zone am Monitor bleibt die Taste unsichtbar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Loader2, Megaphone, Play, Square, Volume2, VolumeX, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconChip, type ChipTone } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { sliderFill } from "@/components/audio/ui";
import { monitorPlayer } from "@/components/monitor-audio/monitor-audio-registry";
import { OverlayGrip, overlayScrimClass, overlaySheetClass } from "@/components/checkin/checkin-ui";
import { mutedUntilText, type MonitorAudioControlView, type MonitorControlAction } from "@/lib/monitor-audio";
import { cn } from "@/lib/utils";

/** Offenes Blatt: Zustand zügig; geschlossen nur für Taste und Stumm-Anzeige. */
const POLL_OPEN_MS = 3_000;
const POLL_CLOSED_MS = 20_000;
/** Monitor ohne Zone: selten nachsehen, ob inzwischen eine eingestellt ist. */
const POLL_NO_ZONE_MS = 120_000;
/** So lange zeigt Start/Stopp „Startet …“, bevor ein Hinweis erscheint. */
const PENDING_HINT_MS = 20_000;
/** Reglerbewegung gilt nach dieser Pause als abgeschlossen. */
const VOLUME_COMMIT_MS = 400;

type Pending = { action: "PLAY" | "STOP"; since: number };

export interface MonitorAudioControl {
  /** undefined = noch nicht geladen, null = Monitor spielt keine Zone. */
  view: MonitorAudioControlView | null | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  muted: boolean;
  busy: MonitorControlAction["action"] | null;
  pending: Pending | null;
  error: string | null;
  now: number;
  send: (input: MonitorControlAction) => Promise<void>;
}

export function useMonitorAudioControl(token: string): MonitorAudioControl {
  const [view, setView] = useState<MonitorAudioControlView | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<MonitorControlAction["action"] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const base = `/api/monitor-audio/${encodeURIComponent(token)}/control`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (res.status === 404) return setView(null);
      if (!res.ok) return;
      const body = (await res.json()) as { zone?: MonitorAudioControlView | null };
      setView(body.zone ?? null);
    } catch {
      // Netz weg: Stand bleibt, nächster Abruf.
    }
  }, [base]);

  // Abruf: offen alle 3 s, sonst selten. Läuft ein Start/Stopp, sekündlich die Uhr.
  const hasZone = !!view;
  useEffect(() => {
    let timer: number | null = null;
    let stopped = false;
    const tick = async () => {
      await load();
      if (stopped) return;
      timer = window.setTimeout(tick, open ? POLL_OPEN_MS : hasZone ? POLL_CLOSED_MS : POLL_NO_ZONE_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [load, open, hasZone]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pending]);

  // Start/Stopp ist erledigt, sobald der Abspieler den Zustand meldet.
  if (pending && view && view.isPlaying === (pending.action === "PLAY")) setPending(null);

  const muted = busy === "MUTE" ? true : busy === "UNMUTE" ? false : !!view?.mutedUntil;

  const send = useCallback(
    async (input: MonitorControlAction) => {
      setBusy(input.action);
      setError(null);
      const player = monitorPlayer(token);
      const wasMuted = !!view?.mutedUntil;
      // Spielt dieses Gerät, hört man Stumm und Lautstärke gleich.
      if (input.action === "MUTE" || input.action === "UNMUTE") player?.setMusicMuted(input.action === "MUTE");
      if (input.action === "VOLUME") player?.previewVolume(input.volume);
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = (await res.json().catch(() => ({}))) as { zone?: MonitorAudioControlView | null; error?: unknown };
        if (!res.ok) {
          setError(typeof body.error === "string" ? body.error : "Befehl fehlgeschlagen");
          if (input.action === "MUTE" || input.action === "UNMUTE") player?.setMusicMuted(wasMuted);
          return;
        }
        if (body.zone !== undefined) setView(body.zone);
        if (input.action === "PLAY" || input.action === "STOP") {
          setNow(Date.now());
          setPending({ action: input.action, since: Date.now() });
          // Spielt dieses Gerät, holt es den Befehl sofort statt nach bis zu 8 s.
          player?.refresh();
        }
      } catch {
        setError("Keine Verbindung zum Server · Netz prüfen und erneut versuchen");
        if (input.action === "MUTE" || input.action === "UNMUTE") player?.setMusicMuted(wasMuted);
      } finally {
        setBusy(null);
      }
    },
    [base, token, view?.mutedUntil]
  );

  return { view, open, setOpen, muted, busy, pending, error, now, send };
}

/** Kopftaste: nur, wenn der Monitor eine Zone spielt. Stumm zeigt sie in Hinweisfarbe. */
export function MonitorAudioButton({
  control,
  className,
  labelClassName,
  mutedLabelClassName,
}: {
  control: MonitorAudioControl;
  className: string;
  /** Beschriftung „Audio“: ab welcher Breite sichtbar. */
  labelClassName: string;
  /** Beschriftung „Stumm“: früher sichtbar, weil sie etwas Ungewöhnliches meldet. */
  mutedLabelClassName: string;
}) {
  if (!control.view) return null;
  const { muted } = control;
  return (
    <Button
      variant="outline"
      onClick={() => control.setOpen(true)}
      title={muted ? "Musik ist stumm, Durchsagen klingen · Audio steuern" : `Audio der Zone „${control.view.name}“ steuern`}
      aria-label={muted ? "Audio: Musik stumm" : "Audio"}
      className={className}
    >
      {muted ? <VolumeX className="size-5 shrink-0 text-warning" /> : <Volume2 className="size-5 shrink-0" />}
      <span className={muted ? mutedLabelClassName : labelClassName}>{muted ? "Stumm" : "Audio"}</span>
    </Button>
  );
}

function useCommittedVolume(serverVolume: number, onCommit: (volume: number) => void) {
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), []);
  // Bestätigt der Server den Wert, folgt der Regler wieder ihm.
  if (draft !== null && draft === serverVolume) setDraft(null);
  function change(next: number) {
    setDraft(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onCommit(next);
    }, VOLUME_COMMIT_MS);
  }
  return { value: draft ?? serverVolume, change };
}

/** Das Blatt „Audio“ – auf Seitenebene gerendert, nicht im Kopf (fester Rahmen). */
export function MonitorAudioSheet({ control }: { control: MonitorAudioControl }) {
  const { view, setOpen, muted, busy, pending, error, now, send } = control;
  const volume = useCommittedVolume(view?.volume ?? 50, (next) => void send({ action: "VOLUME", volume: next }));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (!view) return null;

  const leader = view.following ? `„${view.following}“` : null;
  const waited = pending ? Math.max(0, Math.round((now - pending.since) / 1000)) : 0;
  const showStop = pending ? pending.action === "PLAY" : view.isPlaying;

  const state: { label: string; detail: string; tone: ChipTone; icon: typeof Volume2 } = pending
    ? {
        label: pending.action === "PLAY" ? "Startet …" : "Stoppt …",
        detail:
          now - pending.since > PENDING_HINT_MS
            ? "Der Abspieler meldet sich nicht · läuft die Seite mit Ton auf dem Rechner im Shop?"
            : `Wartet auf den Abspieler · ${waited} s`,
        tone: "neutral",
        icon: Loader2,
      }
    : !view.isActive
      ? { label: "Deaktiviert", detail: "Zone in Audio › Zonen einschalten", tone: "neutral", icon: VolumeX }
      : !view.online
        ? {
            label: "Offline",
            detail: "Kein Gerät spielt die Zone gerade · Seite mit Ton auf dem Rechner im Shop offen?",
            tone: "danger",
            icon: WifiOff,
          }
        : view.isPlaying
          ? {
              label: muted ? "Läuft stumm" : "Läuft",
              detail: view.currentTitle ?? (leader ? `wie ${leader}` : (view.sourceName ?? "Wiedergabe")),
              tone: muted ? "warning" : "music",
              icon: muted ? VolumeX : Volume2,
            }
          : {
              label: "Aus",
              detail: leader
                ? `Start folgt wieder ${leader}`
                : view.sourceName
                  ? `Start spielt ${view.sourceName}`
                  : "Keine Quelle eingestellt",
              tone: "neutral",
              icon: VolumeX,
            };

  return (
    <div
      className={cn("fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4", overlayScrimClass)}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="monitor-audio-title"
        className={cn(overlaySheetClass, "w-full max-w-lg pb-[env(safe-area-inset-bottom)] sm:pb-0")}
      >
        <OverlayGrip />
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <IconChip icon={muted ? VolumeX : Volume2} tone={muted ? "warning" : view.isPlaying ? "music" : "neutral"} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id="monitor-audio-title" className="text-base font-semibold text-foreground">
              Audio · {view.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {leader ? (
                <span className="inline-flex items-center gap-1">
                  <Link2 className="size-3" aria-hidden />
                  Folgt {leader}: startet und stoppt mit dieser Zone
                </span>
              ) : (
                "Musik und Durchsagen dieser Zone über diesen Monitor"
              )}
            </p>
          </div>
          <Button
            variant="secondary"
            size="icon-lg"
            onClick={() => setOpen(false)}
            className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
            aria-label="Schließen"
          >
            <X />
          </Button>
        </div>

        <div className="space-y-3 p-5">
          {/* Zustand und eine Taste: Stopp, solange Musik läuft, sonst Start (wie in Audio › Zonen). */}
          <div
            className={cn(
              "glass-tile flex items-center gap-3 p-3 transition-colors",
              state.tone === "music" && "border-violet-400/45 bg-violet-400/15"
            )}
          >
            <IconChip
              icon={state.icon}
              tone={state.tone}
              active={state.tone === "music"}
              size="lg"
              className={cn(pending && "[&_svg]:animate-spin")}
            />
            <div className="min-w-0 flex-1" aria-live="polite">
              <p className="text-sm font-semibold text-foreground">{state.label}</p>
              <p className="line-clamp-2 text-xs break-words text-muted-foreground tabular-nums">{state.detail}</p>
            </div>
            {showStop ? (
              <Button
                variant="outline"
                onClick={() => void send({ action: "STOP" })}
                disabled={!!pending || busy !== null}
                className="h-11 shrink-0 gap-1.5 px-4 font-semibold sm:h-14"
              >
                {busy === "STOP" ? <Loader2 className="animate-spin" /> : <Square />}
                Stopp
              </Button>
            ) : (
              <Button
                onClick={() => void send({ action: "PLAY" })}
                disabled={!!pending || busy !== null || view.startBlocked !== null}
                title={view.startBlocked ?? undefined}
                className="h-11 shrink-0 gap-1.5 px-4 font-semibold sm:h-14"
              >
                {busy === "PLAY" ? <Loader2 className="animate-spin" /> : <Play />}
                Start
              </Button>
            )}
          </div>
          {view.startBlocked && !showStop && <p className="-mt-1 text-xs text-muted-foreground">{view.startBlocked}</p>}

          {/* Stumm: Musik lautlos, Durchsagen klingen. Die ganze Zeile ist Tippfläche. */}
          <label
            className={cn(
              "glass-tile flex min-h-14 cursor-pointer items-center gap-3 p-3 transition-colors",
              muted && "border-warning/40 bg-warning/[0.08]"
            )}
          >
            <IconChip icon={muted ? VolumeX : Megaphone} tone={muted ? "warning" : "neutral"} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">Musik stumm</span>
              <span className="block text-xs text-muted-foreground">
                {muted
                  ? `Durchsagen klingen weiter · ${mutedUntilText(view.mutedUntil) ?? "bis heute Nacht"}`
                  : "Durchsagen klingen weiter · gilt bis heute Nacht"}
              </span>
            </span>
            <Switch
              checked={muted}
              disabled={busy === "MUTE" || busy === "UNMUTE"}
              onCheckedChange={(checked) => void send({ action: checked ? "MUTE" : "UNMUTE" })}
              aria-label="Musik stumm"
            />
          </label>

          <div className={cn("flex items-center gap-3 px-1", muted && "opacity-60")}>
            <Volume2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="range"
              min={0}
              max={100}
              value={volume.value}
              onChange={(e) => volume.change(Number(e.target.value))}
              aria-label="Lautstärke der Musik"
              aria-valuetext={`${volume.value} Prozent`}
              style={sliderFill(volume.value)}
              className="touch-slider flex-1"
            />
            <span className="w-11 text-right text-sm tabular-nums text-muted-foreground">{volume.value}%</span>
          </div>

          {error && <Notice tone="danger" compact role="alert" title={error} />}
        </div>
      </div>
    </div>
  );
}
