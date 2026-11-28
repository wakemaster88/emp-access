"use client";

/**
 * Shop-Scan im Shop-Monitor (28.11.2026, Aaron: „oben ein Button Shop, da kann
 * ich automatisch die QR-Codes scannen und darunter tauchen die Produkte auf,
 * wie ein Angebot“).
 *
 * Gescannt wird mit dem Handscanner (Tastatureingabe, auch ohne Fokus im Feld)
 * oder mit der Kamera des Geräts (`ShopCamera`: nur auf Tipp, geht nach einer
 * Minute ohne Scan von selbst aus). Jeder Scan geht an
 * POST /api/checkin/public/[token]/shop-scan, das den Artikel im EMP-Shop
 * nachschlägt; Preis und UVP sind die des Preisetiketts. Derselbe Artikel noch
 * einmal zählt die Menge hoch, passen mehrere (doppelte EAN), wählt das
 * Personal. Nur Anzeige: keine Zahlung, keine Buchung im Shop. Das Angebot
 * bleibt auf diesem Gerät gespeichert, bis jemand „Leeren“ tippt.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, CheckCircle2, Loader2, Minus, Plus, ScanLine, Search, ShoppingBag, Trash2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addToOffer,
  formatEuro,
  offerTotals,
  parseStoredOffer,
  setOfferQuantity,
  type ShopArticle,
  type ShopOfferLine,
} from "@/lib/shop-scan";
import { OverlayGrip, overlayScrimClass, overlaySheetClass } from "./checkin-ui";
import { ShopCamera } from "./shop-camera";

/** Frühere Fassung merkte „Kamera an“ je Gerät; die Kamera startet jetzt immer aus. */
const legacyCameraPrefKey = "emp.shop-scan.kamera";
const offerKey = (token: string) => `emp.shop-angebot.${token}`;

type ScanStatus =
  | { tone: "success"; text: string }
  | { tone: "danger"; text: string }
  | { tone: "busy"; text: string };

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* privater Modus: dann eben ohne Merken */
  }
}

function articleLabel(a: ShopArticle): string {
  return [a.name, ...a.options].join(" · ");
}

export function ShopOverlay({
  token,
  onClose,
  pendingScan,
}: {
  token: string;
  onClose: () => void;
  /** Etikett, das außerhalb des Shop-Modus gescannt wurde und hier landen soll. */
  pendingScan?: { code: string; seq: number } | null;
}) {
  const [lines, setLines] = useState<ShopOfferLine[]>(() => parseStoredOffer(typeof window === "undefined" ? null : readStorage(offerKey(token))));
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [busy, setBusy] = useState(0);
  const [choice, setChoice] = useState<{ code: string; articles: ShopArticle[] } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraNote, setCameraNote] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Der Monitor rendert oft neu (Abfragen im Takt); der Tastenpuffer darf dabei nicht verloren gehen.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Angebot auf dem Gerät merken (übersteht Neuladen und Schließen).
  useEffect(() => {
    writeStorage(offerKey(token), lines.length > 0 ? JSON.stringify(lines) : null);
  }, [token, lines]);

  const add = useCallback((article: ShopArticle) => {
    setLines((prev) => addToOffer(prev, article));
    setChoice(null);
    setConfirmClear(false);
    setStatus({ tone: "success", text: `${articleLabel(article)} hinzugefügt` });
    setFlash(article.variantId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }, []);

  const scan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      setBusy((n) => n + 1);
      setStatus({ tone: "busy", text: `Suche ${code} …` });
      try {
        const res = await fetch(`/api/checkin/public/${token}/shop-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const json = (await res.json().catch(() => ({}))) as { code?: string; articles?: ShopArticle[]; error?: string };
        if (!res.ok) {
          setStatus({ tone: "danger", text: json.error ?? "Der Code ließ sich nicht prüfen." });
          return;
        }
        const articles = json.articles ?? [];
        if (articles.length === 0) setStatus({ tone: "danger", text: `Kein Artikel zu „${json.code ?? code}“ im Shop.` });
        else if (articles.length === 1) add(articles[0]!);
        else {
          setChoice({ code: json.code ?? code, articles });
          setStatus({ tone: "busy", text: `${articles.length} Artikel passen zu „${json.code ?? code}“. Bitte wählen.` });
        }
      } catch {
        setStatus({ tone: "danger", text: "Netzwerkfehler beim Scannen." });
      } finally {
        setBusy((n) => n - 1);
      }
    },
    [token, add],
  );
  const scanRef = useRef(scan);
  useEffect(() => { scanRef.current = scan; }, [scan]);

  // Etikett aus dem normalen Monitor-Modus übernehmen.
  const pendingSeq = pendingScan?.seq;
  const pendingCode = pendingScan?.code;
  useEffect(() => {
    if (pendingSeq !== undefined && pendingCode) void scanRef.current(pendingCode);
  }, [pendingSeq, pendingCode]);

  // Am Rechner gleich ins Feld; auf Tablet und Handy nicht, sonst klappt die Tastatur auf.
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  // Handscanner ohne Fokus im Feld: Tasten sammeln, Enter schickt ab (wie im Monitor).
  useEffect(() => {
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key === "Enter") {
        const code = buffer.trim();
        buffer = "";
        if (timer) clearTimeout(timer);
        if (code.length >= 3) { e.preventDefault(); void scanRef.current(code); }
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { buffer = ""; }, 500);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Gemerktes „Kamera an“ der ersten Fassung entfernen.
  useEffect(() => { writeStorage(legacyCameraPrefKey, null); }, []);

  // Kamera: nur auf Tipp; geht nach einer Minute ohne Scan oder im Hintergrund von selbst aus.
  const onCameraCode = useCallback((raw: string) => { void scanRef.current(raw); }, []);
  const onCameraStop = useCallback((reason: { kind: "idle" | "hidden" | "error"; text: string }) => {
    setCameraOn(false);
    setCameraNote({ tone: reason.kind === "error" ? "danger" : "info", text: reason.text });
  }, []);

  const toggleCamera = () => {
    setCameraNote(null);
    setCameraOn((on) => !on);
  };

  const submitInput = () => {
    const code = input.trim();
    if (!code) return;
    setInput("");
    void scan(code);
  };

  const totals = offerTotals(lines);

  return (
    <div className={cn("fixed inset-0 z-50 flex items-end sm:items-center justify-center", overlayScrimClass)} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Shop"
        className={cn(overlaySheetClass, "w-full sm:max-w-3xl h-[92dvh] sm:h-[88dvh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]")}
      >
        <OverlayGrip />
        {/* Kopf: Titel mit Stand, Kamera und Schließen. */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2 min-w-0 text-foreground">
            <ShoppingBag className="h-5 w-5 text-primary shrink-0" />
            Shop
            {lines.length > 0 && (
              <span className="text-muted-foreground text-sm font-normal tabular-nums truncate">
                · {totals.pieces} Stück · {formatEuro(totals.totalCents)}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant={cameraOn ? "default" : "outline"}
              onClick={toggleCamera}
              className="h-11 min-w-11 font-semibold sm:h-14 sm:min-w-14"
              title={cameraOn ? "Kamera aus" : "Mit der Kamera scannen"}
            >
              {cameraOn ? <CameraOff className="size-5" /> : <Camera className="size-5" />}
              <span className="hidden sm:inline">{cameraOn ? "Kamera aus" : "Kamera"}</span>
            </Button>
            <Button
              variant="secondary"
              size="icon-lg"
              onClick={onClose}
              className="size-11 rounded-full sm:size-14"
              aria-label="Schließen"
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>

        {/* Scannen: Feld für Handscanner und Eingabe, darunter das Ergebnis als Fläche. */}
        <div className="px-4 sm:px-5 pt-4 space-y-3 shrink-0">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitInput(); } }}
              placeholder="Etikett scannen oder Artikelnummer eingeben"
              aria-label="Etikett scannen oder Artikelnummer eingeben"
              autoComplete="off"
              autoCapitalize="characters"
              className="h-14 flex-1 px-4 md:text-base"
            />
            <Button onClick={submitInput} disabled={!input.trim()} className="h-14 px-5 font-semibold" aria-label="Suchen">
              <Search className="size-5" />
            </Button>
          </div>

          {cameraOn && <ShopCamera onCode={onCameraCode} onStop={onCameraStop} />}
          {cameraNote && (
            <div
              role={cameraNote.tone === "danger" ? "alert" : "status"}
              className={cn(
                "rounded-tile border p-3 flex items-center gap-3 text-sm font-medium text-foreground",
                cameraNote.tone === "danger" ? "border-destructive/60 bg-destructive/20" : "border-glass-border bg-glass-tile",
              )}
            >
              <CameraOff className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">{cameraNote.text}</span>
              {cameraNote.tone === "info" && (
                <Button variant="outline" onClick={toggleCamera} className="h-11 shrink-0 font-semibold">
                  <Camera className="size-5" />
                  Wieder an
                </Button>
              )}
            </div>
          )}

          {status ? (
            <div
              role={status.tone === "danger" ? "alert" : "status"}
              className={cn(
                "rounded-tile border p-3 flex items-center gap-3 text-sm font-medium text-foreground",
                status.tone === "success" && "border-success/60 bg-success/20",
                status.tone === "danger" && "border-destructive/60 bg-destructive/20",
                status.tone === "busy" && "border-glass-border bg-glass-tile",
              )}
            >
              {status.tone === "success" && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />}
              {status.tone === "danger" && <XCircle className="h-5 w-5 shrink-0 text-destructive" />}
              {status.tone === "busy" && (busy > 0 ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" /> : <ScanLine className="h-5 w-5 shrink-0 text-primary" />)}
              <span className="min-w-0">{status.text}</span>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ScanLine className="size-4 shrink-0" />
              QR-Code des Preisetiketts scannen, Artikelnummer oder EAN geht auch.
            </p>
          )}

          {/* Mehrere Treffer (gleiche EAN an mehreren Varianten): Personal wählt. */}
          {choice && (
            <div className="glass-tile p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-label">Welcher Artikel?</p>
                <Button variant="ghost" size="sm" onClick={() => { setChoice(null); setStatus(null); }} className="text-muted-foreground">
                  Abbrechen
                </Button>
              </div>
              {choice.articles.map((a) => (
                <button
                  key={a.variantId}
                  type="button"
                  onClick={() => add(a)}
                  className="press w-full min-h-14 flex items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-glass-tile outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{a.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[...a.options, a.sku].join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{a.priceDisplay ?? "ohne Preis"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Angebot: eine Zeile je Artikel, neuester oben. */}
        <div className="flex-1 min-h-0 overflow-y-auto monitor-scrollbar px-4 sm:px-5 py-4">
          {lines.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <ShoppingBag className="size-8" />
              <p className="text-sm font-medium text-foreground">Noch keine Artikel</p>
              <p className="text-xs">Gescannte Artikel erscheinen hier mit Preis und Summe.</p>
            </div>
          ) : (
            <ul className="glass-tile divide-y divide-border overflow-hidden">
              {lines.map(({ article: a, quantity }) => (
                <li
                  key={a.variantId}
                  className={cn(
                    "flex flex-wrap items-center gap-3 p-3 transition-colors sm:flex-nowrap",
                    flash === a.variantId && "bg-success/15",
                  )}
                >
                  <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
                    <div className="size-14 shrink-0 overflow-hidden rounded-control bg-white ring-1 ring-inset ring-glass-border">
                      {a.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.imageUrl} alt="" className="size-full object-contain" loading="lazy" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-muted-foreground">
                          <ShoppingBag className="size-5" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold text-foreground">{a.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{[...a.options, a.sku].join(" · ")}</p>
                      {(a.conditionBadge || !a.online || a.priceCents === null) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.conditionBadge && <Badge variant="warning" title={a.conditionNote ?? undefined}>{a.conditionBadge}</Badge>}
                          {!a.online && <Badge variant="neutral">nicht im Onlineshop</Badge>}
                          {a.priceCents === null && <Badge variant="danger">ohne Preis</Badge>}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Menge: 44 px, am Kiosk 56 px. */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-lg"
                      className="size-11 sm:size-14"
                      onClick={() => setLines((prev) => setOfferQuantity(prev, a.variantId, quantity - 1))}
                      aria-label={quantity === 1 ? `${a.name} entfernen` : `${a.name}: eins weniger`}
                    >
                      {quantity === 1 ? <Trash2 className="size-5" /> : <Minus className="size-5" />}
                    </Button>
                    <span className="w-9 text-center text-base font-semibold tabular-nums text-foreground" aria-label="Menge">{quantity}</span>
                    <Button
                      variant="outline"
                      size="icon-lg"
                      className="size-11 sm:size-14"
                      onClick={() => setLines((prev) => setOfferQuantity(prev, a.variantId, quantity + 1))}
                      aria-label={`${a.name}: eins mehr`}
                    >
                      <Plus className="size-5" />
                    </Button>
                  </div>
                  <div className="ml-auto min-w-28 text-right">
                    <p className="text-base font-semibold tabular-nums text-foreground">
                      {a.priceCents === null ? "–" : formatEuro(a.priceCents * quantity)}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {a.priceDisplay ? (quantity > 1 ? `je ${a.priceDisplay}` : a.saving ?? "") : ""}
                    </p>
                    {a.msrpDisplay && (
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        UVP <span className="line-through">{a.msrpDisplay}</span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Summe: groß, darunter Leeren mit Rückfrage. */}
        {lines.length > 0 && (
          <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 flex items-center gap-3">
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <Button variant="destructive" onClick={() => { setLines([]); setConfirmClear(false); setStatus(null); setChoice(null); }} className="h-11 sm:h-14 font-semibold">
                  Alles leeren
                </Button>
                <Button variant="ghost" onClick={() => setConfirmClear(false)} className="h-11 sm:h-14 text-muted-foreground">
                  Abbrechen
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setConfirmClear(true)} className="h-11 sm:h-14 font-semibold">
                <Trash2 className="size-5" />
                Leeren
              </Button>
            )}
            <div className="ml-auto text-right">
              <p className="text-label">Summe inkl. MwSt.</p>
              <p className="text-3xl font-bold tabular-nums text-foreground sm:text-4xl">{formatEuro(totals.totalCents)}</p>
              {totals.withoutPrice > 0 && (
                <p className="text-[11px] text-destructive">
                  {totals.withoutPrice} Artikel ohne Preis nicht eingerechnet
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
