"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Plus,
  Pencil,
  Trash2,
  Clock,
  Sunrise,
  Sunset,
  PowerOff,
  Power,
  Loader2,
  History,
  CheckCircle2,
  XCircle,
  Timer,
  Layers,
  Cpu,
  Activity,
  Lightbulb,
  CalendarDays,
  Cctv,
  ArrowUpFromLine,
  ArrowDownToLine,
  Square,
  Blinds,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isCoverCategory } from "@/lib/cover-constants";
import { GroupDialog } from "./group-dialog";
import { AutomationDialog } from "./automation-dialog";
import type {
  GroupWithMembers,
  AutomationWithGroup,
  AutomationRunRow,
  ShellyDeviceOption,
  AccountInfo,
  CameraOption,
} from "./types";

interface Props {
  initialGroups: GroupWithMembers[];
  initialAutomations: AutomationWithGroup[];
  shellyDevices: ShellyDeviceOption[];
  initialRuns: AutomationRunRow[];
  account: AccountInfo;
  cameras: CameraOption[];
}

export function AutomationClient({
  initialGroups,
  initialAutomations,
  shellyDevices,
  initialRuns,
  account,
  cameras,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [groups] = useState(initialGroups);
  const [automations] = useState(initialAutomations);
  const [runs] = useState(initialRuns);

  const [groupDialog, setGroupDialog] = useState<{ open: boolean; group: GroupWithMembers | null }>({
    open: false,
    group: null,
  });
  const [autoDialog, setAutoDialog] = useState<{ open: boolean; automation: AutomationWithGroup | null }>({
    open: false,
    automation: null,
  });

  const [runningGroup, setRunningGroup] = useState<number | null>(null);
  const [runningAuto, setRunningAuto] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ kind: "group" | "automation"; id: number; name: string } | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function runGroup(id: number) {
    setRunningGroup(id);
    try {
      await fetch(`/api/shelly-groups/${id}/execute`, { method: "POST" });
      refresh();
    } finally {
      setRunningGroup(null);
    }
  }

  async function runAutomation(id: number) {
    setRunningAuto(id);
    try {
      await fetch(`/api/shelly-automations/${id}/run`, { method: "POST" });
      refresh();
    } finally {
      setRunningAuto(null);
    }
  }

  async function toggleAutomation(a: AutomationWithGroup) {
    await fetch(`/api/shelly-automations/${a.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !a.isActive }),
    });
    refresh();
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const url =
      deleteConfirm.kind === "group"
        ? `/api/shelly-groups/${deleteConfirm.id}`
        : `/api/shelly-automations/${deleteConfirm.id}`;
    await fetch(url, { method: "DELETE" });
    setDeleteConfirm(null);
    refresh();
  }

  return (
    <div className="max-w-6xl">
      <Tabs defaultValue="groups">
        <TabsList className="mb-4">
          <TabsTrigger value="groups" className="gap-1.5">
            <Layers className="h-4 w-4" />
            Szenen
            <Badge variant="secondary" className="ml-1.5 text-xs">{groups.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="automations" className="gap-1.5">
            <CalendarDays className="h-4 w-4" />
            Automationen
            <Badge variant="secondary" className="ml-1.5 text-xs">{automations.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" />
            Verlauf
          </TabsTrigger>
        </TabsList>

        {/* ── GROUPS ───────────────────────────────────────────────────────── */}
        <TabsContent value="groups" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Szenen b\u00fcndeln mehrere Shelly-Aktionen zu einem Klick.
            </p>
            <Button size="sm" onClick={() => setGroupDialog({ open: true, group: null })} className="gap-1.5">
              <Plus className="h-4 w-4" /> Neue Szene
            </Button>
          </div>

          {groups.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="Noch keine Szenen"
              text="Lege eine Szene an, um mehrere Shellies gleichzeitig zu schalten."
            />
          ) : (
            <div className="grid gap-3">
              {groups.map((g) => (
                <Card key={g.id} className="border-slate-200 dark:border-slate-800">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{g.name}</h3>
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Cpu className="h-3 w-3" /> {g.members.length}
                          </Badge>
                          {g._count.automations > 0 && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Clock className="h-3 w-3" /> {g._count.automations} Automation
                              {g._count.automations !== 1 ? "en" : ""}
                            </Badge>
                          )}
                        </div>
                        {g.description && (
                          <p className="text-xs text-slate-500 mt-0.5">{g.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {g.members.map((m) => (
                            <MemberChip key={m.id} member={m} />
                          ))}
                          {g.members.length === 0 && (
                            <span className="text-xs text-slate-400 italic">Keine Geräte</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => runGroup(g.id)}
                          disabled={runningGroup === g.id || g.members.length === 0}
                          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          {runningGroup === g.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          Ausführen
                        </Button>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setGroupDialog({ open: true, group: g })}
                            className="h-8 px-2 gap-1"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteConfirm({ kind: "group", id: g.id, name: g.name })}
                            className="h-8 px-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── AUTOMATIONS ──────────────────────────────────────────────────── */}
        <TabsContent value="automations" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Automationen lösen Szenen per Zeitplan, Sonnenstand oder Kamera-Ereignis aus.
            </p>
            <Button
              size="sm"
              onClick={() => setAutoDialog({ open: true, automation: null })}
              className="gap-1.5"
              disabled={groups.length === 0}
            >
              <Plus className="h-4 w-4" /> Neue Automation
            </Button>
          </div>

          {groups.length === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900/40">
              Erstelle zuerst eine Szene (Tab &quot;Szenen&quot;), bevor du Automationen anlegst.
            </p>
          )}

          {automations.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Keine Automationen"
              text="Plane Szenen zeitgesteuert, nach Sonnenstand oder bei Kamera-Erkennung."
            />
          ) : (
            <div className="grid gap-3">
              {automations.map((a) => (
                <Card key={a.id} className={cn(
                  "border-slate-200 dark:border-slate-800 transition-opacity",
                  !a.isActive && "opacity-60"
                )}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{a.name}</h3>
                          <TriggerBadge automation={a} />
                          <Badge variant="outline" className="text-xs">→ {a.group.name}</Badge>
                          {!a.isActive && (
                            <Badge variant="secondary" className="text-xs">Pausiert</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                          <span>{formatDays(a.daysOfWeek)}</span>
                          {a.lastRunAt && (
                            <span className="flex items-center gap-1">
                              · Zuletzt: {new Date(a.lastRunAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => runAutomation(a.id)}
                          disabled={runningAuto === a.id}
                          className="gap-1.5"
                        >
                          {runningAuto === a.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          Testen
                        </Button>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleAutomation(a)}
                            className="h-8 px-2 gap-1"
                            title={a.isActive ? "Pausieren" : "Aktivieren"}
                          >
                            {a.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAutoDialog({ open: true, automation: a })}
                            className="h-8 px-2 gap-1"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteConfirm({ kind: "automation", id: a.id, name: a.name })}
                            className="h-8 px-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── HISTORY ──────────────────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-3">
          <p className="text-sm text-slate-500">Letzte 50 Ausführungen (Cron, Manual, Testläufe).</p>
          {runs.length === 0 ? (
            <EmptyState icon={History} title="Noch keine Ausführungen" text="Sobald eine Szene oder Automation läuft, erscheint sie hier." />
          ) : (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── DIALOGS ──────────────────────────────────────────────────────────── */}
      {groupDialog.open && (
        <GroupDialog
          open={groupDialog.open}
          onClose={() => setGroupDialog({ open: false, group: null })}
          group={groupDialog.group}
          shellyDevices={shellyDevices}
          onSaved={() => {
            setGroupDialog({ open: false, group: null });
            refresh();
          }}
        />
      )}
      {autoDialog.open && (
        <AutomationDialog
          open={autoDialog.open}
          onClose={() => setAutoDialog({ open: false, automation: null })}
          automation={autoDialog.automation}
          groups={groups}
          cameras={cameras}
          account={account}
          onSaved={() => {
            setAutoDialog({ open: false, automation: null });
            refresh();
          }}
        />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          title={deleteConfirm.kind === "group" ? "Szene löschen?" : "Automation löschen?"}
          text={
            deleteConfirm.kind === "group"
              ? `\u201E${deleteConfirm.name}\u201C und alle zugehörigen Automationen werden gelöscht.`
              : `\u201E${deleteConfirm.name}\u201C wird gelöscht.`
          }
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<
  string,
  { label: string; icon: typeof Power; cls: string }
> = {
  ON:     { label: "EIN",   icon: Power,           cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  OFF:    { label: "AUS",   icon: PowerOff,        cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  TOGGLE: { label: "TOGGLE",icon: Activity,        cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  OPEN:   { label: "AUF",   icon: ArrowUpFromLine, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  CLOSE:  { label: "ZU",    icon: ArrowDownToLine, cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
  STOP:   { label: "STOPP", icon: Square,          cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

function MemberChip({ member }: { member: GroupWithMembers["members"][number] }) {
  const style = ACTION_STYLES[member.action] ?? ACTION_STYLES.TOGGLE;
  const ActionIcon = style.icon;
  const DeviceIcon = isCoverCategory(member.device.category) ? Blinds : Lightbulb;

  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium", style.cls)}>
      <DeviceIcon className="h-3 w-3 opacity-60" />
      {member.device.name}
      <span className="opacity-50">·</span>
      <ActionIcon className="h-3 w-3" />
      {style.label}
      {member.timerSeconds ? (
        <span className="flex items-center gap-0.5 opacity-60">
          <Timer className="h-2.5 w-2.5" />
          {member.timerSeconds}s
        </span>
      ) : null}
    </span>
  );
}

const EVENT_LABELS: Record<string, string> = {
  PERSON: "Person",
  MOTION: "Bewegung",
  VEHICLE: "Fahrzeug",
  ANIMAL: "Tier",
  OTHER: "Sonstiges",
};

function TriggerBadge({ automation }: { automation: AutomationWithGroup }) {
  if (automation.trigger === "SCHEDULE") {
    return (
      <Badge className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 text-xs gap-1">
        <Clock className="h-3 w-3" /> {automation.timeOfDay ?? "?"}
      </Badge>
    );
  }
  if (automation.trigger === "CAMERA_EVENT") {
    return (
      <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 text-xs gap-1">
        <Cctv className="h-3 w-3" />
        {automation.camera?.name ?? "Kamera"}
        {automation.eventType ? ` · ${EVENT_LABELS[automation.eventType] ?? automation.eventType}` : ""}
        {automation.windowStart && automation.windowEnd
          ? ` · ${automation.windowStart}–${automation.windowEnd}`
          : ""}
      </Badge>
    );
  }
  if (automation.trigger === "SUNRISE") {
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs gap-1">
        <Sunrise className="h-3 w-3" /> Sonnenaufgang
        {automation.offsetMinutes !== 0 && ` ${automation.offsetMinutes > 0 ? "+" : ""}${automation.offsetMinutes}m`}
      </Badge>
    );
  }
  return (
    <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs gap-1">
      <Sunset className="h-3 w-3" /> Sonnenuntergang
      {automation.offsetMinutes !== 0 && ` ${automation.offsetMinutes > 0 ? "+" : ""}${automation.offsetMinutes}m`}
    </Badge>
  );
}

function formatDays(bitmask: number): string {
  if (bitmask === 127) return "Jeden Tag";
  if (bitmask === 31) return "Werktags (Mo–Fr)";
  if (bitmask === 96) return "Wochenende (Sa–So)";
  const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const sel = names.filter((_, i) => ((bitmask >> i) & 1) === 1);
  return sel.length === 0 ? "Nie" : sel.join(", ");
}

function RunRow({ run }: { run: AutomationRunRow }) {
  const ts = new Date(run.triggeredAt);
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="shrink-0">
        {run.success ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {run.automation?.name ?? "Manuell"}
          </span>
          <Badge variant="outline" className="text-[10px] uppercase">
            {run.triggerKind}
          </Badge>
          {run.errorMessage && (
            <span className="text-xs text-red-600 truncate">{run.errorMessage}</span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {ts.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" })}
          {typeof run.durationMs === "number" && ` · ${run.durationMs} ms`}
        </p>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <Card className="border-dashed border-slate-300 dark:border-slate-700">
      <CardContent className="py-10 text-center">
        <Icon className="h-10 w-10 mx-auto text-slate-400 mb-3" />
        <h3 className="font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
        <p className="text-sm text-slate-500 mt-1">{text}</p>
      </CardContent>
    </Card>
  );
}

function ConfirmDialog({ title, text, onCancel, onConfirm }: { title: string; text: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-sm border-slate-200 dark:border-slate-800">
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="text-sm text-slate-500 mt-1">{text}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>Abbrechen</Button>
            <Button size="sm" onClick={onConfirm} className="bg-red-600 hover:bg-red-700 text-white">
              Löschen
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
