"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Pencil, Trash2, Loader2, UserRound, History, ShieldAlert, ShieldCheck,
  Cctv, Play, CheckCircle2, XCircle, Link2, UserPlus, ScanFace, ScanSearch, Wand2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UnknownPersonsPanel } from "./unknown-persons-panel";
import { PersonSearchDialog } from "./person-search-dialog";

export interface PersonRow {
  id: number;
  name: string;
  listType: "WHITELIST" | "BLACKLIST";
  isActive: boolean;
  notes: string | null;
  cameraId: number | null;
  trackHistory: boolean;
  triggerOnDetection: boolean;
  notifyOnDetection: boolean;
  shellyDeviceId: number | null;
  shellyAction: string;
  timerSeconds: number | null;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  camera: { id: number; name: string } | null;
  shellyDevice: { id: number; name: string } | null;
  _count: { sightings: number; faceEmbeddings: number };
  recentSightings: PersonSightingRow[];
}

export interface PersonSightingRow {
  id: number;
  source: string;
  listType: string | null;
  matched: boolean;
  matchScore: number | null;
  matchMethod: string | null;
  shellyTriggered: boolean;
  shellyOk: boolean | null;
  notes: string | null;
  seenAt: string;
  hasSnapshot: boolean;
  camera: { id: number; name: string } | null;
  listedPerson: { id: number; name: string; listType: string } | null;
}

interface Option { id: number; name: string }

interface Props {
  people: PersonRow[];
  sightings: PersonSightingRow[];
  cameras: Option[];
  shellyDevices: Option[];
  /** Unzugeordnete Sichtungen (Badge am Tab „Unbekannt“). */
  unknownCount: number;
}

type ListFilter = "WHITELIST" | "BLACKLIST";

/** Liste einer Sichtung als Pille (Spalte „Liste“, auf dem Handy in der Nebenzeile der Person). */
function SightingListBadge({ listType }: { listType: string | null }) {
  return listType === "BLACKLIST" ? (
    <Badge variant="danger" className="text-xs">Black</Badge>
  ) : listType === "WHITELIST" ? (
    <Badge variant="success" className="text-xs">White</Badge>
  ) : (
    <span className="text-muted-foreground text-xs">–</span>
  );
}

const EMPTY = {
  name: "",
  listType: "WHITELIST" as ListFilter,
  isActive: true,
  notes: "",
  cameraId: "",
  trackHistory: true,
  triggerOnDetection: false,
  notifyOnDetection: false,
  shellyDeviceId: "",
  shellyAction: "ON",
  timerSeconds: "",
  cooldownMinutes: "5",
};

export function PersonsClient({ people, sightings, cameras, shellyDevices, unknownCount }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"unknown" | "whitelist" | "blacklist" | "history">(
    unknownCount > 0 ? "unknown" : "whitelist"
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sightOpen, setSightOpen] = useState(false);
  const [sightPersonId, setSightPersonId] = useState("");
  const [sightNotes, setSightNotes] = useState("");
  const [sightBusy, setSightBusy] = useState(false);
  // Fehler im Dialog „Person melden“ und beim Löschen einer Sichtung als Notice statt Browser-Alert (docs/design-regeln.md, Abschnitt 16).
  const [sightError, setSightError] = useState("");
  const [sightingError, setSightingError] = useState("");
  // Rückfrage vor dem Löschen (Abschnitt 18); der Inhalt bleibt stehen, solange der Dialog ausblendet.
  const [pendingDelete, setPendingDelete] = useState<{ title: string; run: () => Promise<void> } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [triggeringId, setTriggeringId] = useState<number | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSighting, setAssignSighting] = useState<PersonSightingRow | null>(null);
  const [assignMode, setAssignMode] = useState<"existing" | "new">("existing");
  const [assignPersonId, setAssignPersonId] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignListType, setAssignListType] = useState<ListFilter>("WHITELIST");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [searchPerson, setSearchPerson] = useState<{ id: number; name: string } | null>(null);
  const [optimizingId, setOptimizingId] = useState<number | null>(null);
  const [flash, setFlash] = useState("");

  async function optimizeProfile(p: PersonRow) {
    setOptimizingId(p.id);
    try {
      const res = await fetch(`/api/persons/${p.id}/optimize-profile`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash(typeof body.error === "string" ? body.error : "Optimieren fehlgeschlagen");
        return;
      }
      setFlash(
        body.candidates === 0
          ? `${p.name}: noch keine Gesichter zum Auswerten – erst Sichtungen zuordnen.`
          : `${p.name}: Profil jetzt ${body.after} Samples` +
              (body.added ? `, ${body.added} neu aus Sichtungen` : "") +
              (body.removed ? `, ${body.removed} unpassende/doppelte entfernt` : "") +
              "."
      );
      refresh();
    } finally {
      setOptimizingId(null);
    }
  }

  const whitelist = useMemo(() => people.filter((p) => p.listType === "WHITELIST"), [people]);
  const blacklist = useMemo(() => people.filter((p) => p.listType === "BLACKLIST"), [people]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  function openAdd(listType: ListFilter) {
    setEditing(null);
    setForm({ ...EMPTY, listType });
    setError("");
    setOpen(true);
  }

  function openEdit(p: PersonRow) {
    setEditing(p);
    setForm({
      name: p.name,
      listType: p.listType,
      isActive: p.isActive,
      notes: p.notes ?? "",
      cameraId: p.cameraId ? String(p.cameraId) : "",
      trackHistory: p.trackHistory,
      triggerOnDetection: p.triggerOnDetection,
      notifyOnDetection: p.notifyOnDetection,
      shellyDeviceId: p.shellyDeviceId ? String(p.shellyDeviceId) : "",
      shellyAction: p.shellyAction || "ON",
      timerSeconds: p.timerSeconds != null ? String(p.timerSeconds) : "",
      cooldownMinutes: String(p.cooldownMinutes),
    });
    setError("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        listType: form.listType,
        isActive: form.isActive,
        notes: form.notes.trim() || null,
        cameraId: form.cameraId ? Number(form.cameraId) : null,
        trackHistory: form.trackHistory,
        triggerOnDetection: form.triggerOnDetection,
        notifyOnDetection: form.notifyOnDetection,
        shellyDeviceId: form.shellyDeviceId ? Number(form.shellyDeviceId) : null,
        shellyAction: form.shellyAction,
        timerSeconds: form.timerSeconds ? Number(form.timerSeconds) : null,
        cooldownMinutes: Number(form.cooldownMinutes) || 5,
      };
      const res = await fetch(editing ? `/api/persons/${editing.id}` : "/api/persons", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen");
        return;
      }
      setOpen(false);
      refresh();
    } finally {
      setSaving(false);
    }
  }

  function askDelete(title: string, run: () => Promise<void>) {
    setPendingDelete({ title, run });
    setConfirmOpen(true);
  }

  async function remove(p: PersonRow) {
    await fetch(`/api/persons/${p.id}`, { method: "DELETE" });
    refresh();
  }

  async function logSighting(e: React.FormEvent) {
    e.preventDefault();
    if (!sightPersonId) return;
    setSightBusy(true);
    setSightError("");
    try {
      const res = await fetch("/api/person-sightings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listedPersonId: Number(sightPersonId),
          notes: sightNotes.trim() || null,
          triggerShelly: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSightError(typeof data.error === "string" ? data.error : "Fehler");
        return;
      }
      setSightOpen(false);
      setSightNotes("");
      refresh();
    } finally {
      setSightBusy(false);
    }
  }

  async function quickTrigger(p: PersonRow) {
    setTriggeringId(p.id);
    try {
      await fetch("/api/person-sightings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listedPersonId: p.id, triggerShelly: true }),
      });
      refresh();
    } finally {
      setTriggeringId(null);
    }
  }

  function openAssign(s: PersonSightingRow) {
    setAssignSighting(s);
    setAssignMode(people.length > 0 ? "existing" : "new");
    setAssignPersonId("");
    setAssignName("");
    setAssignListType("WHITELIST");
    setAssignError("");
    setAssignOpen(true);
  }

  async function confirmAssign() {
    if (!assignSighting) return;
    setAssignBusy(true);
    setAssignError("");
    try {
      let listedPersonId = Number(assignPersonId);

      if (assignMode === "new") {
        const name = assignName.trim();
        if (!name) {
          setAssignError("Name fehlt");
          return;
        }
        const createRes = await fetch("/api/persons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            listType: assignListType,
            cameraId: null,
            trackHistory: true,
            triggerOnDetection: false,
            notifyOnDetection: false,
          }),
        });
        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}));
          setAssignError(typeof data.error === "string" ? data.error : "Anlegen fehlgeschlagen");
          return;
        }
        const created = await createRes.json();
        listedPersonId = created.id;
      } else if (!listedPersonId) {
        setAssignError("Person wählen");
        return;
      }

      const res = await fetch(`/api/person-sightings/${assignSighting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listedPersonId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAssignError(typeof data.error === "string" ? data.error : "Zuordnen fehlgeschlagen");
        return;
      }
      setAssignOpen(false);
      setAssignSighting(null);
      refresh();
    } finally {
      setAssignBusy(false);
    }
  }

  async function deleteSighting(s: PersonSightingRow) {
    setDeletingId(s.id);
    setSightingError("");
    try {
      const res = await fetch(`/api/person-sightings/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSightingError(typeof data.error === "string" ? data.error : "Löschen fehlgeschlagen");
        return;
      }
      refresh();
    } finally {
      setDeletingId(null);
    }
  }

  function PersonList({ items, kind }: { items: PersonRow[]; kind: ListFilter }) {
    const isBlack = kind === "BLACKLIST";
    return (
      <div className="space-y-4 sm:space-y-5">
        {/* Kopf wie bei Karten: Erklärung links, Primärhandlung oben rechts – auch auf dem Handy,
            dort kürzer (docs/design-regeln.md, Abschnitt 13). */}
        <div className="flex items-start sm:items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-muted-foreground">
            {isBlack
              ? "Blacklist z. B. für Hausverbot. Mit Kamera + „Bei Erkennung schalten“ kann ein Alarm-Shelly ausgelöst werden."
              : "Whitelist für Personen, deren Erscheinungen protokolliert und/oder mit Automation verknüpft werden sollen."}
          </p>
          <Button
            onClick={() => openAdd(kind)}
            variant={isBlack ? "destructive" : "default"}
            className="gap-1.5 shrink-0 max-sm:h-11"
            aria-label="Person hinzufügen"
          >
            <Plus className="h-4 w-4" /> <span>Person<span className="max-sm:hidden"> hinzufügen</span></span>
          </Button>
        </div>

        {items.length === 0 ? (
          <Card className="py-0 sm:py-0">
            <EmptyState icon={isBlack ? ShieldAlert : ShieldCheck} title="Noch keine Einträge" />
          </Card>
        ) : (
          // Eine Spalte mit fester Breite (minmax 0): sonst wächst die Spalte auf die Breite der
          // Sichtungsleiste und schiebt alle Karten auf dem Handy über den Rand.
          <div className="grid grid-cols-1 gap-4 sm:gap-5">
            {items.map((p) => {
              const personSightings = p.recentSightings ?? [];
              return (
                // Pausiert: Text bleibt lesbar (das Badge „Pausiert“ sagt den Zustand), gedimmt werden nur die Bilder.
                <Card key={p.id}>
                  <CardContent className="space-y-3">
                    {/* Kopf: Name und Merkmale links, Handlungen rechts (auf dem Handy darunter). */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 basis-64">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[15px] font-semibold tracking-tight">{p.name}</h3>
                          <Badge variant={isBlack ? "danger" : "success"}>
                            {isBlack ? "Blacklist" : "Whitelist"}
                          </Badge>
                          {!p.isActive && <Badge variant="neutral">Pausiert</Badge>}
                          <Badge variant="outline" className="text-xs gap-1">
                            <Cctv className="h-3 w-3" />
                            {p.camera ? p.camera.name : "Alle Kameras"}
                          </Badge>
                          {p.trackHistory && <Badge variant="outline" className="text-xs">Historie</Badge>}
                          {p.notifyOnDetection && (
                            <Badge variant="outline" className="text-xs">Push</Badge>
                          )}
                          {p.triggerOnDetection && (
                            <Badge variant="outline" className="text-xs">
                              Auto → {p.shellyDevice?.name ?? "Shelly"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {p._count.sightings} Sichtung{p._count.sightings !== 1 ? "en" : ""}
                          {" · "}
                          {p._count.faceEmbeddings} Face-Sample{p._count.faceEmbeddings !== 1 ? "s" : ""}
                          {p._count.sightings > 0 && (
                            <>
                              {" · "}
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
                                disabled={optimizingId === p.id}
                                onClick={() => optimizeProfile(p)}
                                title="Profil aus allen zugeordneten Sichtungen neu wählen, unpassende Samples entfernen"
                              >
                                {optimizingId === p.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Wand2 className="h-3 w-3" />}
                                Profil optimieren
                              </button>
                            </>
                          )}
                          {p.notes ? <> · {p.notes}</> : null}
                        </p>
                        {p._count.faceEmbeddings === 0 && (
                          <p className="text-xs text-warning mt-1">
                            Noch kein Erkennungsprofil – Sichtung zuordnen erzeugt Samples.
                          </p>
                        )}
                      </div>
                      <div className="ml-auto flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 max-sm:size-11"
                          title="Diese Person in den unbekannten Sichtungen suchen"
                          aria-label="Suchen"
                          disabled={p._count.faceEmbeddings === 0}
                          onClick={() => setSearchPerson({ id: p.id, name: p.name })}
                        >
                          <ScanSearch className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Suchen</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="max-sm:size-11"
                          title="Manuell melden / Shelly testen"
                          aria-label="Manuell melden / Shelly testen"
                          onClick={() => quickTrigger(p)}
                          disabled={triggeringId === p.id}
                        >
                          {triggeringId === p.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="max-sm:size-11"
                          title="Bearbeiten"
                          aria-label="Bearbeiten"
                          onClick={() => openEdit(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="text-destructive max-sm:size-11"
                          title="Löschen"
                          aria-label="Löschen"
                          onClick={() =>
                            askDelete(
                              `„${p.name}“ von der ${p.listType === "BLACKLIST" ? "Blacklist" : "Whitelist"} löschen?`,
                              () => remove(p),
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {personSightings.length > 0 ? (
                      <div className="border-t border-border pt-3">
                        <p className="text-label mb-2 flex items-center gap-1.5">
                          <History className="h-3.5 w-3.5" /> Letzte Sichtungen
                        </p>
                        {/* Handy: Raster mit drei Spalten statt seitlich wischen; ab sm umbrechende Reihe fester Kacheln. */}
                        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                          {personSightings.map((s) => (
                            <div
                              key={s.id}
                              className="glass-tile shrink-0 overflow-hidden sm:w-28"
                            >
                              {s.hasSnapshot ? (
                                <a
                                  href={`/api/person-sightings/${s.id}/snapshot`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block aspect-square bg-muted"
                                >
                                  <img
                                    src={`/api/person-sightings/${s.id}/snapshot`}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    className={cn("h-full w-full object-cover", !p.isActive && "opacity-60")}
                                  />
                                </a>
                              ) : (
                                <div className="aspect-square flex items-center justify-center text-muted-foreground/50">
                                  <UserRound className="h-5 w-5" />
                                </div>
                              )}
                              <div className="px-2 py-1.5 space-y-0.5">
                                <p className="text-[11px] font-mono text-muted-foreground leading-tight">
                                  {new Date(s.seenAt).toLocaleString("de-DE", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {s.camera?.name ?? (s.source === "MANUAL" ? "Manuell" : "–")}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {p._count.sightings > personSightings.length && (
                          <button
                            type="button"
                            className="mt-2 text-xs text-primary hover:underline"
                            onClick={() => setTab("history")}
                          >
                            Alle {p._count.sightings} in Historie anzeigen
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="border-t border-border pt-3">
                        <p className="text-xs text-muted-foreground">Noch keine zugeordneten Sichtungen.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5 max-w-6xl">
      {flash && (
        <Notice
          tone="success"
          compact
          title={flash}
          action={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setFlash("")}
              className="text-muted-foreground max-sm:size-11"
              aria-label="Schließen"
            >
              <X className="h-4 w-4" />
            </Button>
          }
        />
      )}
      <PersonSearchDialog
        person={searchPerson}
        onClose={() => setSearchPerson(null)}
        onAssigned={(msg) => {
          setSearchPerson(null);
          setFlash(msg);
          refresh();
        }}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-4 sm:gap-5">
        {/* Handy: volle Breite, damit die umbrochenen Zeilen gleich breit sind (docs/design-regeln.md, Abschnitt 6). */}
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="whitelist" className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> Whitelist
            <Badge variant="secondary" className="ml-1 text-xs">{whitelist.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="blacklist" className="gap-1.5">
            <ShieldAlert className="h-4 w-4" /> Blacklist
            <Badge variant="secondary" className="ml-1 text-xs">{blacklist.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="unknown" className="gap-1.5">
            <ScanFace className="h-4 w-4" /> Unbekannt
            {unknownCount > 0 && (
              <Badge variant="warning" className="ml-1 text-xs">{unknownCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> Historie
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whitelist">
          <PersonList items={whitelist} kind="WHITELIST" />
        </TabsContent>
        <TabsContent value="blacklist">
          <PersonList items={blacklist} kind="BLACKLIST" />
        </TabsContent>
        <TabsContent value="unknown">
          <UnknownPersonsPanel
            people={people.map((p) => ({ id: p.id, name: p.name, listType: p.listType }))}
            onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="history" className="space-y-4 sm:space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Sichtung manuell erfassen</CardTitle>
              <CardAction>
                <Button size="sm" variant="outline" className="max-sm:h-11" onClick={() => { setSightPersonId(""); setSightNotes(""); setSightError(""); setSightOpen(true); }}>
                  <UserRound className="h-4 w-4 mr-1.5" /> Person melden
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="text-[13px] text-muted-foreground">
              Der Hub erkennt Gesichter lokal und matcht gegen die Gallery.
              Unbekannte Sichtungen zuordnen → Face-Sample fürs Wiedererkennen.
            </CardContent>
          </Card>

          {sightingError && <Notice tone="danger" compact title={sightingError} />}

          {/* Tabelle bis an den Kartenrand; erste und letzte Spalte rücken auf den Innenabstand ein.
              Handy (326 px): Bild, Person und Aktion; Zeit und Liste stehen als Nebenzeile unter der
              Person, Quelle erst ab sm (docs/design-regeln.md, Abschnitt 17). */}
          <Card flush="y">
                <Table edge>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Bild</TableHead>
                      <TableHead className="max-sm:hidden">Zeit</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead className="max-sm:hidden">Liste</TableHead>
                      <TableHead className="hidden sm:table-cell">Kamera</TableHead>
                      <TableHead className="max-sm:hidden">Quelle</TableHead>
                      <TableHead className="hidden md:table-cell">Shelly</TableHead>
                      <TableHead className="w-[1%] text-right">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sightings.length === 0 && (
                      <TableEmpty colSpan={8} icon={History} title="Noch keine Sichtungen." />
                    )}
                    {sightings.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          {s.hasSnapshot ? (
                            <button
                              type="button"
                              onClick={() => openAssign(s)}
                              aria-label="Person zuordnen"
                              className="block h-12 w-12 overflow-hidden rounded-[10px] border border-glass-border bg-muted"
                            >
                              <img
                                src={`/api/person-sightings/${s.id}/snapshot`}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-dashed border-border text-muted-foreground/50">
                              <UserRound className="h-4 w-4" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap max-sm:hidden">
                          {new Date(s.seenAt).toLocaleString("de-DE")}
                        </TableCell>
                        <TableCell className="text-sm max-sm:whitespace-normal">
                          {s.listedPerson?.name ?? <span className="text-muted-foreground">unbekannt</span>}
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground sm:hidden">
                            <span>{new Date(s.seenAt).toLocaleString("de-DE")}</span>
                            {s.listType && <SightingListBadge listType={s.listType} />}
                          </div>
                        </TableCell>
                        <TableCell className="max-sm:hidden">
                          <SightingListBadge listType={s.listType} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {s.camera?.name ?? "–"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-sm:hidden">
                          {s.matchMethod === "FACE_EMBEDDING" ? (
                            <span className="inline-flex items-center gap-1">
                              <Badge variant="outline" className="text-[11px] px-1.5 py-0">Auto</Badge>
                              {s.matchScore != null ? `${Math.round(s.matchScore * 100)}%` : ""}
                            </span>
                          ) : s.matchMethod === "MANUAL" || s.source === "MANUAL" ? (
                            <Badge variant="secondary" className="text-[11px] px-1.5 py-0">Manuell</Badge>
                          ) : (
                            "Kamera"
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs">
                          {!s.shellyTriggered ? "–" : s.shellyOk ? (
                            <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" /> OK</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="h-3 w-3" /> Fehler</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            {!s.listedPerson && (
                              // Handy: nur Symbol (wie „Suchen“ in den Personenkarten), damit die Zeile in 326 px passt.
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 max-sm:size-11"
                                onClick={() => openAssign(s)}
                                aria-label="Zuordnen"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Zuordnen</span>
                              </Button>
                            )}
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive max-sm:size-11"
                              disabled={deletingId === s.id}
                              onClick={() => askDelete("Diese Sichtung wirklich löschen?", () => deleteSighting(s))}
                              title="Löschen"
                              aria-label="Löschen"
                            >
                              {deletingId === s.id
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Person bearbeiten" : "Person hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="z.B. Max Mustermann" className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Liste</Label>
              <Select value={form.listType} onValueChange={(v) => setForm((f) => ({ ...f, listType: v as ListFilter }))}>
                <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WHITELIST">Whitelist</SelectItem>
                  <SelectItem value="BLACKLIST">Blacklist (z. B. Hausverbot)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Bevorzugte Kamera</Label>
              <Select value={form.cameraId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, cameraId: v === "none" ? "" : v }))}>
                <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue placeholder="Alle Kameras" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Alle Kameras</SelectItem>
                  {cameras.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Face-Wiedererkennen läuft immer auf allen Kameras. Optional eine Heim-/Referenzkamera markieren.
              </p>
            </div>
            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">Historie führen</p>
                <p className="text-xs text-muted-foreground">Sichtungen dieser Person protokollieren</p>
              </div>
              <Switch checked={form.trackHistory} onCheckedChange={(v) => setForm((f) => ({ ...f, trackHistory: v }))} />
            </div>
            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">Push bei Erkennung</p>
                <p className="text-xs text-muted-foreground">Web-Push an registrierte Geräte bei Face-Match</p>
              </div>
              <Switch checked={form.notifyOnDetection} onCheckedChange={(v) => setForm((f) => ({ ...f, notifyOnDetection: v }))} />
            </div>
            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">Bei Face-Match Shelly schalten</p>
                <p className="text-xs text-muted-foreground">Nur wenn diese Person lokal wiedererkannt wird</p>
              </div>
              <Switch checked={form.triggerOnDetection} onCheckedChange={(v) => setForm((f) => ({ ...f, triggerOnDetection: v }))} />
            </div>
            {form.triggerOnDetection && (
              <>
                <div className="space-y-1.5">
                  <Label>Shelly</Label>
                  <Select value={form.shellyDeviceId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, shellyDeviceId: v === "none" ? "" : v }))}>
                    <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Shelly</SelectItem>
                      {shellyDevices.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Aktion</Label>
                    <Select value={form.shellyAction} onValueChange={(v) => setForm((f) => ({ ...f, shellyAction: v }))}>
                      <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ON">EIN</SelectItem>
                        <SelectItem value="OFF">AUS</SelectItem>
                        <SelectItem value="TOGGLE">TOGGLE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Timer (Sek.)</Label>
                    <Input type="number" min={1} value={form.timerSeconds} onChange={(e) => setForm((f) => ({ ...f, timerSeconds: e.target.value }))} placeholder="optional" className="max-sm:h-11" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Cooldown (Min.)</Label>
                  <Input type="number" min={1} value={form.cooldownMinutes} onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: e.target.value }))} className="max-sm:h-11" />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="z.B. Hausverbot seit 2024" className="max-sm:h-11" />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Label>Aktiv</Label>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>
            {error && <Notice tone="danger" compact title={error} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="max-sm:h-11">Abbrechen</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()} className="gap-1.5 max-sm:h-11">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Speichern" : "Anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sightOpen} onOpenChange={setSightOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Person melden</DialogTitle>
          </DialogHeader>
          <form onSubmit={logSighting} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Person</Label>
              <Select value={sightPersonId} onValueChange={setSightPersonId}>
                <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue placeholder="Person wählen" /></SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} ({p.listType === "BLACKLIST" ? "Black" : "White"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notiz</Label>
              <Input value={sightNotes} onChange={(e) => setSightNotes(e.target.value)} placeholder="optional" className="max-sm:h-11" />
            </div>
            {sightError && <Notice tone="danger" compact title={sightError} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSightOpen(false)} className="max-sm:h-11">Abbrechen</Button>
              <Button type="submit" disabled={sightBusy || !sightPersonId} className="gap-1.5 max-sm:h-11">
                {sightBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Melden
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Person zuordnen</DialogTitle>
          </DialogHeader>
          {assignSighting && (
            <div className="space-y-4">
              {assignSighting.hasSnapshot && (
                // Kamerabild auf schwarzem Grund (Ausnahme laut Farbregeln), auch an den Rändern von object-contain.
                <div className="overflow-hidden rounded-xl border border-border bg-black">
                  <img
                    src={`/api/person-sightings/${assignSighting.id}/snapshot`}
                    alt="Sichtung"
                    decoding="async"
                    className="max-h-64 w-full object-contain"
                  />
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {new Date(assignSighting.seenAt).toLocaleString("de-DE")}
                {assignSighting.camera ? ` · ${assignSighting.camera.name}` : ""}
              </p>

              {/* Bestehende Person oder neu anlegen: Segmentwahl statt zweier Tasten. */}
              <Segmented
                aria-label="Person zuordnen"
                value={assignMode}
                onValueChange={setAssignMode}
                options={[
                  {
                    value: "existing",
                    label: <><Link2 className="h-3.5 w-3.5" /> Bestehende</>,
                    disabled: people.length === 0,
                  },
                  {
                    value: "new",
                    label: <><UserPlus className="h-3.5 w-3.5" /> Neu anlegen</>,
                  },
                ]}
              />

              {assignMode === "existing" ? (
                <div className="space-y-1.5">
                  <Label>Person</Label>
                  <Select value={assignPersonId} onValueChange={setAssignPersonId}>
                    <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue placeholder="Person wählen" /></SelectTrigger>
                    <SelectContent>
                      {people.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} ({p.listType === "BLACKLIST" ? "Black" : "White"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Name <span className="text-destructive">*</span></Label>
                    <Input
                      value={assignName}
                      onChange={(e) => setAssignName(e.target.value)}
                      placeholder="z.B. Max Mustermann"
                      className="max-sm:h-11"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Liste</Label>
                    <Select value={assignListType} onValueChange={(v) => setAssignListType(v as ListFilter)}>
                      <SelectTrigger className="w-full max-sm:data-[size=default]:h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WHITELIST">Whitelist</SelectItem>
                        <SelectItem value="BLACKLIST">Blacklist</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Zuordnen erzeugt ein Face-Sample. Erkennung gilt danach auf allen Kameras.
                  </p>
                </div>
              )}
              {assignMode === "existing" && (
                <p className="text-xs text-muted-foreground">
                  Zuordnen erzeugt ein zusätzliches Face-Sample für diese Person.
                </p>
              )}

              {assignError && (
                <Notice tone="danger" compact title={assignError} />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignBusy} className="max-sm:h-11">
              Abbrechen
            </Button>
            <Button
              onClick={confirmAssign}
              disabled={
                assignBusy ||
                (assignMode === "existing" ? !assignPersonId : !assignName.trim())
              }
              className="gap-1.5 max-sm:h-11"
            >
              {assignBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {assignMode === "new" ? "Anlegen & zuordnen" : "Zuordnen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Löschen immer mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete?.title}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="max-sm:h-11">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="max-sm:h-11"
              onClick={() => {
                if (pendingDelete) void pendingDelete.run();
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
