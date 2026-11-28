"use client";

/**
 * „Angebot erstellen“ im Shop-Monitor (28.11.2026, Aaron: „es wird im System
 * erstellt, und PDF wird gedruckt“). Legt das Angebot vom Bildschirm über
 * POST /api/checkin/public/[token]/shop-quote im EMP-Shop an. Der Shop druckt
 * es am Dokumentdrucker (PrintNode); ohne solchen Drucker öffnet der Monitor das
 * PDF mit dem Druckdialog.
 *
 * Kunde: Name und E-Mail sind freiwillig. Eine E-Mail, die der Shop genau einem
 * Kunden zuordnet, macht das Angebot zu seinem; sonst läuft es auf den
 * Laufkunden mit dem Namen im Adressfeld (Aaron: „Laufkunde, Name optional“).
 * Mit Rabatt fragt der Monitor die PIN von EK und Marge, außer EK ist gerade
 * freigeschaltet. Die Freischaltung aus dieser PIN gilt nur, solange die Ansicht
 * offen ist; EK und Marge schaltet sie nicht ein. Name und E-Mail bleiben nur in
 * dieser Ansicht.
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isShopQuoteEmail, SHOP_QUOTE_EMAIL_MAX, SHOP_QUOTE_NAME_MAX, type ShopQuoteView } from "@/lib/shop-quote";
import { formatEuro, isValidShopCostPin, SHOP_COST_PIN_MAX_LENGTH, SHOP_COST_PIN_MIN_LENGTH, type OfferDiscount, type ShopOfferLine } from "@/lib/shop-scan";
import { ShopPinPad } from "./shop-pin-pad";

type QuoteReply = {
  quote?: ShopQuoteView;
  ticket?: string;
  unlock?: string;
  expiresAt?: string;
  error?: string;
  pin?: boolean;
  grossTotalCents?: number;
};

type PrintState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error"; text: string };

function newRequestKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** „2026-12-28“ → „28.12.2026“ */
function dayText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export function ShopQuotePanel({
  token,
  lines,
  discount,
  finalCents,
  unlockRef,
  onPinActive,
  onClose,
  onNewOffer,
}: {
  token: string;
  lines: readonly ShopOfferLine[];
  /** Rabatt, der gerade wirkt; null ohne Rabatt */
  discount: OfferDiscount | null;
  finalCents: number;
  /** Freischaltung von EK und Marge (nur gesetzt, solange EK an ist); ein Angebot mit Rabatt nutzt sie mit */
  unlockRef: MutableRefObject<{ token: string; expiresAt: number } | null>;
  /** PIN-Feld offen: Tasten gehören dann nicht in den Scan */
  onPinActive: (active: boolean) => void;
  onClose: () => void;
  onNewOffer: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinNeeded, setPinNeeded] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [mismatchCents, setMismatchCents] = useState<number | null>(null);
  const [result, setResult] = useState<{ quote: ShopQuoteView; ticket: string } | null>(null);
  const [print, setPrint] = useState<PrintState>({ kind: "idle" });
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const urlRef = useRef<string | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  // Freischaltung aus der PIN dieser Ansicht; geht mit der Ansicht verloren
  const ownUnlockRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const resultLinesRef = useRef<string | null>(null);

  const blocked = lines.find((l) => l.article.priceCents === null)
    ? "Artikel ohne Preis bitte erst entfernen."
    : lines.find((l) => l.article.conditionBadge)
      ? "B-Ware und Muster bitte im Backoffice anbieten."
      : null;
  const emailText = email.trim();
  const emailInvalid = emailText.length > 0 && !isShopQuoteEmail(emailText.toLowerCase());

  const linesSignature = JSON.stringify(lines.map((l) => [l.article.variantId, l.quantity]));

  useEffect(() => { onPinActive(pinNeeded && !result); }, [pinNeeded, result, onPinActive]);
  // Am Rechner gleich ins PIN-Feld; auf dem Tablet die Tasten (sonst klappt die Tastatur auf).
  useEffect(() => {
    if (pinNeeded && window.matchMedia?.("(pointer: fine)").matches) pinInputRef.current?.focus();
  }, [pinNeeded]);
  // Nach dem Anlegen weiter gescannt: zurück zur Eingabe für ein neues Angebot.
  useEffect(() => {
    if (result && resultLinesRef.current !== null && resultLinesRef.current !== linesSignature) {
      setResult(null);
      setPrint({ kind: "idle" });
    }
  }, [result, linesSignature]);
  useEffect(() => () => {
    onPinActive(false);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, [onPinActive]);

  const printInBrowser = async (ticket: string) => {
    setPrint({ kind: "loading" });
    try {
      const res = await fetch(`/api/checkin/public/${token}/shop-quote/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
        cache: "no-store",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setPrint({ kind: "error", text: json.error ?? "Das PDF ließ sich nicht laden." });
        return;
      }
      const blob = await res.blob();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPrint({ kind: "ready", url });
      const frame = frameRef.current;
      if (frame) {
        frame.onload = () => {
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          } catch {
            /* Manche Tablets drucken kein PDF im Rahmen: dann über „PDF öffnen“ */
          }
        };
        frame.src = url;
      }
    } catch {
      setPrint({ kind: "error", text: "Netzwerkfehler beim Laden des PDFs." });
    }
  };

  const submit = async (opts: { pin?: string; expectedCents?: number } = {}) => {
    if (busy || blocked || emailInvalid) return;
    const expectedTotalCents = opts.expectedCents ?? finalCents;
    const payload = {
      items: lines.map((l) => ({ variantId: l.article.variantId, quantity: l.quantity })),
      discount,
      customer: { name: name.trim() || null, email: emailText.toLowerCase() || null },
      expectedTotalCents,
    };
    // Gleicher Inhalt, gleicher Schlüssel: eine Wiederholung nach Netzfehler legt nichts doppelt an
    const signature = JSON.stringify(payload);
    if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key: newRequestKey() };
    const valid = (u: { token: string; expiresAt: number } | null) => (u && u.expiresAt > Date.now() ? u.token : null);
    const unlock = valid(unlockRef.current) ?? valid(ownUnlockRef.current);
    if (discount && !opts.pin && !unlock) {
      setPinNeeded(true);
      setPinError(null);
      return;
    }
    setBusy(true);
    setError(null);
    setMismatchCents(null);
    try {
      const res = await fetch(`/api/checkin/public/${token}/shop-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestKey: attemptRef.current.key, ...(discount ? (opts.pin ? { pin: opts.pin } : { unlock }) : {}) }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as QuoteReply;
      if (json.unlock && json.expiresAt) ownUnlockRef.current = { token: json.unlock, expiresAt: Date.parse(json.expiresAt) };
      if (res.ok && json.quote && json.ticket) {
        setPinNeeded(false);
        setPin("");
        resultLinesRef.current = linesSignature;
        setResult({ quote: json.quote, ticket: json.ticket });
        if (json.quote.print !== "PRINTNODE") void printInBrowser(json.ticket);
        return;
      }
      if (json.pin) {
        if (res.status === 401) ownUnlockRef.current = null;
        setPin("");
        setPinNeeded(true);
        setPinError(json.error ?? "Bitte die PIN eingeben.");
        return;
      }
      if (res.status === 409 && typeof json.grossTotalCents === "number") {
        setMismatchCents(json.grossTotalCents);
        return;
      }
      setError(json.error ?? "Das Angebot ließ sich nicht anlegen.");
    } catch {
      setError("Netzwerkfehler. Bitte noch einmal tippen, es entsteht kein zweites Angebot.");
    } finally {
      setBusy(false);
    }
  };

  const submitPin = () => {
    if (!isValidShopCostPin(pin)) {
      setPinError(`Die PIN hat ${SHOP_COST_PIN_MIN_LENGTH} bis ${SHOP_COST_PIN_MAX_LENGTH} Ziffern.`);
      return;
    }
    void submit({ pin });
  };

  const iframe = (
    <iframe
      ref={frameRef}
      title="Angebot drucken"
      aria-hidden="true"
      tabIndex={-1}
      className="pointer-events-none fixed bottom-0 right-0 size-0 border-0 opacity-0"
    />
  );

  // ── Angelegt ──────────────────────────────────────────────────────────────
  if (result) {
    const q = result.quote;
    return (
      <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 space-y-2.5" aria-live="polite">
        {iframe}
        <div className="rounded-tile border border-success/60 bg-success/20 p-3 flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="min-w-0 space-y-0.5 text-sm">
            <p className="font-semibold text-foreground">
              Angebot {q.number} über {formatEuro(q.grossTotalCents)} angelegt
            </p>
            <p className="text-muted-foreground">
              {q.matched ? `Kunde ${q.customerNumber} ${q.customerName}` : name.trim() ? `Laufkunde, ${name.trim()}` : "Laufkunde"} · gültig bis {dayText(q.validUntil)}
            </p>
            <p className="text-muted-foreground flex items-center gap-1.5">
              <Printer className="size-4 shrink-0" />
              {q.print === "PRINTNODE"
                ? `Wird auf ${q.printerName ?? "dem Dokumentdrucker"} gedruckt.`
                : print.kind === "loading"
                  ? "PDF wird geladen …"
                  : print.kind === "ready"
                    ? "Druckdialog geöffnet. Klappt er nicht, „PDF öffnen“ tippen."
                    : print.kind === "error"
                      ? print.text
                      : (q.printMessage ?? "Druck über diesen Monitor.")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {q.print !== "PRINTNODE" && (
            <Button variant="outline" onClick={() => void printInBrowser(result.ticket)} disabled={print.kind === "loading"} className="h-11 font-semibold sm:h-14">
              {print.kind === "loading" ? <Loader2 className="size-5 animate-spin" /> : <Printer className="size-5" />}
              Nochmal drucken
            </Button>
          )}
          {print.kind === "ready" && (
            <Button asChild variant="outline" className="h-11 font-semibold sm:h-14">
              <a href={print.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-5" />
                PDF öffnen
              </a>
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose} className="h-11 text-muted-foreground sm:h-14">Fertig</Button>
            <Button onClick={onNewOffer} className="h-11 font-semibold sm:h-14">Neues Angebot</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── PIN für das Angebot mit Rabatt ────────────────────────────────────────
  if (pinNeeded) {
    return (
      <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3">
        <ShopPinPad
          title="PIN für das Angebot mit Rabatt"
          value={pin}
          onChange={(v) => { setPin(v); setPinError(null); }}
          onSubmit={submitPin}
          onCancel={() => { setPinNeeded(false); setPin(""); setPinError(null); }}
          busy={busy}
          error={pinError}
          hint="Dieselbe PIN wie für EK und Marge. Ohne Rabatt geht es ohne PIN."
          inputRef={pinInputRef}
        />
      </div>
    );
  }

  // ── Eingabe ───────────────────────────────────────────────────────────────
  return (
    <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          Angebot erstellen
        </p>
        <Button variant="ghost" onClick={onClose} className="h-11 text-muted-foreground">Abbrechen</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, SHOP_QUOTE_NAME_MAX))}
          placeholder="Name (freiwillig)"
          aria-label="Name des Kunden, freiwillig"
          autoComplete="off"
          className="h-14 px-4 md:text-base"
        />
        <Input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value.slice(0, SHOP_QUOTE_EMAIL_MAX)); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          placeholder="E-Mail (freiwillig)"
          aria-label="E-Mail des Kunden, freiwillig"
          aria-invalid={emailInvalid}
          autoComplete="off"
          autoCapitalize="none"
          className="h-14 px-4 md:text-base"
        />
      </div>
      {mismatchCents !== null ? (
        <div role="alert" className="rounded-tile border border-warning/60 bg-warning/15 p-3 space-y-2 text-sm text-foreground">
          <p>
            Im Shop ergibt das Angebot {formatEuro(mismatchCents)} statt {formatEuro(finalCents)}, vermutlich hat sich ein Preis geändert. Es wurde nichts angelegt.
          </p>
          <Button onClick={() => void submit({ expectedCents: mismatchCents })} disabled={busy} className="h-11 font-semibold sm:h-14">
            Mit {formatEuro(mismatchCents)} erstellen
          </Button>
        </div>
      ) : (
        <p role={error || blocked || emailInvalid ? "alert" : undefined} className={cn("text-xs", error || blocked || emailInvalid ? "text-destructive" : "text-muted-foreground")}>
          {error ??
            blocked ??
            (emailInvalid
              ? "Die E-Mail-Adresse ist nicht gültig."
              : "Ohne bekannte E-Mail läuft das Angebot auf „Laufkunde“, der Name steht dann im Adressfeld. Gültig 30 Tage, wird gleich gedruckt.")}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={() => void submit()} disabled={busy || !!blocked || emailInvalid || lines.length === 0} className="h-14 px-5 font-semibold">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Printer className="size-5" />}
          Erstellen und drucken · {formatEuro(finalCents)}
        </Button>
      </div>
    </div>
  );
}
