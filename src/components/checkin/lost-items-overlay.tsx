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
  Loader2, Search, X, PackageSearch, Camera, Check, AlertTriangle,
  RefreshCw, Plus, ChevronLeft, Phone, CalendarDays, Trash2, Undo2, User,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

  async function deleteItem(item: LostItemApi) {
    if (!confirm("Fundsache wirklich löschen?")) return;
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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl w-full sm:max-w-2xl max-h-[92dvh] flex flex-col pb-[env(safe-area-inset-bottom)] monitor-scrollbar overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {adding && (
              <button
                onClick={() => setAdding(false)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-95"
                title="Zurück"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <h2 className="text-lg font-bold flex items-center gap-2 truncate text-white">
              <PackageSearch className="h-5 w-5 text-amber-400 shrink-0" />
              {adding ? "Neuer Eintrag" : (
                <>Fundsachen <span className="text-slate-500 text-sm font-normal">· {openCount} offen</span></>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!adding && (
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white active:scale-95"
                title="Aktualisieren"
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white active:scale-95"
              title="Schließen"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto monitor-scrollbar">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
            </div>
          )}
          {error && (
            <div className="m-4 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300 text-sm px-4 py-3 inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
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
  const filters: { id: Filter; label: string }[] = [
    { id: "open", label: `Offen (${openCount})` },
    { id: "pickedUp", label: `Erledigt (${total - openCount})` },
    { id: "all", label: `Alle (${total})` },
  ];

  return (
    <div className="p-4 space-y-3">
      <button
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-3 rounded-xl font-semibold transition-colors active:scale-[0.99]"
      >
        <Plus className="h-5 w-5" />
        Eintrag erfassen
      </button>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "px-3 py-2 rounded-xl text-sm font-medium transition-colors active:scale-95",
                filter === f.id
                  ? "bg-amber-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-52 pl-9 pr-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
      </div>

      {items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
          <PackageSearch className="h-12 w-12 text-slate-700" />
          <p className="text-sm">Keine Einträge in dieser Ansicht</p>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const isLostReport = item.kind === "LOST_REPORT";
          const contactLine = isLostReport
            ? [item.reporterName, item.callbackPhone].filter(Boolean).join(" · ")
            : item.contact;
          return (
          <div
            key={item.id}
            className={cn(
              "flex gap-3 rounded-2xl border border-slate-800 bg-slate-800/40 p-3",
              item.pickedUp && "opacity-60"
            )}
          >
            {item.image ? (
              /* eslint-disable-next-line @next/next/no-img-element -- Base64-Data-URL */
              <img
                src={item.image}
                alt={item.description}
                className="h-20 w-20 rounded-xl object-cover border border-slate-700 shrink-0"
              />
            ) : (
              <div className="h-20 w-20 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                {isLostReport ? (
                  <User className="h-7 w-7 text-slate-600" />
                ) : (
                  <PackageSearch className="h-7 w-7 text-slate-600" />
                )}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2">
                <span className={cn(
                  "shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded",
                  isLostReport ? "bg-violet-950/60 text-violet-300" : "bg-amber-950/60 text-amber-300"
                )}>
                  {isLostReport ? "Verlust" : "Fund"}
                </span>
                <p className="font-medium text-white leading-snug line-clamp-2">{item.description}</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
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
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <Check className="h-3 w-3" />
                    Erledigt am {formatDate(item.pickedUpAt)}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => onTogglePickedUp(item)}
                  disabled={busyId === item.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors active:scale-95",
                    item.pickedUp
                      ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  )}
                >
                  {busyId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : item.pickedUp ? (
                    <Undo2 className="h-3.5 w-3.5" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {item.pickedUp ? "Zurücksetzen" : (isLostReport ? "Erledigt" : "Abgeholt")}
                </button>
                <button
                  onClick={() => onDelete(item)}
                  disabled={busyId === item.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 transition-colors active:scale-95"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Löschen
                </button>
              </div>
            </div>
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
      <div className="flex gap-1.5 p-1 rounded-xl bg-slate-800">
        <button
          type="button"
          onClick={() => setKind("FOUND")}
          className={cn(
            "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            kind === "FOUND" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"
          )}
        >
          Fundsache
        </button>
        <button
          type="button"
          onClick={() => setKind("LOST_REPORT")}
          className={cn(
            "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            kind === "LOST_REPORT" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
          )}
        >
          Verlustmeldung
        </button>
      </div>

      {!isLostReport && (
        image ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- Base64-Data-URL */}
            <img
              src={image}
              alt="Fundsache"
              className="h-40 w-40 rounded-2xl object-cover border border-slate-700"
            />
            <button
              onClick={() => setImage(null)}
              className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-slate-800 border border-slate-600 text-white flex items-center justify-center hover:bg-rose-600 active:scale-95"
              title="Bild entfernen"
            >
              <X className="h-4 w-4" />
            </button>
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
            className="flex flex-col items-center justify-center gap-2 h-40 w-40 rounded-2xl border-2 border-dashed border-slate-700 text-slate-500 hover:border-amber-500 hover:text-amber-400 transition-colors active:scale-[0.98]"
          >
            <Camera className="h-8 w-8" />
            <span className="text-sm font-medium">Foto aufnehmen</span>
          </button>
        )
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-300">
          {isLostReport ? "Was wurde verloren? *" : "Beschreibung *"}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={
            isLostReport
              ? "z. B. Schwarze Lederjacke, Größe M, mit Schlüsselbund"
              : "z. B. Schwarze Jacke, Größe M, am Eingang gefunden"
          }
          className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
        />
      </div>

      {isLostReport ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Name *</label>
              <input
                type="text"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                maxLength={120}
                placeholder="Max Mustermann"
                className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Rückrufnummer</label>
              <input
                type="tel"
                value={callbackPhone}
                onChange={(e) => setCallbackPhone(e.target.value)}
                maxLength={40}
                placeholder="0170 1234567"
                className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Verlustdatum</label>
            <input
              type="date"
              value={foundDate}
              onChange={(e) => setFoundDate(e.target.value)}
              className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 [color-scheme:dark]"
            />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Funddatum *</label>
            <input
              type="date"
              value={foundDate}
              onChange={(e) => setFoundDate(e.target.value)}
              className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500 [color-scheme:dark]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Kontakt</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={300}
              placeholder="Name / Telefon"
              className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
        </div>
      )}

      {localError && (
        <p className="text-sm text-rose-400 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {localError}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className={cn(
          "w-full flex items-center justify-center gap-2 disabled:opacity-60 text-white px-4 py-3 rounded-xl font-semibold transition-colors active:scale-[0.99]",
          isLostReport ? "bg-violet-600 hover:bg-violet-500" : "bg-amber-600 hover:bg-amber-500"
        )}
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
        {isLostReport ? "Verlustmeldung speichern" : "Fundsache speichern"}
      </button>
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
    <div className="rounded-2xl border border-slate-700 overflow-hidden bg-black max-w-md">
      <div className="relative aspect-[4/3] bg-black flex items-center justify-center">
        {error ? (
          <p className="text-sm text-slate-400 px-4 text-center">{error}</p>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 p-2 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 active:scale-95"
          title="Abbrechen"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center justify-between p-2.5 bg-slate-900">
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
        <button
          type="button"
          onClick={() => {
            setReady(false);
            setError("");
            setFacingMode((m) => (m === "environment" ? "user" : "environment"));
          }}
          disabled={!!error}
          className="w-16 inline-flex items-center justify-center gap-1 text-xs text-slate-400 hover:text-white disabled:opacity-30 py-2"
        >
          <RotateCcw className="h-4 w-4" />
          Drehen
        </button>
      </div>
    </div>
  );
}
