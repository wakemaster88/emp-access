"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Clock,
  Gift,
  Loader2,
  ScanLine,
  TicketX,
  User,
  XCircle,
} from "lucide-react";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import type { VoucherCheck, VoucherRedemption } from "@/lib/voucher-monitor";
import { REDEEMED_VIA_LABEL } from "@/lib/voucher-via";

type Html5QrcodeModule = typeof import("html5-qrcode");

/** Wahl „Kamera an/aus“ bleibt je Gerät gespeichert. */
const CAMERA_KEY = "emp-voucher-monitor-camera";
/** Nach dem Einlösen geht die Ansicht von selbst zurück auf „Scannen“. */
const RESET_AFTER_REDEEM_MS = 8000;
/** Derselbe Code von der Kamera zählt erst nach dieser Pause wieder. */
const CAMERA_COOLDOWN_MS = 3000;

type View =
  | { kind: "idle" }
  | { kind: "checking"; code: string }
  | { kind: "result"; check: VoucherCheck; redeemed?: boolean; error?: string };

function fmtDay(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

function fmtDayTime(iso: string | null): string {
  if (!iso) return "";
  return `${fmtDay(iso)}, ${fmtTime(iso)} Uhr`;
}

function tone(check: VoucherCheck, redeemed: boolean | undefined): "success" | "danger" | "warning" | "open" {
  if (redeemed) return "success";
  if (!check.found) return "danger";
  if (check.kind === "ACCESS") return "warning";
  return check.state === "open" ? "open" : "danger";
}

function playTone(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = ok ? "sine" : "square";
    osc.frequency.setValueAtTime(ok ? 880 : 440, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(ok ? 1320 : 220, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(ok ? 0.25 : 0.2, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {
    /* kein Ton möglich */
  }
}

/**
 * Gutschein-Monitor für die Kasse: Code per Handscanner (Tastatur-Eingabe)
 * oder Kamera lesen, Gutschein prüfen und mit „Einlösen“ entwerten. Das
 * Scanfeld behält den Fokus, damit der Handscanner jederzeit schreiben kann.
 */
export function VoucherScanMonitor({ apiUrl }: { apiUrl: string }) {
  useWakeLock(true);
  const [code, setCode] = useState("");
  const [view, setView] = useState<View>({ kind: "idle" });
  const [redeeming, setRedeeming] = useState(false);
  const [history, setHistory] = useState<VoucherRedemption[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef<View>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const html5Ref = useRef<Html5QrcodeModule | null>(null);
  const lastCameraCode = useRef<{ code: string; at: number } | null>(null);

  // Am Tablet würde jeder Fokus die Bildschirmtastatur öffnen: nach einer
  // Berührung bleibt der Fokus, wo er ist (dort scannt ohnehin die Kamera).
  const touchRef = useRef(false);

  const focusInput = useCallback(() => {
    if (touchRef.current) return;
    // Nicht in ein anderes Feld springen, falls jemand gerade dort tippt.
    const active = document.activeElement;
    if (active && active !== document.body && active !== inputRef.current && active.tagName === "INPUT") return;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(apiUrl, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { redemptions?: VoucherRedemption[] };
      if (Array.isArray(json.redemptions)) setHistory(json.redemptions);
    } catch {
      /* Liste bleibt, wie sie ist */
    }
  }, [apiUrl]);

  useEffect(() => {
    void loadHistory();
    const id = setInterval(() => void loadHistory(), 60_000);
    return () => clearInterval(id);
  }, [loadHistory]);

  const clearResetTimer = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = null;
  };

  const check = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      clearResetTimer();
      setView({ kind: "checking", code: value });
      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: value }),
        });
        const json = (await res.json().catch(() => null)) as VoucherCheck | { error?: string } | null;
        if (!json || !("found" in json)) {
          const message = json && "error" in json && json.error ? json.error : "Prüfen fehlgeschlagen";
          setView({ kind: "result", check: { found: false, message } });
          playTone(false);
          return;
        }
        setView({ kind: "result", check: json });
        playTone(json.found && json.kind === "BENEFIT" && json.state === "open");
      } catch {
        setView({ kind: "result", check: { found: false, message: "Keine Verbindung. Bitte noch einmal scannen." } });
        playTone(false);
      } finally {
        setCode("");
        focusInput();
      }
    },
    [apiUrl, focusInput],
  );

  const redeem = useCallback(async () => {
    const current = viewRef.current;
    if (current.kind !== "result" || !current.check.found || redeeming) return;
    const voucherCode = current.check.code;
    setRedeeming(true);
    try {
      const res = await fetch(`${apiUrl}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: voucherCode }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; check: VoucherCheck }
        | { ok: false; message: string; check?: VoucherCheck }
        | null;
      if (json?.ok) {
        setView({ kind: "result", check: json.check, redeemed: true });
        playTone(true);
        void loadHistory();
        clearResetTimer();
        resetTimer.current = setTimeout(() => setView({ kind: "idle" }), RESET_AFTER_REDEEM_MS);
      } else {
        setView({
          kind: "result",
          check: json && !json.ok && json.check ? json.check : current.check,
          error: json && !json.ok ? json.message : "Einlösen fehlgeschlagen",
        });
        playTone(false);
      }
    } catch {
      setView({ ...current, error: "Keine Verbindung. Der Gutschein ist noch nicht eingelöst." });
      playTone(false);
    } finally {
      setRedeeming(false);
      focusInput();
    }
  }, [apiUrl, focusInput, loadHistory, redeeming]);

  const reset = useCallback(() => {
    clearResetTimer();
    setView({ kind: "idle" });
    focusInput();
  }, [focusInput]);

  // Fokus zurück aufs Scanfeld, wenn ein Klick ins Leere ihn weggenommen hat.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      touchRef.current = e.pointerType === "touch";
    };
    const onPointerUp = () => setTimeout(focusInput, 0);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [focusInput]);

  useEffect(() => () => clearResetTimer(), []);

  // ── Kamera ────────────────────────────────────────────────────────────
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      const states = html5Ref.current?.Html5QrcodeScannerState;
      const state = scanner.getState();
      if (states && (state === states.SCANNING || state === states.PAUSED)) await scanner.stop();
    } catch {
      /* schon gestoppt */
    }
    try {
      scanner.clear();
    } catch {
      /* egal */
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraStarting(true);
    try {
      await stopCamera();
      const mod = html5Ref.current ?? (await import("html5-qrcode"));
      html5Ref.current = mod;
      const scanner = new mod.Html5Qrcode("voucher-camera");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: (w: number, h: number) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
        (decoded) => {
          const now = Date.now();
          const last = lastCameraCode.current;
          if (last && last.code === decoded && now - last.at < CAMERA_COOLDOWN_MS) return;
          lastCameraCode.current = { code: decoded, at: now };
          // Liegt derselbe Gutschein schon auf dem Bildschirm, nicht neu prüfen.
          const v = viewRef.current;
          if (v.kind === "checking") return;
          if (v.kind === "result" && v.check.found && v.check.code === decoded.trim()) return;
          void checkRef.current(decoded);
        },
        () => {},
      );
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : "Kamera-Zugriff fehlgeschlagen");
      setCameraOn(false);
    } finally {
      setCameraStarting(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    try {
      if (localStorage.getItem(CAMERA_KEY) === "1") setCameraOn(true);
    } catch {
      /* ohne Speicher bleibt die Kamera aus */
    }
  }, []);

  useEffect(() => {
    if (cameraOn) void startCamera();
    else void stopCamera();
    return () => {
      void stopCamera();
    };
  }, [cameraOn, startCamera, stopCamera]);

  const toggleCamera = () => {
    setCameraOn((on) => {
      const next = !on;
      try {
        localStorage.setItem(CAMERA_KEY, next ? "1" : "0");
      } catch {
        /* egal */
      }
      return next;
    });
  };

  // ── Ansicht ───────────────────────────────────────────────────────────
  return (
    <main className="mx-auto grid w-full max-w-5xl flex-1 content-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardContent className="space-y-3">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void check(code);
              }}
            >
              <div className="min-w-0 flex-1">
                <Input
                  ref={inputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Gutschein scannen oder Code eingeben"
                  aria-label="Gutschein-Code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoFocus
                  className="h-12 font-mono text-base"
                />
              </div>
              <Button type="submit" disabled={!code.trim() || view.kind === "checking"} className="h-12 px-4">
                {view.kind === "checking" ? <Loader2 className="animate-spin" /> : <ScanLine />}
                <span className="max-sm:sr-only">Prüfen</span>
              </Button>
              <Button
                type="button"
                variant={cameraOn ? "secondary" : "outline"}
                onClick={toggleCamera}
                className="size-12 p-0"
                aria-pressed={cameraOn}
                aria-label={cameraOn ? "Kamera ausschalten" : "Kamera einschalten"}
                title={cameraOn ? "Kamera ausschalten" : "Kamera einschalten"}
              >
                {cameraOn ? <CameraOff className="size-5" /> : <Camera className="size-5" />}
              </Button>
            </form>

            {cameraOn && (
              // Kamerabild immer dunkel auf Schwarz, wie im Scanner.
              <div className="relative mx-auto aspect-square w-full max-w-[360px] overflow-hidden rounded-tile bg-black">
                <div id="voucher-camera" className="h-full w-full [&_#qr-shaded-region]:hidden [&_video]:h-full [&_video]:object-cover" />
                {cameraStarting && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <Loader2 className="size-7 animate-spin text-primary" />
                  </div>
                )}
              </div>
            )}
            {cameraError && (
              <Notice tone="danger" compact title="Kamera-Zugriff fehlgeschlagen">
                {cameraError}
              </Notice>
            )}
          </CardContent>
        </Card>

        <ResultCard view={view} redeeming={redeeming} onRedeem={() => void redeem()} onReset={reset} />
      </div>

      <Card flush className="min-w-0 self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 shrink-0 text-primary" />
            Heute eingelöst
            <span className="tabular-nums text-muted-foreground">{history.length}</span>
          </CardTitle>
        </CardHeader>
        {history.length === 0 ? (
          <EmptyState size="sm" title="Heute noch kein Gutschein eingelöst." />
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto border-t border-border">
            {history.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <IconChip icon={CheckCircle2} tone="success" size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{r.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.owner ?? r.code}
                    {r.redeemedVia && r.redeemedVia !== "KASSE" ? ` · ${REDEEMED_VIA_LABEL[r.redeemedVia] ?? r.redeemedVia}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtTime(r.redeemedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

const TONE_BOX: Record<ReturnType<typeof tone>, string> = {
  open: "border-primary/50",
  success: "border-success/50 bg-success/[0.08]",
  danger: "border-destructive/50 bg-destructive/[0.08]",
  warning: "border-warning/50 bg-warning/[0.08]",
};

function ResultCard({
  view,
  redeeming,
  onRedeem,
  onReset,
}: {
  view: View;
  redeeming: boolean;
  onRedeem: () => void;
  onReset: () => void;
}) {
  if (view.kind === "idle") {
    return (
      <Card>
        <EmptyState
          icon={ScanLine}
          title="Gutschein scannen"
          description="Der Gast zeigt den QR-Code in der Kunden-App unter Gutscheine. Handscanner drauf oder Kamera einschalten."
        />
      </Card>
    );
  }
  if (view.kind === "checking") {
    return (
      <Card>
        <div className="flex items-center justify-center gap-3 px-6 py-14 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="font-mono text-sm">{view.code}</span>
        </div>
      </Card>
    );
  }

  const { check, redeemed, error } = view;
  const t = tone(check, redeemed);
  const StatusIcon = t === "success" || t === "open" ? CheckCircle2 : t === "warning" ? TicketX : XCircle;
  const statusText = redeemed ? "Eingelöst" : check.message;
  const statusColor =
    t === "success" || t === "open" ? "text-success" : t === "warning" ? "text-warning" : "text-destructive";

  return (
    <Card className={cn("border-2", TONE_BOX[t])} aria-live="polite">
      <CardContent className="space-y-4 py-1">
        <div className={cn("flex items-center gap-2 text-lg font-semibold", statusColor)}>
          <StatusIcon className="size-6 shrink-0" />
          {statusText}
        </div>

        {check.found ? (
          <>
            <div className="flex items-start gap-3">
              <IconChip icon={Gift} tone="primary" />
              <div className="min-w-0">
                <p className="break-words text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
                  {check.label}
                </p>
                {check.source && <p className="mt-1 text-sm text-muted-foreground">{check.source}</p>}
              </div>
            </div>

            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-label">Fahrer</dt>
                <dd className="flex items-center gap-1.5 font-medium text-foreground">
                  <User className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{check.owner ?? "nicht zugeordnet"}</span>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-label">{check.redeemedAt ? "Eingelöst" : "Gültig bis"}</dt>
                <dd className="tabular-nums text-foreground">
                  {check.redeemedAt
                    ? `${fmtDayTime(check.redeemedAt)}${check.redeemedVia ? ` · ${REDEEMED_VIA_LABEL[check.redeemedVia] ?? check.redeemedVia}` : ""}`
                    : check.expiresAt
                      ? fmtDay(check.expiresAt)
                      : "ohne Ablauf"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-label">Code</dt>
                <dd className="truncate font-mono text-foreground">{check.code}</dd>
              </div>
            </dl>

            {redeemed && (
              <Notice tone="success" compact title={`Jetzt ausgeben: ${check.label}`}>
                Der Gutschein ist entwertet und gilt nicht noch einmal.
              </Notice>
            )}
          </>
        ) : null}

        {error && <Notice tone="danger" compact title={error} role="alert" />}

        <div className="flex flex-wrap gap-2">
          {check.found && check.kind === "BENEFIT" && check.state === "open" && !redeemed && (
            <Button onClick={onRedeem} disabled={redeeming} className="h-14 min-w-0 flex-1 text-base">
              {redeeming ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />}
              Einlösen
            </Button>
          )}
          <Button variant="outline" onClick={onReset} className={cn("h-14 text-base", redeemed || !(check.found && check.state === "open" && check.kind === "BENEFIT") ? "flex-1" : "px-5")}>
            {redeemed ? "Nächster Gutschein" : check.found && check.kind === "BENEFIT" && check.state === "open" ? "Abbrechen" : "Neu scannen"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
