"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioJobStatus } from "@prisma/client";
import { useWakeLock } from "@/hooks/use-wake-lock";
import {
  LIVE_BYTES_PER_SECOND,
  LIVE_MAX_BACKLOG_MS,
  LIVE_SEND_INTERVAL_MS,
  LIVE_STALE_AFTER_MS,
  PcmDownsampler,
  int16ToLittleEndian,
  meterLevel,
} from "@/lib/audio-live";
import { formatDuration } from "./labels";

export type LivePhase = "idle" | "starting" | "live" | "stopping";

export interface LiveZone {
  id: number;
  name: string;
  hasDevice: boolean;
  deviceOnline: boolean;
  /** Stand des LIVE-Jobs dieser Zone; null, solange noch keine Antwort kam. */
  status: AudioJobStatus | null;
  errorMessage: string | null;
}

export interface LiveBroadcast {
  phase: LivePhase;
  zones: LiveZone[];
  /** Mikrofonpegel 0…1 für die Aussteuerungsanzeige. */
  level: number;
  seconds: number;
  error: string | null;
  notice: string | null;
  start: (options: { zoneIds: number[]; chime: boolean; emergency: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  dismiss: () => void;
}

interface ZoneState {
  zoneId: number;
  status: AudioJobStatus;
  errorMessage: string | null;
}

const MIN_SEND_BYTES = (LIVE_BYTES_PER_SECOND * LIVE_SEND_INTERVAL_MS) / 1000;
const MAX_BACKLOG_BYTES = (LIVE_BYTES_PER_SECOND * LIVE_MAX_BACKLOG_MS) / 1000;
const RETRY_DELAY_MS = 500;

/** Alles, was zu einer laufenden Live-Durchsage gehört – außerhalb von React. */
interface Run {
  sessionId: number | null;
  stream: MediaStream;
  context: AudioContext;
  node: AudioWorkletNode | null;
  downsampler: PcmDownsampler;
  pending: Uint8Array[];
  pendingBytes: number;
  /** Stück, das beim letzten Versuch nicht durchkam – geht mit derselben Nummer erneut raus. */
  retry: { seq: number; body: Uint8Array } | null;
  seq: number;
  startedAt: number;
  /** Mikrofon zu, Rest wird noch verschickt. */
  stopping: boolean;
  /** Vorbei, nichts wird mehr verschickt. */
  closed: boolean;
  wake: (() => void) | null;
  pump: Promise<void> | null;
}

/**
 * Live-Durchsage aus dem Browser: Mikrofon auf, Ton stückweise an die Cloud,
 * bis jemand stoppt.
 *
 * Liegt auf Seitenebene statt im Durchsage-Tab, damit ein Wechsel zu den Zonen
 * (etwa um die Lautstärke nachzuziehen) die Durchsage nicht abwürgt. Verlässt
 * man die Seite, endet sie.
 */
export function useLiveBroadcast(): LiveBroadcast {
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [zones, setZones] = useState<LiveZone[]>([]);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runRef = useRef<Run | null>(null);

  // Ein gesperrtes Handy nimmt nichts mehr auf.
  useWakeLock(phase !== "idle");

  const applyZones = useCallback((states: ZoneState[] | undefined) => {
    if (!Array.isArray(states)) return;
    const byZone = new Map(states.map((state) => [state.zoneId, state]));
    setZones((prev) =>
      prev.map((zone) => {
        const state = byZone.get(zone.id);
        return state ? { ...zone, status: state.status, errorMessage: state.errorMessage } : zone;
      })
    );
  }, []);

  const finish = useCallback(
    async (run: Run, message: string | null) => {
      if (run.closed) return;
      run.closed = true;
      run.stopping = true;
      releaseCapture(run);
      run.wake?.();

      if (run.sessionId !== null) {
        try {
          const res = await fetch(`/api/audio/live/${run.sessionId}/end`, { method: "POST" });
          const data = await res.json().catch(() => ({}));
          applyZones(data.zones);
        } catch {
          // Ohne Antwort beendet der Server die Sitzung nach kurzem Schweigen selbst.
        }
      }

      if (runRef.current === run) runRef.current = null;
      setPhase("idle");
      setLevel(0);
      if (message) {
        setError(message);
      } else {
        const duration = Math.round((Date.now() - run.startedAt) / 1000);
        setNotice(`Live-Durchsage beendet (${formatDuration(duration)})`);
      }
    },
    [applyZones]
  );

  const pump = useCallback(
    async (run: Run) => {
      let lastOk = Date.now();
      while (!run.closed) {
        let item = run.retry;
        if (!item) {
          const flushing = run.stopping && run.pendingBytes > 0;
          if (run.pendingBytes < MIN_SEND_BYTES && !flushing) {
            if (run.stopping) return;
            await new Promise<void>((resolve) => {
              run.wake = resolve;
              setTimeout(resolve, 250);
            });
            run.wake = null;
            continue;
          }
          item = { seq: ++run.seq, body: concatBytes(run.pending, run.pendingBytes) };
          run.pending = [];
          run.pendingBytes = 0;
        }

        try {
          const res = await fetch(`/api/audio/live/${run.sessionId}/audio?seq=${item.seq}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: item.body as Uint8Array<ArrayBuffer>,
          });
          const data = await res.json().catch(() => ({}));
          if (res.status >= 400 && res.status < 500) {
            await finish(run, typeof data.error === "string" ? data.error : "Live-Durchsage abgebrochen");
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          run.retry = null;
          lastOk = Date.now();
          applyZones(data.zones);
          if (data.state === "ENDED") {
            await finish(run, "Live-Durchsage wurde beendet – die Verbindung war zu lange unterbrochen");
            return;
          }
        } catch {
          // Beim Beenden lohnt kein langes Nachschicken mehr.
          if (run.stopping) return;
          run.retry = item;
          if (Date.now() - lastOk > LIVE_STALE_AFTER_MS) {
            await finish(run, "Verbindung verloren – Live-Durchsage beendet");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    },
    [applyZones, finish]
  );

  const start = useCallback<LiveBroadcast["start"]>(
    async ({ zoneIds, chime, emergency }) => {
      if (runRef.current) return;
      setError(null);
      setNotice(null);
      setZones([]);
      setLevel(0);
      setSeconds(0);
      setPhase("starting");

      if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
        setError("Dieser Browser kann keinen Live-Ton senden");
        setPhase("idle");
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch {
        setError("Kein Zugriff auf das Mikrofon – bitte im Browser erlauben");
        setPhase("idle");
        return;
      }

      const context = new AudioContext();
      const run: Run = {
        sessionId: null,
        stream,
        context,
        node: null,
        downsampler: new PcmDownsampler(context.sampleRate),
        pending: [],
        pendingBytes: 0,
        retry: null,
        seq: 0,
        startedAt: Date.now(),
        stopping: false,
        closed: false,
        wake: null,
        pump: null,
      };
      runRef.current = run;

      try {
        // iOS startet den Kontext nur aus der Klick-Geste heraus.
        await context.resume();
        await context.audioWorklet.addModule("/worklets/live-capture.js");
      } catch {
        releaseCapture(run);
        runRef.current = null;
        if (!run.stopping) setError("Dieser Browser kann keinen Live-Ton senden");
        setPhase("idle");
        return;
      }
      if (run.stopping) {
        runRef.current = null;
        setPhase("idle");
        return;
      }

      // Aufnahme läuft schon, während die Sitzung angelegt wird: wer sofort
      // losspricht, verliert so nichts.
      const source = context.createMediaStreamSource(stream);
      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 7_000;
      const node = new AudioWorkletNode(context, "emp-live-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (run.stopping) return;
        setLevel(meterLevel(event.data));
        const bytes = int16ToLittleEndian(run.downsampler.push(event.data));
        if (bytes.length === 0) return;
        run.pending.push(bytes);
        run.pendingBytes += bytes.length;
        while (run.pendingBytes > MAX_BACKLOG_BYTES && run.pending.length > 1) {
          run.pendingBytes -= run.pending.shift()!.length;
        }
        run.wake?.();
      };
      // Der Worklet-Ausgang ist stumm; ohne Verbindung zum Ausgang rufen manche
      // Browser ihn aber gar nicht erst auf.
      source.connect(lowpass).connect(node).connect(context.destination);
      run.node = node;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        void finish(run, "Mikrofon getrennt – Live-Durchsage beendet");
      });

      let data: { id?: number; zones?: Omit<LiveZone, "status" | "errorMessage">[]; error?: string } = {};
      let ok = false;
      try {
        const res = await fetch("/api/audio/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneIds, chime, emergency }),
        });
        data = await res.json().catch(() => ({}));
        ok = res.ok && typeof data.id === "number";
      } catch {
        // unten wie jede andere Ablehnung behandelt
      }

      if (!ok) {
        releaseCapture(run);
        run.closed = true;
        if (runRef.current === run) runRef.current = null;
        setError(typeof data.error === "string" ? data.error : "Live-Durchsage konnte nicht starten");
        setPhase("idle");
        return;
      }

      run.sessionId = data.id!;
      // Während des Anlegens gestoppt oder das Mikrofon verloren: Sitzung gleich
      // wieder schließen, sonst holten die Zonen sie noch ab.
      if (run.stopping) {
        void fetch(`/api/audio/live/${run.sessionId}/end`, { method: "POST" }).catch(() => {});
        if (!run.closed) {
          run.closed = true;
          if (runRef.current === run) runRef.current = null;
          setPhase("idle");
        }
        return;
      }

      run.startedAt = Date.now();
      setZones((data.zones ?? []).map((zone) => ({ ...zone, status: null, errorMessage: null })));
      setPhase("live");
      run.pump = pump(run);
    },
    [finish, pump]
  );

  const stop = useCallback(async () => {
    const run = runRef.current;
    if (!run || run.stopping) return;
    run.stopping = true;
    setPhase("stopping");
    releaseCapture(run);
    run.wake?.();
    // Noch nicht angelegt: start() räumt auf, sobald es so weit ist.
    if (run.sessionId === null) return;
    await run.pump;
    await finish(run, null);
  }, [finish]);

  const dismiss = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => {
      const run = runRef.current;
      if (run) setSeconds(Math.round((Date.now() - run.startedAt) / 1000));
    }, 1_000);
    return () => clearInterval(timer);
  }, [phase]);

  // Seite verlassen oder Tab schließen: die Zonen sollen nicht erst nach dem
  // Schweige-Timeout freikommen.
  useEffect(() => {
    const abandon = () => {
      const run = runRef.current;
      if (!run) return;
      run.closed = true;
      releaseCapture(run);
      if (run.sessionId !== null) navigator.sendBeacon(`/api/audio/live/${run.sessionId}/end`);
      runRef.current = null;
    };
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      abandon();
    };
  }, []);

  return { phase, zones, level, seconds, error, notice, start, stop, dismiss };
}

function releaseCapture(run: Run) {
  if (run.node) {
    run.node.port.onmessage = null;
    run.node.disconnect();
    run.node = null;
  }
  run.stream.getTracks().forEach((track) => track.stop());
  if (run.context.state !== "closed") void run.context.close().catch(() => {});
}

function concatBytes(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
