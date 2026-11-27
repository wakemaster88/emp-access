"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Cctv, DoorOpen, Loader2, Radio, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { useGo2rtc } from "@/components/webcams/control-center";
import { WebRTCVideo } from "@/components/webcams/webrtc-video";
import type { DashboardLive } from "@/components/dashboard/live-section";
import { LIVE_MODE_CLICK_TEXT } from "@/lib/camera-live-mode";

type Gate = DashboardLive["status"]["gates"][number];

async function control(cameraId: number, action: "door" | "snapshot"): Promise<string | null> {
  try {
    const res = await fetch(`/api/cameras/${cameraId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload: action === "door" ? { relay: 1 } : {} }),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error ?? `Fehler ${res.status}`;
  } catch {
    return "Keine Verbindung zur Cloud";
  }
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Tor im Dashboard: Bild der DoorBird-Sprechstelle und die Taste zum Öffnen.
 * Live-Video läuft wie im Kontrollzentrum über go2rtc, wenn der Browser es
 * im lokalen Netz erreicht; sonst das Standbild, beim Öffnen frisch geholt.
 * Livebild und Vorschau „nur auf Tippen“: kein Bild, ein kurzer Satz; „aus“:
 * nur die Taste zum Öffnen.
 */
export function GateDialog({
  gate,
  hubOnline,
  open,
  onOpenChange,
}: {
  gate: Gate;
  hubOnline: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{gate.name}</DialogTitle>
          <DialogDescription>
            {gate.liveMode === "AUTO"
              ? "Erst ansehen, wer davor steht, dann öffnen."
              : "Das Tor öffnet erst nach einer Rückfrage."}
          </DialogDescription>
        </DialogHeader>
        {/* Inhalt erst mit dem Öffnen einhängen: Stream und Schnappschuss laufen nur, solange der Dialog offen ist. */}
        {open && <GateBody gate={gate} hubOnline={hubOnline} />}
      </DialogContent>
    </Dialog>
  );
}

function GateBody({ gate, hubOnline }: { gate: Gate; hubOnline: boolean }) {
  const [go2rtc] = useGo2rtc();
  const imageShown = gate.liveMode === "AUTO";
  const [snapshotAt, setSnapshotAt] = useState(imageShown ? gate.snapshotAt : null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const streamSrc = imageShown && go2rtc.reachable ? (go2rtc.byHost[gate.host] ?? null) : null;

  const refreshSnapshot = useCallback(async () => {
    setRefreshing(true);
    const err = await control(gate.id, "snapshot");
    if (err) setError(err);
    else {
      setError(null);
      setSnapshotAt(new Date().toISOString());
    }
    setRefreshing(false);
  }, [gate.id]);

  // Ohne Live-Video beim Öffnen ein frisches Standbild holen – das gespeicherte
  // kann Stunden alt sein. Erst, wenn feststeht, dass go2rtc nicht erreichbar ist.
  useEffect(() => {
    if (!imageShown || !hubOnline || go2rtc.reachable !== false) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSnapshot();
  }, [imageShown, hubOnline, go2rtc.reachable, refreshSnapshot]);

  async function openGate() {
    const err = await control(gate.id, "door");
    if (err) throw new Error(err);
    setConfirming(false);
    setError(null);
    setOpenedAt(new Date().toISOString());
  }

  return (
    <div className="space-y-3">
      {gate.liveMode === "CLICK" && <p className="text-sm text-muted-foreground">{LIVE_MODE_CLICK_TEXT}</p>}
      {imageShown && (
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-tile bg-black">
          {streamSrc ? (
            <WebRTCVideo
              go2rtcUrl={go2rtc.url}
              src={streamSrc}
              snapshotUrl={snapshotAt ? `/api/cameras/${gate.id}/snapshot` : undefined}
              onConnected={() => setLive(true)}
              onError={() => setLive(false)}
            />
          ) : snapshotAt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/cameras/${gate.id}/snapshot?t=${encodeURIComponent(snapshotAt)}`}
              alt={`Bild ${gate.name}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <Cctv className="h-10 w-10 text-white/25" aria-hidden />
          )}
          {streamSrc && live ? (
            <Badge variant="media" className="absolute left-1.5 top-1.5 gap-1">
              <Radio className="h-3 w-3 text-emerald-400" aria-hidden /> LIVE
            </Badge>
          ) : (
            !streamSrc &&
            snapshotAt && (
              <Badge variant="media" className="absolute left-1.5 top-1.5 tabular-nums">
                {refreshing ? "Bild wird geholt …" : `Standbild ${fmtClock(snapshotAt)}`}
              </Badge>
            )
          )}
        </div>
      )}

      {!hubOnline && (
        <Notice tone="warning" compact title="Der Hub ist offline">
          Öffnen und neue Bilder gehen erst wieder, wenn er läuft.
        </Notice>
      )}
      {error && <Notice tone="danger" compact role="alert" title={error} />}
      {openedAt && !confirming && (
        <Notice tone="success" compact role="status" title={`Tor geöffnet um ${fmtClock(openedAt)} Uhr`} />
      )}

      {confirming ? (
        <ConfirmStep
          title={`${gate.name} jetzt öffnen?`}
          confirmLabel="Öffnen"
          destructive={false}
          icon={DoorOpen}
          onConfirm={openGate}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button asChild variant="ghost" className="sm:mr-auto">
            <Link href="/webcams">Kontrollzentrum</Link>
          </Button>
          {imageShown && !streamSrc && (
            <Button variant="outline" disabled={!hubOnline || refreshing} onClick={() => void refreshSnapshot()}>
              {refreshing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
              Bild aktualisieren
            </Button>
          )}
          <Button disabled={!hubOnline} onClick={() => setConfirming(true)}>
            <DoorOpen aria-hidden />
            Tor öffnen
          </Button>
        </div>
      )}
    </div>
  );
}
