"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import { Camera, Loader2, Trash2, Save, Settings2, Link2, MapPin, ScanLine } from "lucide-react";

function toDateInput(val: string | Date | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

export interface SubscriptionData {
  id: number;
  name: string;
  annyNames: string | null;
  defaultValidityType?: string | null;
  defaultStartDate?: string | Date | null;
  defaultEndDate?: string | Date | null;
  defaultSlotStart?: string | null;
  defaultSlotEnd?: string | null;
  defaultValidityDurationMinutes?: number | null;
  requiresPhoto?: boolean;
  requiresRfid?: boolean;
}

interface AreaRef {
  id: number;
  name: string;
}

interface SubscriptionDialogProps {
  subscription: SubscriptionData | null;
  initialAreaIds: number[];
  areas: AreaRef[];
  annyServices: string[];
  annyResources: string[];
  annySubscriptions?: string[];
  open: boolean;
  onClose: () => void;
}

type TabId = "settings" | "anny" | "areas";

function SelectionList({
  label,
  items,
  selected,
  onToggle,
  emptyText,
}: {
  /** Name der Liste für Screenreader. */
  label: string;
  items: { key: string; label: string }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <EmptyState compact title={emptyText} />;
  }

  // Auswahlliste aus dem Baustein (docs/design-regeln.md, Abschnitt 16): die ganze Zeile schaltet das Kästchen.
  return (
    <Checklist aria-label={label} maxHeight={320}>
      {items.map(({ key, label: itemLabel }) => (
        <ChecklistItem
          key={key}
          checked={selected.has(key)}
          onCheckedChange={() => onToggle(key)}
          title={itemLabel}
        />
      ))}
    </Checklist>
  );
}

export function SubscriptionDialog({
  subscription, initialAreaIds,
  areas, annyServices, annyResources, annySubscriptions = [],
  open, onClose,
}: SubscriptionDialogProps) {
  const router = useRouter();
  const isNew = !subscription;
  const [tab, setTab] = useState<TabId>("settings");
  const [name, setName] = useState("");
  const [selectedAnny, setSelectedAnny] = useState<Set<string>>(new Set());
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set());
  const [defaultValidityType, setDefaultValidityType] = useState<string>("none");
  const [defaultStartDate, setDefaultStartDate] = useState("");
  const [defaultEndDate, setDefaultEndDate] = useState("");
  const [defaultSlotStart, setDefaultSlotStart] = useState("");
  const [defaultSlotEnd, setDefaultSlotEnd] = useState("");
  const [defaultValidityDurationMinutes, setDefaultValidityDurationMinutes] = useState("");
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [requiresRfid, setRequiresRfid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Rückfrage zum Löschen als Schritt im selben Dialog (Abschnitt 18), kein Browser-Dialog.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const hasAnny = annyServices.length > 0 || annyResources.length > 0 || annySubscriptions.length > 0;

  useEffect(() => {
    if (open) {
      setError("");
      setConfirmDelete(false);
      setTab("settings");
      if (subscription) {
        setName(subscription.name);
        const parsed: string[] = subscription.annyNames
          ? (() => { try { return JSON.parse(subscription.annyNames); } catch { return []; } })()
          : [];
        setSelectedAnny(new Set(parsed));
        setSelectedAreas(new Set(initialAreaIds.map(String)));
        setDefaultValidityType(subscription.defaultValidityType ?? "none");
        setDefaultStartDate(toDateInput(subscription.defaultStartDate));
        setDefaultEndDate(toDateInput(subscription.defaultEndDate));
        setDefaultSlotStart(subscription.defaultSlotStart ?? "");
        setDefaultSlotEnd(subscription.defaultSlotEnd ?? "");
        setDefaultValidityDurationMinutes(subscription.defaultValidityDurationMinutes != null ? String(subscription.defaultValidityDurationMinutes) : "");
        setRequiresPhoto(subscription.requiresPhoto ?? false);
        setRequiresRfid(subscription.requiresRfid ?? false);
      } else {
        setName("");
        setSelectedAnny(new Set());
        setSelectedAreas(new Set());
        setDefaultValidityType("none");
        setDefaultStartDate("");
        setDefaultEndDate("");
        setDefaultSlotStart("");
        setDefaultSlotEnd("");
        setDefaultValidityDurationMinutes("");
        setRequiresPhoto(false);
        setRequiresRfid(false);
      }
    }
  }, [open, subscription, initialAreaIds]);

  function toggleAnny(key: string) {
    setSelectedAnny((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleArea(key: string) {
    setSelectedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        annyNames: [...selectedAnny],
        areaIds: [...selectedAreas].map(Number),
        requiresPhoto,
        requiresRfid,
      };
      if (defaultValidityType && defaultValidityType !== "none") {
        payload.defaultValidityType = defaultValidityType;
        if (defaultValidityType === "DATE_RANGE") {
          if (defaultStartDate) payload.defaultStartDate = new Date(defaultStartDate).toISOString();
          if (defaultEndDate) payload.defaultEndDate = new Date(defaultEndDate).toISOString();
        } else if (defaultValidityType === "TIME_SLOT") {
          payload.defaultSlotStart = defaultSlotStart || null;
          payload.defaultSlotEnd = defaultSlotEnd || null;
        } else if (defaultValidityType === "DURATION" && defaultValidityDurationMinutes) {
          payload.defaultValidityDurationMinutes = Number(defaultValidityDurationMinutes);
        }
      } else {
        payload.defaultValidityType = null;
        payload.defaultStartDate = null;
        payload.defaultEndDate = null;
        payload.defaultSlotStart = null;
        payload.defaultSlotEnd = null;
        payload.defaultValidityDurationMinutes = null;
      }
      const url = isNew ? "/api/subscriptions" : `/api/subscriptions/${subscription!.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Server-Fehler (${res.status})`);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!subscription) return;
    setDeleting(true);
    try {
      await fetch(`/api/subscriptions/${subscription.id}`, { method: "DELETE" });
      onClose();
      router.refresh();
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  const annyItems = [
    ...annySubscriptions.map((n) => ({ key: n, label: `${n} (Abo)` })),
    ...annyResources.map((n) => ({ key: n, label: `${n} (Resource)` })),
    ...annyServices.map((n) => ({ key: n, label: `${n} (Service)` })),
  ];
  const areaItems = areas.map((a) => ({ key: String(a.id), label: a.name }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Neues Abo anlegen" : "Abo bearbeiten"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-4">
          {/* Kapsel ohne eigene Klassen, in der Ebene getönt (Abschnitt 18). Symbole erst ab sm, damit alles in eine Zeile passt. */}
          <TabsList className="w-full">
            <TabsTrigger value="settings" className="px-2.5 sm:px-3.5">
              <Settings2 className="hidden size-3.5 sm:block" />
              Einstellungen
            </TabsTrigger>
            {hasAnny && (
              <TabsTrigger value="anny" className="px-2.5 sm:px-3.5">
                <Link2 className="hidden size-3.5 sm:block" />
                anny{selectedAnny.size > 0 && ` (${selectedAnny.size})`}
              </TabsTrigger>
            )}
            <TabsTrigger value="areas" className="px-2.5 sm:px-3.5">
              <MapPin className="hidden size-3.5 sm:block" />
              Resourcen{selectedAreas.size > 0 && ` (${selectedAreas.size})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-name" className="text-[13px]">Name <span className="text-destructive">*</span></Label>
              <Input
                id="s-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Ride Abo, Stundenkarte, Mitarbeiter"
                required
                autoFocus
                className="h-11 sm:h-9"
              />
            </div>

            {/* Gruppen im Dialog als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (Abschnitt 18). */}
            <div className="glass-tile p-3 space-y-3">
              <p className="text-label">Standard-Gültigkeit für neue Tickets</p>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Gültigkeitstyp</Label>
                <Select value={defaultValidityType} onValueChange={setDefaultValidityType}>
                  <SelectTrigger className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9"><SelectValue placeholder="Kein Standard" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Standard</SelectItem>
                    <SelectItem value="DATE_RANGE">Zeitraum (Tage)</SelectItem>
                    <SelectItem value="TIME_SLOT">Zeitslot (Uhrzeit)</SelectItem>
                    <SelectItem value="DURATION">Dauer ab 1. Scan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {defaultValidityType === "DATE_RANGE" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Gültig ab</Label>
                    <Input type="date" className="h-11 sm:h-9" value={defaultStartDate} onChange={(e) => setDefaultStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Gültig bis</Label>
                    <Input type="date" className="h-11 sm:h-9" value={defaultEndDate} onChange={(e) => setDefaultEndDate(e.target.value)} />
                  </div>
                </div>
              )}
              {defaultValidityType === "TIME_SLOT" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Slot von</Label>
                    <Input type="time" className="h-11 sm:h-9" value={defaultSlotStart} onChange={(e) => setDefaultSlotStart(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">Slot bis</Label>
                    <Input type="time" className="h-11 sm:h-9" value={defaultSlotEnd} onChange={(e) => setDefaultSlotEnd(e.target.value)} />
                  </div>
                </div>
              )}
              {defaultValidityType === "DURATION" && (
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Dauer (Minuten)</Label>
                  <div className="flex gap-2 items-center">
                    <Input type="number" min={1} className="h-11 sm:h-9 flex-1" placeholder="z.B. 120" value={defaultValidityDurationMinutes} onChange={(e) => setDefaultValidityDurationMinutes(e.target.value)} />
                    <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9 shrink-0" onClick={() => setDefaultValidityDurationMinutes("1440")}>
                      1 Tag
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">1 Tag = 1440 Minuten</p>
                </div>
              )}
            </div>

            <div className="glass-tile divide-y divide-border">
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                    <Camera className="h-3.5 w-3.5 text-muted-foreground" /> Foto erforderlich
                  </p>
                  <p className="text-xs text-muted-foreground">Kamera öffnet automatisch wenn kein Bild vorhanden</p>
                </div>
                <Switch checked={requiresPhoto} onCheckedChange={setRequiresPhoto} />
              </div>
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                    <ScanLine className="h-3.5 w-3.5 text-muted-foreground" /> RFID erforderlich
                  </p>
                  <p className="text-xs text-muted-foreground">Warnung im Dashboard wenn kein RFID-Band verknüpft</p>
                </div>
                <Switch checked={requiresRfid} onCheckedChange={setRequiresRfid} />
              </div>
            </div>

            {subscription && (
              <div className="glass-tile p-3 space-y-2">
                <p className="text-label">Zusammenfassung</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedAnny.size > 0 && (
                    <Badge variant="secondary">
                      {selectedAnny.size} anny {selectedAnny.size === 1 ? "Verknüpfung" : "Verknüpfungen"}
                    </Badge>
                  )}
                  {selectedAreas.size > 0 && (
                    <Badge variant="outline">
                      {selectedAreas.size} {selectedAreas.size === 1 ? "Resource" : "Resourcen"}
                    </Badge>
                  )}
                  {selectedAnny.size === 0 && selectedAreas.size === 0 && (
                    <span className="text-xs text-muted-foreground">Keine Verknüpfungen</span>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="anny" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Wähle anny Abos, Services und Ressourcen, die diesem Abo zugeordnet werden. Tickets mit diesen Namen werden beim Sync automatisch verknüpft.
            </p>
            <SelectionList
              label="anny Verknüpfungen"
              items={annyItems}
              selected={selectedAnny}
              onToggle={toggleAnny}
              emptyText="Keine anny Einträge gefunden. Bitte erst synchronisieren."
            />
            {selectedAnny.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="accent" className="tabular-nums">{selectedAnny.size} ausgewählt</Badge>
                <button
                  type="button"
                  onClick={() => setSelectedAnny(new Set())}
                  className="min-h-11 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors sm:min-h-0"
                >
                  Alle abwählen
                </button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="areas" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Wähle die Resourcen, zu denen dieses Abo Zugang gewährt. Abo-Tickets erscheinen im Dashboard in allen ausgewählten Resourcen.
            </p>
            <SelectionList
              label="Resourcen"
              items={areaItems}
              selected={selectedAreas}
              onToggle={toggleArea}
              emptyText="Keine Resourcen vorhanden."
            />
            {selectedAreas.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="accent" className="tabular-nums">{selectedAreas.size} ausgewählt</Badge>
                <button
                  type="button"
                  onClick={() => setSelectedAreas(new Set())}
                  className="min-h-11 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors sm:min-h-0"
                >
                  Alle abwählen
                </button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {error && (
          <Notice tone="danger" compact title={error} />
        )}

        <Separator />

        {confirmDelete && subscription ? (
          // Rückfrage statt Fußzeile: Abbrechen oder endgültig löschen.
          <div className="space-y-3">
            <Notice tone="danger" compact title={`Abo "${subscription.name}" wirklich löschen?`} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                autoFocus
                className="h-11 sm:h-9"
              >
                Abbrechen
              </Button>
              <Button
                type="button" variant="destructive" size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="h-11 sm:h-9"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                Löschen
              </Button>
            </div>
          </div>
        ) : (
          /* Handy: volle Breite, Primärtaste oben, Löschen zuunterst. Ab sm: Löschen links (DialogFooter start), Handlungen rechts. */
          <DialogFooter
            start={!isNew && (
              <Button
                type="button" variant="ghost" size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting || saving}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-11 sm:h-9"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Löschen
              </Button>
            )}
          >
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving || deleting} className="h-11 sm:h-9">
              Abbrechen
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || deleting || !name.trim()}
              className="min-w-24 h-11 sm:h-9"
            >
              {saving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <><Save className="h-3.5 w-3.5 mr-1" />{isNew ? "Erstellen" : "Speichern"}</>}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
