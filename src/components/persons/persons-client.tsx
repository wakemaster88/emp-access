"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Pencil, Trash2, Loader2, UserRound, History, ShieldAlert, ShieldCheck,
  Cctv, Play, CheckCircle2, XCircle, Link2, UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface PersonRow {
  id: number;
  name: string;
  listType: "WHITELIST" | "BLACKLIST";
  isActive: boolean;
  notes: string | null;
  cameraId: number | null;
  trackHistory: boolean;
  triggerOnDetection: boolean;
  shellyDeviceId: number | null;
  shellyAction: string;
  timerSeconds: number | null;
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  camera: { id: number; name: string } | null;
  shellyDevice: { id: number; name: string } | null;
  _count: { sightings: number };
  recentSightings: PersonSightingRow[];
}

export interface PersonSightingRow {
  id: number;
  source: string;
  listType: string | null;
  matched: boolean;
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
}

type ListFilter = "WHITELIST" | "BLACKLIST";

const EMPTY = {
  name: "",
  listType: "WHITELIST" as ListFilter,
  isActive: true,
  notes: "",
  cameraId: "",
  trackHistory: true,
  triggerOnDetection: false,
  shellyDeviceId: "",
  shellyAction: "ON",
  timerSeconds: "",
  cooldownMinutes: "5",
};

export function PersonsClient({ people, sightings, cameras, shellyDevices }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"whitelist" | "blacklist" | "history">("whitelist");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sightOpen, setSightOpen] = useState(false);
  const [sightPersonId, setSightPersonId] = useState("");
  const [sightNotes, setSightNotes] = useState("");
  const [sightBusy, setSightBusy] = useState(false);
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

  async function remove(p: PersonRow) {
    if (!confirm(`„${p.name}" von der ${p.listType === "BLACKLIST" ? "Blacklist" : "Whitelist"} löschen?`)) return;
    await fetch(`/api/persons/${p.id}`, { method: "DELETE" });
    refresh();
  }

  async function logSighting(e: React.FormEvent) {
    e.preventDefault();
    if (!sightPersonId) return;
    setSightBusy(true);
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
        alert(typeof data.error === "string" ? data.error : "Fehler");
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
            cameraId: assignSighting.camera?.id ?? null,
            trackHistory: true,
            triggerOnDetection: false,
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
    if (!confirm("Diese Sichtung wirklich löschen?")) return;
    setDeletingId(s.id);
    try {
      const res = await fetch(`/api/person-sightings/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(typeof data.error === "string" ? data.error : "Löschen fehlgeschlagen");
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
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {isBlack
              ? "Blacklist z. B. für Hausverbot. Mit Kamera + „Bei Erkennung schalten“ kann ein Alarm-Shelly ausgelöst werden."
              : "Whitelist für Personen, deren Erscheinungen protokolliert und/oder mit Automation verknüpft werden sollen."}
          </p>
          <Button
            onClick={() => openAdd(kind)}
            className={cn("gap-1.5 shrink-0", isBlack ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700")}
          >
            <Plus className="h-4 w-4" /> Person hinzufügen
          </Button>
        </div>

        {items.length === 0 ? (
          <Card className="border-dashed border-slate-300 dark:border-slate-700">
            <CardContent className="py-12 text-center text-slate-500">
              {isBlack ? <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-slate-300" /> : <ShieldCheck className="h-10 w-10 mx-auto mb-3 text-slate-300" />}
              <p className="font-medium">Noch keine Einträge</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {items.map((p) => {
              const personSightings = p.recentSightings ?? [];
              return (
                <Card key={p.id} className={cn("border-slate-200 dark:border-slate-800", !p.isActive && "opacity-60")}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{p.name}</h3>
                          <Badge className={cn(
                            "text-xs",
                            isBlack
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          )}>
                            {isBlack ? "Blacklist" : "Whitelist"}
                          </Badge>
                          {!p.isActive && <Badge variant="secondary">Pausiert</Badge>}
                          {p.camera ? (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Cctv className="h-3 w-3" /> {p.camera.name}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">keine Kamera</Badge>
                          )}
                          {p.trackHistory && <Badge variant="outline" className="text-xs">Historie</Badge>}
                          {p.triggerOnDetection && (
                            <Badge variant="outline" className="text-xs">
                              Auto → {p.shellyDevice?.name ?? "Shelly"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {p._count.sightings} Sichtung{p._count.sightings !== 1 ? "en" : ""}
                          {p.notes ? <> · {p.notes}</> : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          title="Manuell melden / Shelly testen"
                          onClick={() => quickTrigger(p)}
                          disabled={triggeringId === p.id}
                        >
                          {triggeringId === p.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 px-2 text-rose-600" onClick={() => remove(p)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {personSightings.length > 0 ? (
                      <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                        <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5">
                          <History className="h-3.5 w-3.5" /> Letzte Sichtungen
                        </p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {personSightings.map((s) => (
                            <div
                              key={s.id}
                              className="shrink-0 w-28 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-900"
                            >
                              {s.hasSnapshot ? (
                                <a
                                  href={`/api/person-sightings/${s.id}/snapshot`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block aspect-square bg-slate-100 dark:bg-slate-950"
                                >
                                  <img
                                    src={`/api/person-sightings/${s.id}/snapshot`}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </a>
                              ) : (
                                <div className="aspect-square flex items-center justify-center text-slate-300">
                                  <UserRound className="h-5 w-5" />
                                </div>
                              )}
                              <div className="px-1.5 py-1 space-y-0.5">
                                <p className="text-[10px] font-mono text-slate-500 leading-tight">
                                  {new Date(s.seenAt).toLocaleString("de-DE", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </p>
                                <p className="text-[10px] text-slate-400 truncate">
                                  {s.camera?.name ?? (s.source === "MANUAL" ? "Manuell" : "–")}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {p._count.sightings > personSightings.length && (
                          <button
                            type="button"
                            className="mt-2 text-xs text-indigo-600 hover:underline"
                            onClick={() => setTab("history")}
                          >
                            Alle {p._count.sightings} in Historie anzeigen
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                        <p className="text-xs text-slate-400">Noch keine zugeordneten Sichtungen.</p>
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
    <div className="space-y-4 sm:space-y-6 max-w-6xl">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="whitelist" className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> Whitelist
            <Badge variant="secondary" className="ml-1 text-xs">{whitelist.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="blacklist" className="gap-1.5">
            <ShieldAlert className="h-4 w-4" /> Blacklist
            <Badge variant="secondary" className="ml-1 text-xs">{blacklist.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> Historie
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whitelist" className="mt-4">
          <PersonList items={whitelist} kind="WHITELIST" />
        </TabsContent>
        <TabsContent value="blacklist" className="mt-4">
          <PersonList items={blacklist} kind="BLACKLIST" />
        </TabsContent>
        <TabsContent value="history" className="space-y-4 mt-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Sichtung manuell erfassen</CardTitle>
              <Button size="sm" variant="outline" onClick={() => { setSightPersonId(""); setSightNotes(""); setSightOpen(true); }}>
                <UserRound className="h-4 w-4 mr-1.5" /> Person melden
              </Button>
            </CardHeader>
            <CardContent className="text-sm text-slate-500">
              Bei klarer Personen-/Gesichtserkennung speichert der Hub einen Schnappschuss in der Historie.
              Unbekannte Sichtungen kannst du zuordnen oder als Fehltreffer löschen.
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="p-0 sm:p-6">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead className="w-16">Bild</TableHead>
                      <TableHead>Zeit</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead>Liste</TableHead>
                      <TableHead className="hidden sm:table-cell">Kamera</TableHead>
                      <TableHead>Quelle</TableHead>
                      <TableHead className="hidden md:table-cell">Shelly</TableHead>
                      <TableHead className="w-[1%] text-right">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sightings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10 text-sm text-slate-400">
                          Noch keine Sichtungen.
                        </TableCell>
                      </TableRow>
                    )}
                    {sightings.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          {s.hasSnapshot ? (
                            <button
                              type="button"
                              onClick={() => openAssign(s)}
                              className="block h-12 w-12 overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900"
                            >
                              <img
                                src={`/api/person-sightings/${s.id}/snapshot`}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-slate-200 text-slate-300 dark:border-slate-700">
                              <UserRound className="h-4 w-4" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500 whitespace-nowrap">
                          {new Date(s.seenAt).toLocaleString("de-DE")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.listedPerson?.name ?? <span className="text-slate-400">unbekannt</span>}
                        </TableCell>
                        <TableCell>
                          {s.listType === "BLACKLIST" ? (
                            <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 text-xs">Black</Badge>
                          ) : s.listType === "WHITELIST" ? (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">White</Badge>
                          ) : (
                            <span className="text-slate-400 text-xs">–</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-slate-500">
                          {s.camera?.name ?? "–"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {s.source === "MANUAL" ? "Manuell" : "Kamera"}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs">
                          {!s.shellyTriggered ? "–" : s.shellyOk ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> OK</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-600"><XCircle className="h-3 w-3" /> Fehler</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            {!s.listedPerson && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1 text-xs"
                                onClick={() => openAssign(s)}
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                Zuordnen
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-slate-400 hover:text-rose-600"
                              disabled={deletingId === s.id}
                              onClick={() => deleteSighting(s)}
                              title="Löschen"
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
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Person bearbeiten" : "Person hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name <span className="text-rose-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="z.B. Max Mustermann" />
            </div>
            <div className="space-y-1.5">
              <Label>Liste</Label>
              <Select value={form.listType} onValueChange={(v) => setForm((f) => ({ ...f, listType: v as ListFilter }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WHITELIST">Whitelist</SelectItem>
                  <SelectItem value="BLACKLIST">Blacklist (z. B. Hausverbot)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Kamera</Label>
              <Select value={form.cameraId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, cameraId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Kamera wählen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine (nur manuell)</SelectItem>
                  {cameras.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Für automatische Historie/Shelly bei Personenerkennung an dieser Kamera.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Historie führen</p>
                <p className="text-xs text-slate-500">PERSON-Events der Kamera protokollieren</p>
              </div>
              <Switch checked={form.trackHistory} onCheckedChange={(v) => setForm((f) => ({ ...f, trackHistory: v }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Bei Erkennung Shelly schalten</p>
                <p className="text-xs text-slate-500">Ohne Gesichtserkennung: jede Person an der Kamera</p>
              </div>
              <Switch checked={form.triggerOnDetection} onCheckedChange={(v) => setForm((f) => ({ ...f, triggerOnDetection: v }))} />
            </div>
            {form.triggerOnDetection && (
              <>
                <div className="space-y-1.5">
                  <Label>Shelly</Label>
                  <Select value={form.shellyDeviceId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, shellyDeviceId: v === "none" ? "" : v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ON">EIN</SelectItem>
                        <SelectItem value="OFF">AUS</SelectItem>
                        <SelectItem value="TOGGLE">TOGGLE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Timer (Sek.)</Label>
                    <Input type="number" min={1} value={form.timerSeconds} onChange={(e) => setForm((f) => ({ ...f, timerSeconds: e.target.value }))} placeholder="optional" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Cooldown (Min.)</Label>
                  <Input type="number" min={1} value={form.cooldownMinutes} onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: e.target.value }))} />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="z.B. Hausverbot seit 2024" />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Label>Aktiv</Label>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>
            {error && <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Abbrechen</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()} className="gap-1.5">
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
                <SelectTrigger><SelectValue placeholder="Person wählen" /></SelectTrigger>
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
              <Input value={sightNotes} onChange={(e) => setSightNotes(e.target.value)} placeholder="optional" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSightOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={sightBusy || !sightPersonId} className="gap-1.5">
                {sightBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Melden
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Person zuordnen</DialogTitle>
          </DialogHeader>
          {assignSighting && (
            <div className="space-y-4">
              {assignSighting.hasSnapshot && (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
                  <img
                    src={`/api/person-sightings/${assignSighting.id}/snapshot`}
                    alt="Sichtung"
                    className="max-h-64 w-full object-contain bg-black/5"
                  />
                </div>
              )}
              <p className="text-sm text-slate-500">
                {new Date(assignSighting.seenAt).toLocaleString("de-DE")}
                {assignSighting.camera ? ` · ${assignSighting.camera.name}` : ""}
              </p>

              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={assignMode === "existing" ? "default" : "outline"}
                  className="gap-1.5"
                  disabled={people.length === 0}
                  onClick={() => setAssignMode("existing")}
                >
                  <Link2 className="h-3.5 w-3.5" /> Bestehende
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={assignMode === "new" ? "default" : "outline"}
                  className="gap-1.5"
                  onClick={() => setAssignMode("new")}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Neu anlegen
                </Button>
              </div>

              {assignMode === "existing" ? (
                <div className="space-y-1.5">
                  <Label>Person</Label>
                  <Select value={assignPersonId} onValueChange={setAssignPersonId}>
                    <SelectTrigger><SelectValue placeholder="Person wählen" /></SelectTrigger>
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
                    <Label>Name <span className="text-rose-500">*</span></Label>
                    <Input
                      value={assignName}
                      onChange={(e) => setAssignName(e.target.value)}
                      placeholder="z.B. Max Mustermann"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Liste</Label>
                    <Select value={assignListType} onValueChange={(v) => setAssignListType(v as ListFilter)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WHITELIST">Whitelist</SelectItem>
                        <SelectItem value="BLACKLIST">Blacklist</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {assignSighting.camera && (
                    <p className="text-xs text-slate-500">
                      Kamera „{assignSighting.camera.name}“ wird der Person zugeordnet.
                    </p>
                  )}
                </div>
              )}

              {assignError && (
                <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                  {assignError}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignBusy}>
              Abbrechen
            </Button>
            <Button
              onClick={confirmAssign}
              disabled={
                assignBusy ||
                (assignMode === "existing" ? !assignPersonId : !assignName.trim())
              }
              className="gap-1.5"
            >
              {assignBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {assignMode === "new" ? "Anlegen & zuordnen" : "Zuordnen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
