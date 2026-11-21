"use client";

/**
 * Abo mit der Kunden-App verknüpfen (Shop-Monitor). Der Kunde zeigt in der
 * App unter Profil › „Abo fehlt?“ einen QR-Code; das Personal scannt ihn und
 * die Abo-Karte (Reihenfolge egal) und wählt, wer mit dem Abo fährt.
 * Öffnen: App-Code scannen, oder im Kunden-Dialog „Mit App verbinden“ (dann
 * steht das Abo schon fest). Ohne Handscanner: Code eintippen oder mit der
 * Kamera des Geräts scannen.
 * Server: POST /api/checkin/public/[token]/app-link, lib/rider-kasse-link.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, Link2Off, Loader2, ScanLine, Smartphone, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import type { CheckinTicket } from "./checkin-types";
import { personName } from "./checkin-utils";

/** Gescannter App-Code, wie ihn POST …/scan als `appLink` liefert. */
export interface AppLinkScan {
  code: string;
  profileId: number;
  name: string;
  maskedEmail: string | null;
  /** App eines Kindes der Familie: verknüpfen geht nur mit Erwachsenen. */
  child: boolean;
}

export interface AppLinkState {
  app: AppLinkScan | null;
  ticket: CheckinTicket | null;
  /** Hinweis zum letzten Scan (abgelaufener Code, kein Abo …). */
  notice: string | null;
}

type Role = "self" | "child";

function firstWord(v: string | null | undefined): string {
  return (v ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/** Vorschlag, wer fährt; null, wenn es nicht klar ist. */
export function guessRole(app: AppLinkScan | null, ticket: CheckinTicket | null): Role | null {
  if (!app || !ticket) return null;
  const appFirst = firstWord(app.name);
  if (appFirst && firstWord(ticket.firstName) === appFirst) return "self";
  if (/kid/i.test(ticket.subscription?.name ?? "")) return "child";
  return null;
}

function fmtDay(iso: string | null): string {
  if (!iso) return "ohne Ende";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const CAMERA_ID = "app-link-camera";

/**
 * Code ohne Handscanner: eintippen (Ziffern unter dem QR-Code in der App) oder
 * mit der Kamera dieses Geräts scannen. Jeder Code geht wie ein Scan an die
 * Kasse; die erkennt App-Code oder Abo-Karte selbst.
 */
function CodeEntry({ placeholder, busy, onScan }: { placeholder: string; busy: boolean; onScan: (code: string) => void }) {
  const [value, setValue] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      /* schon gestoppt */
    }
    try {
      scanner.clear();
    } catch {
      /* egal */
    }
  }, []);

  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new mod.Html5Qrcode(CAMERA_ID);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: (w: number, h: number) => { const n = Math.floor(Math.min(w, h) * 0.75); return { width: n, height: n }; } },
          (decoded) => {
            setCameraOn(false);
            onScanRef.current(decoded);
          },
          () => {},
        );
      } catch (err) {
        if (!cancelled) {
          setCameraError(err instanceof Error && err.message ? err.message : "Die Kamera ließ sich nicht starten.");
          setCameraOn(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void stopCamera();
    };
  }, [cameraOn, stopCamera]);

  function submit() {
    const code = value.trim();
    if (!code || busy) return;
    setValue("");
    onScan(code);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={placeholder}
          aria-label={placeholder}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          className="min-h-11 flex-1 font-mono sm:min-h-14"
        />
        <Button variant="secondary" className="min-h-11 sm:min-h-14" disabled={!value.trim() || busy} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Übernehmen
        </Button>
      </div>
      <Button
        variant="outline"
        className="min-h-11 w-full sm:min-h-14"
        onClick={() => { setCameraError(null); setCameraOn((v) => !v); }}
      >
        {cameraOn ? <CameraOff /> : <Camera />}
        {cameraOn ? "Kamera aus" : "Mit Kamera scannen"}
      </Button>
      {cameraOn && <div id={CAMERA_ID} className="mx-auto w-full max-w-xs overflow-hidden rounded-control bg-black" />}
      {cameraError && <Notice tone="danger" compact title={`Kamera: ${cameraError}`} />}
    </div>
  );
}

export function AppLinkDialog({
  token,
  state,
  onClose,
  onLinked,
  onScan,
  scanning = false,
}: {
  token: string;
  state: AppLinkState | null;
  onClose: () => void;
  onLinked: () => void;
  /** Eingetippter oder per Kamera gelesener Code: geht wie ein Scan an die Kasse. */
  onScan?: (code: string) => void;
  scanning?: boolean;
}) {
  const app = state?.app ?? null;
  const ticket = state?.ticket ?? null;
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Das Abo hängt schon an einer anderen Person: lösbar nach Rückfrage. */
  const [linked, setLinked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** Wo das Abo gerade in der App steht („Aaron, Kind in der Familie von Anna“); null: nirgends. */
  const [owner, setOwner] = useState<{ ticketId: number; text: string | null } | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);

  // Neues Abo oder neue App: Auswahl und Meldungen zurücksetzen.
  const key = `${app?.profileId ?? ""}:${ticket?.id ?? ""}`;
  const [shownKey, setShownKey] = useState(key);
  if (key !== shownKey) {
    setShownKey(key);
    setRole(guessRole(app, ticket));
    setError(null);
    setDone(null);
    setLinked(null);
    setConfirming(false);
  }

  const ticketId = ticket?.id ?? null;
  useEffect(() => {
    if (ticketId == null) return;
    let cancelled = false;
    fetch(`/api/checkin/public/${token}/app-link?ticketId=${ticketId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { owner?: { text?: string } | null } | null) => {
        if (!cancelled && json) setOwner({ ticketId, text: json.owner?.text ?? null });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, ticketId, done]);
  const ownerLine = owner && owner.ticketId === ticketId ? owner.text : undefined;
  useEffect(() => {
    if (state == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Dialog zu: für das nächste Mal leeren
      setDone(null);
      setError(null);
    }
  }, [state]);

  const name = app?.name ?? "";
  const canLink = !!app && !app.child && !!ticket && ticket.subscriptionId != null && role != null && !busy && !done;

  async function post(replace: boolean): Promise<{ ok: true; message: string } | { ok: false; error: string; replaceable: boolean }> {
    try {
      const res = await fetch(`/api/checkin/public/${token}/app-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: app!.code, ticketId: ticket!.id, role, ...(replace && { replace: true }) }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string; replaceable?: boolean };
      if (!res.ok) return { ok: false, error: json.error ?? "Verknüpfen fehlgeschlagen. Bitte noch einmal versuchen.", replaceable: json.replaceable === true };
      return { ok: true, message: json.message ?? "Verknüpft." };
    } catch {
      return { ok: false, error: "Keine Verbindung. Bitte noch einmal versuchen.", replaceable: false };
    }
  }

  async function link() {
    if (!canLink || !app || !ticket || !role) return;
    setBusy(true);
    setError(null);
    setLinked(null);
    const r = await post(false);
    setBusy(false);
    if (!r.ok) {
      if (r.replaceable) setLinked(r.error);
      else setError(r.error);
      return;
    }
    setDone(r.message);
    onLinked();
  }

  /** Nach Rückfrage: bisherige Verknüpfung lösen und neu verknüpfen. Fehler zeigt die Rückfrage. */
  async function relink() {
    if (!app || !ticket || !role) return;
    const r = await post(true);
    if (!r.ok) throw new Error(r.error);
    setConfirming(false);
    setLinked(null);
    setDone(r.message);
    onLinked();
  }

  const waitingFor = !app ? "den App-Code" : !ticket ? "die Abo-Karte" : null;

  return (
    <Dialog open={state != null} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent
        className="dark [color-scheme:dark] sm:max-w-xl"
        // Der Scanner schickt am Ende Enter: das darf keine Taste im Dialog
        // auslösen. Fokus daher auf den Inhalt, Enter ohne Wirkung.
        onOpenAutoFocus={(e) => { e.preventDefault(); focusRef.current?.focus(); }}
        onKeyDownCapture={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      >
        <div ref={focusRef} tabIndex={-1} className="grid gap-4 outline-none">
          <DialogHeader>
            <DialogTitle className="text-xl">Abo mit der App verknüpfen</DialogTitle>
            <DialogDescription>
              {waitingFor
                ? `Jetzt ${waitingFor} scannen, eintippen oder mit der Kamera lesen.`
                : "Danach steht das Abo in der App, die Adresse der App hängt am Kundenkonto des Abos."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="glass-tile flex min-h-16 items-center gap-3 px-3 py-2.5">
              <Smartphone className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">App</div>
                {app ? (
                  <>
                    <div className="truncate font-medium">{app.name}</div>
                    {app.maskedEmail && <div className="truncate text-xs text-muted-foreground">{app.maskedEmail}</div>}
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-muted-foreground"><ScanLine className="size-4" aria-hidden /> Code scannen</div>
                )}
              </div>
            </div>
            <div className="glass-tile flex min-h-16 items-center gap-3 px-3 py-2.5">
              <Ticket className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Abo</div>
                {ticket ? (
                  <>
                    <div className="truncate font-medium">{ticket.subscription?.name ?? "Abo"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {personName(ticket)} · bis {fmtDay(ticket.endDate)}
                    </div>
                    {ownerLine !== undefined && (
                      <div className="text-xs text-muted-foreground">
                        {ownerLine ? `In der App: ${ownerLine}` : "Noch in keiner App"}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-muted-foreground"><ScanLine className="size-4" aria-hidden /> Karte scannen</div>
                )}
              </div>
            </div>
          </div>

          {waitingFor && !done && onScan && (
            <CodeEntry
              key={waitingFor}
              placeholder={!app ? "App-Code eingeben" : "Code der Abo-Karte eingeben"}
              busy={scanning}
              onScan={onScan}
            />
          )}

          {state?.notice && !done && <Notice tone="danger" compact title={state.notice} />}
          {app?.child && (
            <Notice tone="danger" compact title="Das ist die App eines Kindes der Familie. Bitte die App eines Erwachsenen scannen." />
          )}

          {app && !app.child && ticket && !done && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Wer fährt mit dem Abo?</div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Wer fährt mit dem Abo?">
                {([
                  ["self", `${name} selbst`],
                  ["child", `Ein Kind von ${name}`],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={role === value}
                    onClick={() => { setRole(value); setLinked(null); setConfirming(false); }}
                    className={cn(
                      "press min-h-14 rounded-control px-3 text-base font-medium ring-1 ring-inset transition-colors",
                      role === value
                        ? "bg-primary text-primary-foreground ring-primary"
                        : "bg-glass-tile text-foreground ring-glass-border hover:bg-glass-strong",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {role === "child" && (
                <p className="text-xs text-muted-foreground">Das Kind kommt in die Familie von {name} und steht dann mit in dieser App.</p>
              )}
            </div>
          )}

          {error && <Notice tone="danger" title={error} />}
          {linked && !confirming && !done && (
            <Notice tone="warning" title={linked}>
              <Button variant="outline" className="mt-2 min-h-11 sm:min-h-14" onClick={() => setConfirming(true)}>
                <Link2Off />
                Bisherige Verknüpfung lösen
              </Button>
            </Notice>
          )}
          {done && <Notice tone="success" title={done}>In der App auf „Fertig“ tippen, dann erscheint das Abo.</Notice>}

          {confirming && linked && !done ? (
            <ConfirmStep
              title="Bisherige Verknüpfung lösen?"
              description={
                <>
                  {ticket?.subscription?.name ?? "Das Abo"} verschwindet aus der bisherigen App
                  {ownerLine ? ` (${ownerLine})` : ""} und steht danach{" "}
                  {role === "child" ? `als Kind in der Familie von ${name}` : `in der App von ${name}`}. Besuche, Starts und
                  Awards bleiben am Abo.
                </>
              }
              confirmLabel="Lösen und verknüpfen"
              icon={Link2Off}
              onConfirm={relink}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <DialogFooter>
              {done ? (
                <Button className="min-h-11 sm:min-h-14" onClick={onClose}>Fertig</Button>
              ) : (
                <>
                  <Button variant="outline" className="min-h-11 sm:min-h-14" disabled={busy} onClick={onClose}>Abbrechen</Button>
                  <Button className="min-h-11 sm:min-h-14" disabled={!canLink} onClick={() => void link()}>
                    {busy && <Loader2 className="animate-spin" />}
                    {error ? "Erneut versuchen" : "Verknüpfen"}
                  </Button>
                </>
              )}
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
