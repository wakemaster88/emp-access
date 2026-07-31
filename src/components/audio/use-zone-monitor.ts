"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AudioSourceKind, PlaylistRow, TrackRow, ZoneRow } from "./types";

/**
 * Mithören einer Zone auf dem eigenen Gerät.
 *
 * Abgespielt wird nicht das Signal des Abspielers – der Pi liefert seinen Ton
 * nirgends aus – sondern dieselbe Quelle: bei Webradio derselbe Stream, bei
 * einer Playlist deren Titel aus dem Blob-Storage. Bei Webradio hört man
 * dadurch praktisch dasselbe Programm, bei einer Playlist denselben Titel ab
 * seinem Anfang, denn eine Wiedergabeposition meldet der Pi nicht.
 *
 * Es läuft immer nur eine Zone: ein einziges Audio-Element für alle Karten,
 * damit sich nicht mehrere Zonen überlagern.
 */

interface MonitorItem {
  url: string;
  title: string;
}

interface MonitorQueue {
  zoneId: number;
  items: MonitorItem[];
  index: number;
  /** Playlists laufen im Kreis weiter, ein Stream endet nur mit Abbruch. */
  loop: boolean;
}

const START_VOLUME = 70;

export interface ZoneMonitor {
  /** Zone, die gerade auf diesem Gerät läuft. */
  zoneId: number | null;
  /** Was hier gerade läuft – Titel der Playlist bzw. „Webradio“. */
  title: string | null;
  volume: number;
  error: { zoneId: number; message: string } | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  /** false, wenn die Zone keine Quelle hat, die der Browser abspielen könnte. */
  canMonitor: (zone: ZoneRow) => boolean;
  toggle: (zone: ZoneRow, currentTitle: string | null) => void;
  stop: () => void;
  setVolume: (volume: number) => void;
  onEnded: () => void;
  onError: () => void;
}

/**
 * Was in dieser Zone zu hören ist: was gerade läuft, und wenn sie still steht,
 * die eingestellte Quelle – so hört man auch bei gestoppter Zone vorab, was der
 * Start bringen würde.
 */
export function zoneSource(zone: ZoneRow): AudioSourceKind {
  return zone.sourceKind !== "SILENCE" ? zone.sourceKind : zone.defaultSource;
}

/** Warteschlange für eine Zone bilden. `null` heißt: nichts abspielbar. */
function resolveQueue(
  zone: ZoneRow,
  currentTitle: string | null,
  tracks: TrackRow[],
  playlists: PlaylistRow[]
): MonitorQueue | null {
  const source = zoneSource(zone);

  if (source === "STREAM") {
    if (!zone.streamUrl) return null;
    return { zoneId: zone.id, items: [{ url: zone.streamUrl, title: "Webradio" }], index: 0, loop: false };
  }

  if (source === "PLAYLIST") {
    const playlist = playlists.find((p) => p.id === zone.playlistId);
    if (!playlist) return null;

    const byId = new Map(tracks.map((track) => [track.id, track]));
    const items = playlist.trackIds.flatMap((id) => {
      const track = byId.get(id);
      return track ? [{ url: track.url, title: track.title }] : [];
    });
    if (items.length === 0) return null;

    // Beim gemeldeten Titel einsteigen, damit man möglichst dasselbe hört.
    const reported = currentTitle
      ? items.findIndex((item) => item.title === currentTitle)
      : -1;
    return { zoneId: zone.id, items, index: reported >= 0 ? reported : 0, loop: true };
  }

  return null;
}

export function useZoneMonitor({
  tracks,
  playlists,
}: {
  tracks: TrackRow[];
  playlists: PlaylistRow[];
}): ZoneMonitor {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<MonitorQueue | null>(null);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(START_VOLUME);
  const [error, setError] = useState<{ zoneId: number; message: string } | null>(null);

  const stop = useCallback(() => {
    queue.current = null;
    setZoneId(null);
    setTitle(null);

    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    // Ohne diesen Schritt lädt der Browser den Stream im Hintergrund weiter.
    audio.removeAttribute("src");
    audio.load();
  }, []);

  const play = useCallback(
    (audio: HTMLAudioElement, item: MonitorItem, forZoneId: number) => {
      setTitle(item.title);
      audio.src = item.url;
      void audio.play().catch(() => {
        // Ein Wechsel auf eine andere Zone bricht die laufende Wiedergabe ab.
        // Dieser Abbruch ist kein Fehler, den man anzeigen müsste.
        if (queue.current?.zoneId !== forZoneId) return;
        setError({ zoneId: forZoneId, message: "Wiedergabe auf diesem Gerät nicht möglich" });
        stop();
      });
    },
    [stop]
  );

  const toggle = useCallback(
    (zone: ZoneRow, currentTitle: string | null) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (queue.current?.zoneId === zone.id) {
        stop();
        return;
      }

      const next = resolveQueue(zone, currentTitle, tracks, playlists);
      if (!next) {
        setError({ zoneId: zone.id, message: "Diese Zone hat keine Quelle zum Mithören" });
        return;
      }

      setError(null);
      queue.current = next;
      setZoneId(zone.id);
      audio.volume = volume / 100;
      // src setzen und play() müssen im Klick selbst passieren, sonst wertet es
      // der Browser nicht als Nutzeraktion und blockt die Wiedergabe still.
      play(audio, next.items[next.index], next.zoneId);
    },
    [play, playlists, stop, tracks, volume]
  );

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    if (audioRef.current) audioRef.current.volume = next / 100;
  }, []);

  const onEnded = useCallback(() => {
    const audio = audioRef.current;
    const current = queue.current;
    if (!audio || !current) return;

    if (!current.loop) {
      stop();
      return;
    }
    current.index = (current.index + 1) % current.items.length;
    play(audio, current.items[current.index], current.zoneId);
  }, [play, stop]);

  const onError = useCallback(() => {
    // Das Aufräumen löst selbst ein Fehlerereignis aus – nur echte Abbrüche
    // während einer laufenden Wiedergabe sind gemeint.
    const current = queue.current;
    if (!current) return;
    setError({
      zoneId: current.zoneId,
      message: "Diese Quelle lässt sich auf diesem Gerät nicht abspielen",
    });
    stop();
  }, [stop]);

  const canMonitor = useCallback(
    (zone: ZoneRow) => resolveQueue(zone, null, tracks, playlists) !== null,
    [playlists, tracks]
  );

  // Beim Verlassen der Seite verstummt das Mithören.
  useEffect(() => {
    const audio = audioRef.current;
    return () => audio?.pause();
  }, []);

  return {
    zoneId,
    title,
    volume,
    error,
    audioRef,
    canMonitor,
    toggle,
    stop,
    setVolume,
    onEnded,
    onError,
  };
}
