"use client";

/**
 * Abo mit der Kunden-App verknüpfen (Shop-Monitor). Der Kunde zeigt in der
 * App unter Profil › „Abo fehlt?“ einen QR-Code; das Personal scannt ihn und
 * die Abo-Karte (Reihenfolge egal) und wählt, wer mit dem Abo fährt.
 * Server: POST /api/checkin/public/[token]/app-link, lib/rider-kasse-link.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, ScanLine, Smartphone, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

export function AppLinkDialog({
  token,
  state,
  onClose,
  onLinked,
}: {
  token: string;
  state: AppLinkState | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const app = state?.app ?? null;
  const ticket = state?.ticket ?? null;
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);

  // Neues Abo oder neue App: Auswahl und Meldungen zurücksetzen.
  const key = `${app?.profileId ?? ""}:${ticket?.id ?? ""}`;
  const [shownKey, setShownKey] = useState(key);
  if (key !== shownKey) {
    setShownKey(key);
    setRole(guessRole(app, ticket));
    setError(null);
    setDone(null);
  }
  useEffect(() => {
    if (state == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Dialog zu: für das nächste Mal leeren
      setDone(null);
      setError(null);
    }
  }, [state]);

  const name = app?.name ?? "";
  const canLink = !!app && !app.child && !!ticket && ticket.subscriptionId != null && role != null && !busy && !done;

  async function link() {
    if (!canLink || !app || !ticket || !role) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkin/public/${token}/app-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: app.code, ticketId: ticket.id, role }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Verknüpfen fehlgeschlagen. Bitte noch einmal versuchen.");
        return;
      }
      setDone(json.message ?? "Verknüpft.");
      onLinked();
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    } finally {
      setBusy(false);
    }
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
                ? `Jetzt ${waitingFor} scannen.`
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
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-muted-foreground"><ScanLine className="size-4" aria-hidden /> Karte scannen</div>
                )}
              </div>
            </div>
          </div>

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
                    onClick={() => setRole(value)}
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
          {done && <Notice tone="success" title={done}>In der App auf „Fertig“ tippen, dann erscheint das Abo.</Notice>}

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
        </div>
      </DialogContent>
    </Dialog>
  );
}
