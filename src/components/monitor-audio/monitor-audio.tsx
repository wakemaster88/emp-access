"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { MonitorAudioPlayer, type MonitorAudioView } from "./monitor-audio-player";

/** Ereignisse, die der Browser als Nutzeraktion wertet (Autoplay-Freigabe). */
const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

/**
 * Monitor-Seite als Abspieler einer Audio-Zone (Audio › Zonen › Abspieler).
 *
 * Unsichtbar, solange der Monitor keine Zone hat oder der Ton läuft. Sonst
 * ein kleiner Hinweis unten links: einmal „Hier abspielen?“ je Gerät, und
 * nach dem Neuladen „Ton gesperrt“, bis jemand auf den Bildschirm tippt –
 * auch ein Scan mit dem Handscanner zählt.
 */
export function MonitorAudio({ token }: { token: string }) {
  const [view, setView] = useState<MonitorAudioView>({ mode: "hidden", zoneName: null });
  const playerRef = useRef<MonitorAudioPlayer | null>(null);

  useEffect(() => {
    const player = new MonitorAudioPlayer(token, setView);
    playerRef.current = player;
    player.start();
    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [token]);

  // Gesperrt: jedes Tippen oder jede Taste auf der Seite gibt den Ton frei.
  useEffect(() => {
    if (view.mode !== "locked") return;
    const unlock = () => playerRef.current?.unlock();
    for (const name of UNLOCK_EVENTS) window.addEventListener(name, unlock, { capture: true, passive: true });
    return () => {
      for (const name of UNLOCK_EVENTS) window.removeEventListener(name, unlock, { capture: true });
    };
  }, [view.mode]);

  if (view.mode === "hidden" || view.mode === "playing") return null;

  const zone = view.zoneName ? `„${view.zoneName}“` : "der Zone";
  const locked = view.mode === "locked";

  return (
    <div
      className="fixed z-50 w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-card bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-[calc(env(safe-area-inset-left)+1rem)]"
      role="region"
      aria-label="Ton dieses Monitors"
    >
      <Notice
        tone={locked ? "warning" : "info"}
        icon={locked ? VolumeX : Volume2}
        compact
        title={locked ? "Ton gesperrt" : `Audio-Zone ${zone}`}
        action={
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => (locked ? playerRef.current?.unlock() : playerRef.current?.accept())}
            >
              {locked ? "Ton an" : "Hier abspielen"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-11 sm:h-9"
              onClick={() => playerRef.current?.decline()}
            >
              Nicht hier
            </Button>
          </div>
        }
      >
        {locked
          ? `Einmal auf den Bildschirm tippen, dann spielt ${zone} hier.`
          : "Durchsagen und Musik dieser Zone über die Lautsprecher dieses Geräts abspielen?"}
      </Notice>
    </div>
  );
}
