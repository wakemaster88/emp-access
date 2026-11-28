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
 * Personal. Ein Rabatt aufs Ganze (Prozent, Betrag oder Endpreis) senkt die
 * Summe. Zahlung oder Buchung gibt es hier nicht. Positionen und Rabatt
 * bleiben auf diesem Gerät gespeichert, bis jemand „Leeren“ tippt.
 *
 * Taste „Angebot“ (28.11.2026): legt das Angebot über `ShopQuotePanel` im
 * EMP-Shop an (Nummer AN-…, Laufkunde oder Kunde zur E-Mail) und druckt es.
 *
 * Taste „EK“ (28.11.2026): Einkaufspreis und Marge je Position und fürs Ganze
 * nach Rabatt, dazu der Spielraum bis zum Einstand. Jedes Einschalten fragt die
 * PIN aus Einstellungen › Integrationen › EMP-Shop. EK und Freischaltung stehen
 * nur im Speicher dieser Ansicht (nie im localStorage) und verschwinden mit
 * „EK aus“, nach `SHOP_COSTS_IDLE_OFF_MS` ohne Bedienung, im Hintergrund und
 * beim Schließen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BadgePercent, Camera, CameraOff, CheckCircle2, Eye, EyeOff, FileText, Loader2, Minus, Plus, ScanLine, Search, ShoppingBag, Trash2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ShopCostEntry } from "@/lib/emp-shop-client";
import {
  addToOffer,
  applyOfferDiscount,
  formatEuro,
  formatPercent,
  isValidShopCostPin,
  lineCostView,
  offerMargin,
  offerTotals,
  parseDiscountInput,
  parseStoredDiscount,
  parseStoredOffer,
  setOfferQuantity,
  SHOP_COST_PIN_MAX_LENGTH,
  SHOP_COST_PIN_MIN_LENGTH,
  SHOP_COSTS_IDLE_OFF_MS,
  SHOP_COSTS_MAX_VARIANTS,
  type OfferDiscount,
  type ShopArticle,
  type ShopCost,
  type ShopOfferLine,
} from "@/lib/shop-scan";
import { OverlayGrip, overlayScrimClass, overlaySheetClass } from "./checkin-ui";
import { ShopCamera } from "./shop-camera";
import { ShopPinPad } from "./shop-pin-pad";
import { ShopQuotePanel } from "./shop-quote-panel";

/** Frühere Fassung merkte „Kamera an“ je Gerät; die Kamera startet jetzt immer aus. */
const legacyCameraPrefKey = "emp.shop-scan.kamera";
const offerKey = (token: string) => `emp.shop-angebot.${token}`;
const discountKey = (token: string) => `emp.shop-rabatt.${token}`;

const DISCOUNT_KINDS: Array<{ kind: OfferDiscount["kind"]; label: string; placeholder: string }> = [
  { kind: "percent", label: "Prozent", placeholder: "z. B. 10" },
  { kind: "amount", label: "Betrag", placeholder: "Euro weniger" },
  { kind: "total", label: "Endpreis", placeholder: "Preis für alles" },
];
const QUICK_PERCENTS = [5, 10, 15, 20];

type CostsReply = { unlock?: string; expiresAt?: string; costs?: ShopCostEntry[]; error?: string; pin?: boolean };

/** Einstand aus der Antwort übernehmen; angefragte Varianten ohne Antwort gelten als ohne EK. */
function mergeCosts(prev: ReadonlyMap<string, ShopCost>, requested: readonly string[], entries: readonly ShopCostEntry[]): Map<string, ShopCost> {
  const next = new Map(prev);
  const byId = new Map(entries.map((e) => [e.variantId, e]));
  for (const id of requested) {
    const e = byId.get(id);
    next.set(id, e ? { unitCostE4: e.unitCostE4, basis: e.basis, taxBasisPoints: e.taxBasisPoints } : { unitCostE4: null, basis: null, taxBasisPoints: 0 });
  }
  return next;
}

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
  const [discount, setDiscount] = useState<OfferDiscount | null>(() => parseStoredDiscount(typeof window === "undefined" ? null : readStorage(discountKey(token))));
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountKind, setDiscountKind] = useState<OfferDiscount["kind"]>("percent");
  const [discountInput, setDiscountInput] = useState("");
  const [discountError, setDiscountError] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraNote, setCameraNote] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  // EK und Marge: nur im Speicher, nie im localStorage.
  const [costsOn, setCostsOn] = useState(false);
  const [costs, setCosts] = useState<Map<string, ShopCost>>(() => new Map());
  const [costsError, setCostsError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const unlockRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const inflightRef = useRef(new Set<string>());
  const lastActivityRef = useRef(0);
  const pinOpenRef = useRef(false);
  const quotePinRef = useRef(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Der Monitor rendert oft neu (Abfragen im Takt); der Tastenpuffer darf dabei nicht verloren gehen.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Angebot und Rabatt auf dem Gerät merken (übersteht Neuladen und Schließen).
  useEffect(() => {
    writeStorage(offerKey(token), lines.length > 0 ? JSON.stringify(lines) : null);
  }, [token, lines]);
  useEffect(() => {
    writeStorage(discountKey(token), discount && lines.length > 0 ? JSON.stringify(discount) : null);
  }, [token, discount, lines.length]);

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

  // Etikett aus dem normalen Monitor-Modus übernehmen, jedes genau einmal.
  const pendingSeq = pendingScan?.seq;
  const pendingCode = pendingScan?.code;
  const handledSeqRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingSeq === undefined || !pendingCode || handledSeqRef.current === pendingSeq) return;
    handledSeqRef.current = pendingSeq;
    void scanRef.current(pendingCode);
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
      // PIN-Eingabe offen (EK oder Angebot): Ziffern gehören nicht in den Scan.
      if (pinOpenRef.current || quotePinRef.current) return;
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

  // ── EK und Marge ──────────────────────────────────────────────────────────
  useEffect(() => { pinOpenRef.current = pinOpen; }, [pinOpen]);
  const onQuotePinActive = useCallback((active: boolean) => { quotePinRef.current = active; }, []);

  const requestCosts = useCallback(
    async (body: { pin?: string; unlock?: string; variantIds: string[] }): Promise<{ ok: boolean; status: number; json: CostsReply }> => {
      const res = await fetch(`/api/checkin/public/${token}/shop-costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as CostsReply };
    },
    [token],
  );

  /** EK ausblenden und alles vergessen; mit `askPin` gleich wieder nach der PIN fragen. */
  const hideCosts = useCallback((note?: string, askPin = false) => {
    unlockRef.current = null;
    inflightRef.current.clear();
    setCostsOn(false);
    setCosts(new Map());
    setCostsError(null);
    setPin("");
    setPinOpen(askPin);
    setPinError(askPin ? note ?? null : null);
    if (note && !askPin) setStatus({ tone: "busy", text: note });
  }, []);

  const openPin = () => {
    setDiscountOpen(false);
    setQuoteOpen(false);
    setConfirmClear(false);
    setPin("");
    setPinError(null);
    setPinOpen(true);
  };

  const submitPin = async () => {
    if (pinBusy) return;
    if (!isValidShopCostPin(pin)) {
      setPinError(`Die PIN hat ${SHOP_COST_PIN_MIN_LENGTH} bis ${SHOP_COST_PIN_MAX_LENGTH} Ziffern.`);
      return;
    }
    setPinBusy(true);
    setPinError(null);
    const ids = [...new Set(lines.map((l) => l.article.variantId))].slice(0, SHOP_COSTS_MAX_VARIANTS);
    try {
      const r = await requestCosts({ pin, variantIds: ids });
      setPin("");
      if (!r.json.unlock || !r.json.expiresAt) {
        setPinError(r.json.error ?? "Die PIN ließ sich nicht prüfen.");
        pinInputRef.current?.focus();
        return;
      }
      unlockRef.current = { token: r.json.unlock, expiresAt: Date.parse(r.json.expiresAt) };
      setCosts(r.ok ? mergeCosts(new Map(), ids, r.json.costs ?? []) : new Map());
      setCostsError(r.ok ? null : r.json.error ?? "Die Einkaufspreise ließen sich nicht laden.");
      setCostsOn(true);
      setPinOpen(false);
    } catch {
      setPinError("Netzwerkfehler. Bitte noch einmal versuchen.");
    } finally {
      setPinBusy(false);
    }
  };

  // Am Rechner gleich ins PIN-Feld; auf dem Tablet die Tasten (sonst klappt die Tastatur auf).
  useEffect(() => {
    if (pinOpen && window.matchMedia?.("(pointer: fine)").matches) pinInputRef.current?.focus();
  }, [pinOpen]);

  // Neue Positionen: Einstand nachladen, solange EK an ist.
  useEffect(() => {
    if (!costsOn) return;
    const missing = [...new Set(lines.map((l) => l.article.variantId))].filter((id) => !costs.has(id) && !inflightRef.current.has(id));
    if (missing.length === 0) return;
    const unlock = unlockRef.current;
    if (!unlock || unlock.expiresAt <= Date.now()) {
      hideCosts("Bitte die PIN erneut eingeben.", true);
      return;
    }
    for (let i = 0; i < missing.length; i += SHOP_COSTS_MAX_VARIANTS) {
      const chunk = missing.slice(i, i + SHOP_COSTS_MAX_VARIANTS);
      chunk.forEach((id) => inflightRef.current.add(id));
      void requestCosts({ unlock: unlock.token, variantIds: chunk })
        .then((r) => {
          if (unlockRef.current?.token !== unlock.token) return;
          if (r.status === 401) hideCosts(r.json.error ?? "Bitte die PIN erneut eingeben.", true);
          else if (!r.ok) setCostsError(r.json.error ?? "Die Einkaufspreise ließen sich nicht laden.");
          else {
            setCostsError(null);
            setCosts((prev) => mergeCosts(prev, chunk, r.json.costs ?? []));
          }
        })
        .catch(() => setCostsError("Netzwerkfehler beim Laden der Einkaufspreise."))
        .finally(() => chunk.forEach((id) => inflightRef.current.delete(id)));
    }
  }, [costsOn, lines, costs, requestCosts, hideCosts]);

  // EK geht von selbst aus: ohne Bedienung, im Hintergrund.
  useEffect(() => { lastActivityRef.current = Date.now(); }, [lines]);
  useEffect(() => {
    if (!costsOn) return;
    lastActivityRef.current = Date.now();
    const bump = () => { lastActivityRef.current = Date.now(); };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hideCosts("EK und Marge ausgeblendet, weil die Seite im Hintergrund war.");
    };
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= SHOP_COSTS_IDLE_OFF_MS) {
        hideCosts(`EK und Marge nach ${Math.round(SHOP_COSTS_IDLE_OFF_MS / 60_000)} Minuten ohne Bedienung ausgeblendet.`);
      }
    }, 5_000);
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [costsOn, hideCosts]);

  const submitInput = () => {
    const code = input.trim();
    if (!code) return;
    setInput("");
    void scan(code);
  };

  const totals = offerTotals(lines);
  // Ohne Positionen gilt auch kein Rabatt mehr.
  const activeDiscount = lines.length > 0 ? discount : null;
  const { discountCents, finalCents } = applyOfferDiscount(totals.totalCents, activeDiscount);
  const margin = costsOn ? offerMargin(lines, costs, discountCents) : null;

  const openDiscount = () => {
    setConfirmClear(false);
    setPinOpen(false);
    setQuoteOpen(false);
    setDiscountError(false);
    setDiscountKind(discount?.kind ?? "percent");
    setDiscountInput(
      discount?.kind === "percent"
        ? String(discount.basisPoints / 100).replace(".", ",")
        : discount
          ? (discount.cents / 100).toFixed(2).replace(".", ",")
          : "",
    );
    setDiscountOpen(true);
  };
  const applyDiscount = (next: OfferDiscount | null) => {
    setDiscount(next);
    setDiscountOpen(false);
    setDiscountError(false);
  };
  const submitDiscount = () => {
    const parsed = parseDiscountInput(discountKind, discountInput);
    if (!parsed) { setDiscountError(true); return; }
    applyDiscount(parsed);
  };

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
                · {totals.pieces} Stück · {formatEuro(finalCents)}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant={costsOn ? "default" : "outline"}
              onClick={() => (costsOn ? hideCosts() : pinOpen ? setPinOpen(false) : openPin())}
              aria-pressed={costsOn}
              aria-expanded={pinOpen}
              className="h-11 min-w-11 font-semibold sm:h-14 sm:min-w-14"
              title={costsOn ? "EK und Marge ausblenden" : "EK und Marge anzeigen (PIN)"}
            >
              {costsOn ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              EK
            </Button>
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

        {/* PIN für EK und Marge: Ziffernfeld für den Touch-Monitor, Tastatur geht auch. */}
        {pinOpen && (
          <div className="shrink-0 border-b border-border px-4 sm:px-5 py-3">
            <ShopPinPad
              title="PIN für EK und Marge"
              value={pin}
              onChange={(v) => { setPin(v); setPinError(null); }}
              onSubmit={() => void submitPin()}
              onCancel={() => { setPinOpen(false); setPin(""); setPinError(null); }}
              busy={pinBusy}
              error={pinError}
              hint={`EK und Marge gehen mit „EK“ wieder aus, von selbst nach ${Math.round(SHOP_COSTS_IDLE_OFF_MS / 60_000)} Minuten ohne Bedienung.`}
              inputRef={pinInputRef}
            />
          </div>
        )}

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
                    {costsOn && <LineCost priceCents={a.priceCents} cost={costs.get(a.variantId)} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Rabatt aufs Ganze: Prozent, Betrag oder Endpreis. */}
        {lines.length > 0 && discountOpen && (
          <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rabatt als">
              {DISCOUNT_KINDS.map((k) => (
                <Button
                  key={k.kind}
                  variant={discountKind === k.kind ? "default" : "outline"}
                  onClick={() => { setDiscountKind(k.kind); setDiscountError(false); }}
                  aria-pressed={discountKind === k.kind}
                  className="h-11 font-semibold sm:h-14"
                >
                  {k.label}
                </Button>
              ))}
              {discountKind === "percent" && QUICK_PERCENTS.map((p) => (
                <Button key={p} variant="secondary" onClick={() => applyDiscount({ kind: "percent", basisPoints: p * 100 })} className="h-11 tabular-nums sm:h-14">
                  {p} %
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  autoFocus
                  value={discountInput}
                  onChange={(e) => { setDiscountInput(e.target.value); setDiscountError(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitDiscount(); } if (e.key === "Escape") { e.stopPropagation(); setDiscountOpen(false); } }}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={DISCOUNT_KINDS.find((k) => k.kind === discountKind)?.placeholder}
                  aria-label={`Rabatt: ${DISCOUNT_KINDS.find((k) => k.kind === discountKind)?.label}`}
                  aria-invalid={discountError}
                  className="h-14 pr-10 px-4 md:text-base tabular-nums"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {discountKind === "percent" ? "%" : "€"}
                </span>
              </div>
              <Button onClick={submitDiscount} className="h-14 px-5 font-semibold">Übernehmen</Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className={cn("text-xs", discountError ? "text-destructive" : "text-muted-foreground")}>
                {discountError
                  ? discountKind === "percent" ? "Bitte eine Zahl über 0 bis 100 eingeben." : "Bitte einen Betrag in Euro eingeben, z. B. 49,90."
                  : `Summe ohne Rabatt ${formatEuro(totals.totalCents)}`}
              </p>
              <div className="flex gap-1.5">
                {discount && (
                  <Button variant="ghost" onClick={() => applyDiscount(null)} className="h-11 text-muted-foreground sm:h-14">Kein Rabatt</Button>
                )}
                <Button variant="ghost" onClick={() => setDiscountOpen(false)} className="h-11 text-muted-foreground sm:h-14">Abbrechen</Button>
              </div>
            </div>
          </div>
        )}

        {/* Angebot im EMP-Shop anlegen und drucken. */}
        {lines.length > 0 && quoteOpen && (
          <ShopQuotePanel
            token={token}
            lines={lines}
            discount={discountCents > 0 ? activeDiscount : null}
            finalCents={finalCents}
            unlockRef={unlockRef}
            onPinActive={onQuotePinActive}
            onClose={() => setQuoteOpen(false)}
            onNewOffer={() => { setLines([]); setDiscount(null); setQuoteOpen(false); setStatus(null); setChoice(null); }}
          />
        )}

        {/* Summe: groß, links Leeren mit Rückfrage, Rabatt und Angebot. */}
        {lines.length > 0 && (
          <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3">
            {margin && <OfferMarginPanel margin={margin} discounted={discountCents > 0} error={costsError} />}
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <Button variant="destructive" onClick={() => { setLines([]); setDiscount(null); setDiscountOpen(false); setQuoteOpen(false); setConfirmClear(false); setStatus(null); setChoice(null); }} className="h-11 sm:h-14 font-semibold">
                  Alles leeren
                </Button>
                <Button variant="ghost" onClick={() => setConfirmClear(false)} className="h-11 sm:h-14 text-muted-foreground">
                  Abbrechen
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => { setDiscountOpen(false); setQuoteOpen(false); setConfirmClear(true); }} className="h-11 sm:h-14 font-semibold">
                  <Trash2 className="size-5" />
                  Leeren
                </Button>
                <Button
                  variant={activeDiscount ? "default" : "outline"}
                  onClick={() => (discountOpen ? setDiscountOpen(false) : openDiscount())}
                  aria-expanded={discountOpen}
                  className="h-11 sm:h-14 font-semibold"
                >
                  <BadgePercent className="size-5" />
                  Rabatt
                </Button>
                <Button
                  variant={quoteOpen ? "default" : "outline"}
                  onClick={() => { setDiscountOpen(false); setPinOpen(false); setQuoteOpen((o) => !o); }}
                  aria-expanded={quoteOpen}
                  className="h-11 sm:h-14 font-semibold"
                >
                  <FileText className="size-5" />
                  Angebot
                </Button>
              </div>
            )}
            <div className="ml-auto text-right">
              {discountCents > 0 && (
                <div className="mb-1 space-y-0.5 text-sm tabular-nums">
                  <p className="text-muted-foreground">
                    Zwischensumme <span className="text-foreground">{formatEuro(totals.totalCents)}</span>
                  </p>
                  <p className="font-semibold text-success">
                    Rabatt {formatPercent(discountCents, totals.totalCents)} −{formatEuro(discountCents)}
                  </p>
                </div>
              )}
              <p className="text-label">Summe inkl. MwSt.</p>
              <p className="text-3xl font-bold tabular-nums text-foreground sm:text-4xl">{formatEuro(finalCents)}</p>
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

/** EK und Marge je Stück zum Etikettenpreis, unter dem Preis der Position. */
function LineCost({ priceCents, cost }: { priceCents: number | null; cost: ShopCost | undefined }) {
  if (!cost) {
    return <p className="mt-0.5 text-[11px] text-muted-foreground">EK …</p>;
  }
  const view = lineCostView(priceCents, cost);
  if (!view) return <p className="mt-0.5 text-[11px] font-medium text-warning">EK unbekannt</p>;
  return (
    <p className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
      EK {formatEuro(view.unitCostCents)}
      {view.marginCents !== null && view.netCents !== null && (
        <>
          {" · "}
          <span className={cn("font-semibold", view.marginCents < 0 ? "text-destructive" : "text-success")}>
            {formatPercent(view.marginCents, view.netCents)}
          </span>
        </>
      )}
    </p>
  );
}

/** EK netto, Marge nach Rabatt und Spielraum bis zum Einstand fürs ganze Angebot. */
function OfferMarginPanel({
  margin,
  discounted,
  error,
}: {
  margin: ReturnType<typeof offerMargin>;
  discounted: boolean;
  error: string | null;
}) {
  const loading = margin.pending > 0;
  const under = margin.marginCents < 0;
  let room: React.ReactNode;
  if (loading) room = "…";
  else if (margin.roomCents === null) room = "–";
  else if (margin.roomCents > 0) room = <>noch {formatEuro(margin.roomCents)}</>;
  else room = under ? "unter EK" : "keiner";
  return (
    <div className="basis-full rounded-tile border border-glass-border bg-glass-tile p-2.5 space-y-1.5" aria-label="EK und Marge">
      <div className="grid grid-cols-3 gap-2 tabular-nums">
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">EK netto</p>
          <p className="text-sm font-semibold text-foreground">{loading ? "…" : formatEuro(margin.costCents)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{discounted ? "Marge nach Rabatt" : "Marge"}</p>
          <p className={cn("text-sm font-semibold", under ? "text-destructive" : "text-success")}>
            {loading ? "…" : (
              <>
                {formatEuro(margin.marginCents)}{" "}
                <span className="whitespace-nowrap max-sm:block">
                  <span className="max-sm:hidden">· </span>
                  {formatPercent(margin.marginCents, margin.netCents)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">Spielraum bis EK</p>
          <p className={cn("text-sm font-semibold", under && margin.roomCents !== null ? "text-destructive" : "text-foreground")}>{room}</p>
          {margin.breakEvenCents !== null && (
            <p className="text-[11px] text-muted-foreground">Endpreis ab {formatEuro(margin.breakEvenCents)}</p>
          )}
        </div>
      </div>
      {(error || margin.withoutCost > 0) && (
        <p className={cn("text-[11px]", error ? "text-destructive" : "text-warning")}>
          {error ??
            `${margin.withoutCost} ${margin.withoutCost === 1 ? "Position" : "Positionen"} ohne EK, nicht in Marge und Spielraum.`}
        </p>
      )}
    </div>
  );
}
