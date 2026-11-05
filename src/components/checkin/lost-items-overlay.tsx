"use client";

/**
 * Vollbild-Overlay für Fundsachen im Shop-/Checkin-Monitor.
 *
 * Zwei Ansichten in einem Overlay:
 *  1) Liste – Filter (Offen / Abgeholt / Alle) + Suche, große Tap-Targets.
 *  2) Formular – neue Fundsache mit Foto (Live-Kamera via getUserMedia),
 *     Beschreibung, Funddatum und Kontakt anlegen oder bestehende als
 *     abgeholt markieren.
 *
 * Datenlieferant ist /api/checkin/public/[token]/lost-items – dieselbe
 * Tenant-Auflösung über den Monitor-Token wie bei den anderen Overlays.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Loader2, X, PackageSearch, Camera, Check, AlertTriangle,
  RefreshCw, Plus, ChevronLeft, Phone, CalendarDays, Trash2, Undo2, User,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { OverlayGrip, overlayScrimClass, overlaySheetClass } from "./checkin-ui";

/**
 * Segmente am Kiosk 44 px hoch (Segmented kennt keine große Stufe); auf dem Handy
 * schmaler, damit die Segmente samt Zählern auf 390 px passen.
 */
const kioskSegmentClass = "[&>button]:h-11 [&>button]:px-2 sm:[&>button]:px-4";

interface LostItemApi {
  id: number;
  kind: "FOUND" | "LOST_REPORT";
  description: string;
  foundDate: string;
  image: string | null;
  contact: string | null;
  reporterName: string | null;
  callbackPhone: string | null;
  pickedUp: boolean;
  pickedUpAt: string | null;
}

interface LostItemsOverlayProps {
  token: string;
  onClose: () => void;
}

type Filter = "open" | "pickedUp" | "all";

function formatDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/// Aktuelles Video-Frame auf max. 1024px verkleinern → kompakte JPEG-Data-URL.
function captureVideoFrame(video: HTMLVideoElement, maxSize = 1024): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxSize / Math.max(vw, vh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

export function LostItemsOverlay({ token, onClose }: LostItemsOverlayProps) {
  const [items, setItems] = useState<LostItemApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/checkin/public/${token}/lost-items`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      const json = (await res.json()) as { items: LostItemApi[] };
      setItems(json.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(false); }, [load]);

  const openCount = items.filter((i) => !i.pickedUp).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === "open" && i.pickedUp) return false;
      if (filter === "pickedUp" && !i.pickedUp) return false;
      if (!q) return true;
      return [
        i.description,
        i.contact ?? "",
        i.reporterName ?? "",
        i.callbackPhone ?? "",
      ].join(" ").toLowerCase().includes(q);
    });
  }, [items, search, filter]);

  async function togglePickedUp(item: LostItemApi) {
    setBusyId(item.id);
    setError("");
    try {
      const res = await fetch(`/api/checkin/public/${token}/lost-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickedUp: !item.pickedUp }),
      });
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      const updated = (await res.json()) as LostItemApi;
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setBusyId(null);
    }
  }

  // Die Rückfrage („Fundsache wirklich löschen?“) steht inline in der Liste.
  async function deleteItem(item: LostItemApi) {
    setBusyId(item.id);
    setError("");
    try {
      const res = await fetch(`/api/checkin/public/${token}/lost-items/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-end sm:items-center justify-center", overlayScrimClass)}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(overlaySheetClass, "w-full sm:max-w-2xl max-h-[92dvh] flex flex-col pb-[env(safe-area-inset-bottom)] monitor-scrollbar overflow-hidden")}
      >
        <OverlayGrip />
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {adding && (
              <Button
                variant="secondary"
                size="icon-lg"
                onClick={() => setAdding(false)}
                className="size-11 rounded-full sm:size-14"
                title="Zurück"
              >
                <ChevronLeft className="size-5" />
              </Button>
            )}
            <h2 className="text-lg font-semibold flex items-center gap-2 truncate text-foreground">
              <PackageSearch className="h-5 w-5 text-primary shrink-0" />
              {adding ? "Neuer Eintrag" : (
                <>Fundsachen <span className="text-muted-foreground text-sm font-normal tabular-nums">· {openCount} offen</span></>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!adding && (
              <Button
                variant="secondary"
                size="icon-lg"
                onClick={() => load(true)}
                disabled={refreshing}
                className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
                title="Aktualisieren"
              >
                <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              </Button>
            )}
            <Button
              variant="secondary"
              size="icon-lg"
              onClick={onClose}
              className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
              title="Schließen"
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto monitor-scrollbar">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Lädt …
              </p>
            </div>
          )}
          {error && (
            <Notice tone="danger" icon={AlertTriangle} compact title={error} className="m-4" />
          )}

          {!loading && !adding && (
            <ListView
              items={filtered}
              total={items.length}
              openCount={openCount}
              filter={filter}
              setFilter={setFilter}
              search={search}
              setSearch={setSearch}
              busyId={busyId}
              onTogglePickedUp={togglePickedUp}
              onDelete={deleteItem}
              onAdd={() => setAdding(true)}
            />
          )}

          {!loading && adding && (
            <AddForm
              token={token}
              onCreated={(item) => {
                setItems((prev) => [item, ...prev]);
                setAdding(false);
              }}
              onError={setError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── List ───────── */

function ListView({
  items, total, openCount, filter, setFilter, search, setSearch,
  busyId, onTogglePickedUp, onDelete, onAdd,
}: {
  items: LostItemApi[];
  total: number;
  openCount: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
  search: string;
  setSearch: (s: string) => void;
  busyId: number | null;
  onTogglePickedUp: (item: LostItemApi) => void;
  onDelete: (item: LostItemApi) => void;
  onAdd: () => void;
}) {
  // Eintrag, dessen Löschen gerade bestätigt wird (destruktive Rückfrage im
  // selben Sheet statt Browser-Dialog, docs/design-regeln.md, Abschnitt 18).
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // Filter als Segmentwahl; die Anzahl steht als kleine Zahl im Segment.
  const filters: SegmentedOption<Filter>[] = [
    { value: "open", label: "Offen", count: openCount },
    { value: "pickedUp", label: "Erledigt", count: total - openCount },
    { value: "all", label: "Alle", count: total },
  ];

  return (
    <div className="p-4 space-y-3">
      <Button onClick={onAdd} className="w-full h-12 font-semibold sm:h-14">
        <Plus className="size-5" />
        Eintrag erfassen
      </Button>

      <div className="flex flex-col sm:flex-row gap-2">
        <Segmented
          aria-label="Filter"
          value={filter}
          onValueChange={setFilter}
          options={filters}
          stretch
          className={cn(kioskSegmentClass, "sm:w-auto sm:flex-1")}
        />
        <SearchInput
          placeholder="Suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerClassName="sm:w-56 sm:shrink-0"
          className="h-11"
        />
      </div>

      {items.length === 0 && (
        <EmptyState icon={PackageSearch} title="Keine Einträge in dieser Ansicht" compact />
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const isLostReport = item.kind === "LOST_REPORT";
          const contactLine = isLostReport
            ? [item.reporterName, item.callbackPhone].filter(Boolean).join(" · ")
            : item.contact;
          const confirmingDelete = confirmDeleteId === item.id;
          return (
          <div
            key={item.id}
            className={cn(
              "glass-tile flex gap-3 p-3",
              // Rückfrage als eigene Zeile über die volle Kachelbreite.
              confirmingDelete && "flex-wrap",
            )}
          >
            {/* Erledigt: Text und Tasten bleiben lesbar, gedimmt wird nur das Bild (Abschnitt 17);
                den Zustand sagt „Erledigt am …“. */}
            {item.image ? (
              /* eslint-disable-next-line @next/next/no-img-element -- Base64-Data-URL */
              <img
                src={item.image}
                alt={item.description}
                className={cn("h-20 w-20 rounded-xl object-cover border border-border shrink-0", item.pickedUp && "opacity-60")}
              />
            ) : (
              <div className={cn("h-20 w-20 rounded-xl bg-glass-tile border border-glass-border flex items-center justify-center shrink-0", item.pickedUp && "opacity-60")}>
                {isLostReport ? (
                  <User className="h-7 w-7 text-muted-foreground" />
                ) : (
                  <PackageSearch className="h-7 w-7 text-muted-foreground" />
                )}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2">
                {/* Art als Pille: Verlustmeldung in Info-Farbe, Fund als Glas. */}
                <Badge variant={isLostReport ? "info" : "secondary"} className="mt-px">
                  {isLostReport ? "Verlust" : "Fund"}
                </Badge>
                <p className="font-medium text-foreground leading-snug line-clamp-2">{item.description}</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <CalendarDays className="h-3 w-3" />
                  {formatDate(item.foundDate)}
                </span>
                {contactLine && (
                  <span className="inline-flex items-center gap-1 truncate max-w-[180px]">
                    <Phone className="h-3 w-3 shrink-0" />
                    {contactLine}
                  </span>
                )}
                {item.pickedUp && item.pickedUpAt && (
                  <span className="inline-flex items-center gap-1 text-success">
                    <Check className="h-3 w-3" />
                    Erledigt am {formatDate(item.pickedUpAt)}
                  </span>
                )}
              </div>
              {!confirmingDelete && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* Abschließen mit Erfolgs-Symbol, Zurücksetzen ruhig, Löschen erst beim Zeigen rot. */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onTogglePickedUp(item)}
                    disabled={busyId === item.id}
                    className="h-11 font-semibold"
                  >
                    {busyId === item.id ? (
                      <Loader2 className="animate-spin" />
                    ) : item.pickedUp ? (
                      <Undo2 className="text-muted-foreground" />
                    ) : (
                      <Check className="text-success" />
                    )}
                    {item.pickedUp ? "Zurücksetzen" : (isLostReport ? "Erledigt" : "Abgeholt")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteId(item.id)}
                    disabled={busyId === item.id}
                    className="h-11 font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 />
                    Löschen
                  </Button>
                </div>
              )}
            </div>
            {confirmingDelete && (
              <Notice
                tone="danger"
                compact
                title="Fundsache wirklich löschen?"
                className="basis-full"
                action={
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmDeleteId(null)}
                      className="h-11 font-semibold sm:h-14"
                      autoFocus
                    >
                      Abbrechen
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setConfirmDeleteId(null);
                        onDelete(item);
                      }}
                      disabled={busyId === item.id}
                      className="h-11 font-semibold sm:h-14"
                    >
                      <Trash2 />
                      Löschen
                    </Button>
                  </>
                }
              />
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── Add form ───────── */

function AddForm({
  token, onCreated, onError,
}: {
  token: string;
  onCreated: (item: LostItemApi) => void;
  onError: (msg: string) => void;
}) {
  const [kind, setKind] = useState<"FOUND" | "LOST_REPORT">("FOUND");
  const [description, setDescription] = useState("");
  const [foundDate, setFoundDate] = useState(todayDateInput());
  const [contact, setContact] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [callbackPhone, setCallbackPhone] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  const isLostReport = kind === "LOST_REPORT";

  async function handleSave() {
    if (!description.trim()) {
      setLocalError("Beschreibung erforderlich");
      return;
    }
    if (isLostReport) {
      if (!reporterName.trim()) {
        setLocalError("Name erforderlich");
        return;
      }
    }
    setSaving(true);
    setLocalError("");
    try {
      const res = await fetch(`/api/checkin/public/${token}/lost-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          description: description.trim(),
          foundDate: isLostReport ? foundDate : foundDate,
          contact: isLostReport ? null : (contact.trim() || null),
          reporterName: isLostReport ? reporterName.trim() : null,
          callbackPhone: isLostReport ? (callbackPhone.trim() || null) : null,
          image: isLostReport ? null : image,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setLocalError(typeof data?.error === "string" ? data.error : `Server-Fehler (${res.status})`);
        return;
      }
      onCreated((await res.json()) as LostItemApi);
    } catch (err) {
      onError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <Segmented
        aria-label="Art"
        value={kind}
        onValueChange={setKind}
        stretch
        className={kioskSegmentClass}
        options={[
          { value: "FOUND", label: "Fundsache" },
          { value: "LOST_REPORT", label: "Verlustmeldung" },
        ]}
      />

      {!isLostReport && (
        image ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- Base64-Data-URL */}
            <img
              src={image}
              alt="Fundsache"
              className="h-40 w-40 rounded-tile object-cover border border-border"
            />
            <Button
              variant="secondary"
              size="icon-lg"
              onClick={() => setImage(null)}
              className="absolute -top-3 -right-3 size-11 rounded-full hover:bg-destructive/20 hover:text-destructive"
              title="Bild entfernen"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : cameraOpen ? (
          <PhotoCamera
            onCapture={(dataUrl) => {
              setImage(dataUrl);
              setCameraOpen(false);
            }}
            onClose={() => setCameraOpen(false)}
          />
        ) : (
          <button
            onClick={() => setCameraOpen(true)}
            className="flex flex-col items-center justify-center gap-2 h-40 w-40 rounded-tile border-2 border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-foreground transition-colors active:scale-[0.98] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Camera className="h-8 w-8" />
            <span className="text-sm font-medium">Foto aufnehmen</span>
          </button>
        )
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          {isLostReport ? "Was wurde verloren? *" : "Beschreibung *"}
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={
            isLostReport
              ? "z. B. Schwarze Lederjacke, Größe M, mit Schlüsselbund"
              : "z. B. Schwarze Jacke, Größe M, am Eingang gefunden"
          }
          className="resize-none"
        />
      </div>

      {isLostReport ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Name *</label>
              <Input
                type="text"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                maxLength={120}
                placeholder="Max Mustermann"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Rückrufnummer</label>
              <Input
                type="tel"
                value={callbackPhone}
                onChange={(e) => setCallbackPhone(e.target.value)}
                maxLength={40}
                placeholder="0170 1234567"
                className="h-11"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Verlustdatum</label>
            <Input
              type="date"
              value={foundDate}
              onChange={(e) => setFoundDate(e.target.value)}
              className="h-11 [color-scheme:dark]"
            />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Funddatum *</label>
            <Input
              type="date"
              value={foundDate}
              onChange={(e) => setFoundDate(e.target.value)}
              className="h-11 [color-scheme:dark]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Kontakt</label>
            <Input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={300}
              placeholder="Name / Telefon"
              className="h-11"
            />
          </div>
        </div>
      )}

      {localError && (
        <Notice tone="danger" icon={AlertTriangle} compact title={localError} />
      )}

      <Button
        onClick={handleSave}
        disabled={saving}
        className="w-full h-12 font-semibold sm:h-14"
      >
        {saving ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
        {isLostReport ? "Verlustmeldung speichern" : "Fundsache speichern"}
      </Button>
    </div>
  );
}

/* ───────── Live-Kamera für das Fundsachen-Foto ───────── */

function PhotoCamera({
  onCapture, onClose,
}: {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (!cancelled) setReady(true);
        }
      } catch {
        if (!cancelled) setError("Kamera-Zugriff nicht möglich");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facingMode]);

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const dataUrl = captureVideoFrame(video);
    if (!dataUrl) {
      setError("Foto konnte nicht aufgenommen werden");
      return;
    }
    onCapture(dataUrl);
  }

  return (
    // Kamerabild bleibt auf schwarzem Grund (docs/design-regeln.md, Abschnitt 15).
    <div className="rounded-tile border border-border overflow-hidden bg-black max-w-md">
      <div className="relative aspect-[4/3] bg-black flex items-center justify-center">
        {error ? (
          <p className="text-sm text-muted-foreground px-4 text-center">{error}</p>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}
        <Button
          type="button"
          variant="secondary"
          size="icon-lg"
          onClick={onClose}
          className="absolute top-2 right-2 size-11 rounded-full sm:size-14"
          title="Abbrechen"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex items-center justify-between p-2.5 border-t border-border bg-popover">
        <div className="w-16" />
        <button
          type="button"
          onClick={capture}
          disabled={!ready || !!error}
          className="h-14 w-14 rounded-full border-4 border-white bg-white/20 hover:bg-white/40 transition-colors disabled:opacity-30 flex items-center justify-center active:scale-95"
          title="Foto aufnehmen"
        >
          <Camera className="h-5 w-5 text-white" />
        </button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setReady(false);
            setError("");
            setFacingMode((m) => (m === "environment" ? "user" : "environment"));
          }}
          disabled={!!error}
          className="h-11 w-16 gap-1 px-0 has-[>svg]:px-0 text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-4" />
          Drehen
        </Button>
      </div>
    </div>
  );
}
