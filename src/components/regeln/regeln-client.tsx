"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Moon,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow,
  XCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, fmtAgo } from "@/components/raeume/shared";
import { useNow } from "@/components/raeume/status";
import { RuleDialog } from "@/components/regeln/rule-dialog";
import {
  OPERATING_LABELS,
  TRIGGER_KIND_LABELS,
  TRIGGER_LABELS,
  cooldownLabel,
  describeAction,
  describeTrigger,
  weekdayLabel,
} from "@/components/regeln/shared";
import type { RegelnData, Rule } from "@/components/regeln/types";

function RuleCard({
  rule,
  nowMs,
  readonly,
  busy,
  onRun,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: Rule;
  nowMs: number;
  readonly: boolean;
  busy: boolean;
  onRun: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={rule.isActive ? undefined : "opacity-60"}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <CardTitle className="min-w-0">
              <h3 className="truncate">{rule.name}</h3>
            </CardTitle>
            <Badge variant="secondary">
              {TRIGGER_LABELS[rule.trigger]}
            </Badge>
            {!rule.isActive && (
              <Badge variant="neutral">
                pausiert
              </Badge>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3 shrink-0" />
            {rule.room?.name ?? "betriebsweit"}
          </p>
          {rule.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{rule.description}</p>
          )}
        </div>

        {!readonly && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-success max-sm:size-11"
              disabled={busy}
              onClick={onRun}
              title="Jetzt ausführen"
              aria-label="Jetzt ausführen"
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-xs text-muted-foreground max-sm:h-11"
              disabled={busy}
              onClick={onToggle}
            >
              {rule.isActive ? "Pause" : "Aktiv"}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground max-sm:size-11"
              onClick={onEdit}
              title="Bearbeiten"
              aria-label="Bearbeiten"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive max-sm:size-11"
              onClick={onDelete}
              title="Löschen"
              aria-label="Löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <dl className="space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Auslöser</dt>
            <dd className="font-medium">{describeTrigger(rule)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Dann</dt>
            <dd>
              {rule.actions.length === 0 ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
                  keine Aktion hinterlegt
                </span>
              ) : (
                <ul className="space-y-0.5">
                  {rule.actions.map((action) => (
                    <li key={action.id}>{describeAction(action)}</li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>

      <CardFooter className="flex-wrap gap-x-1.5 gap-y-1 border-t text-[11px] text-muted-foreground tabular-nums">
        <span>{weekdayLabel(rule.daysOfWeek)}</span>
        {rule.windowStart && rule.windowEnd && (
          <>
            <span>·</span>
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {rule.windowStart}–{rule.windowEnd}
            </span>
          </>
        )}
        {rule.operating !== "ANY" && (
          <>
            <span>·</span>
            <span>{OPERATING_LABELS[rule.operating]}</span>
          </>
        )}
        {rule.onlyWhenDark && (
          <>
            <span>·</span>
            <span className="flex items-center gap-0.5">
              <Moon className="h-3 w-3" />
              nur dunkel
            </span>
          </>
        )}
        <span>·</span>
        <span>{cooldownLabel(rule.cooldownSeconds)}</span>
        <span>·</span>
        <span>zuletzt {fmtAgo(rule.lastRunAt, nowMs)}</span>
      </CardFooter>
    </Card>
  );
}

export function RegelnClient({ data }: { data: RegelnData }) {
  const router = useRouter();
  const nowMs = useNow(new Date(data.renderedAt).getTime());
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Rückfrage vor dem Löschen; die Regel bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<Rule | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const grouped = useMemo(() => {
    const map = new Map<string, Rule[]>();
    for (const rule of data.rules) {
      const key = rule.room?.name ?? "Betriebsweit";
      const list = map.get(key);
      if (list) list.push(rule);
      else map.set(key, [rule]);
    }
    // "Betriebsweit" ans Ende: Raumregeln sind der Regelfall.
    return [...map.entries()].sort(([a], [b]) =>
      a === "Betriebsweit" ? 1 : b === "Betriebsweit" ? -1 : a.localeCompare(b, "de"),
    );
  }, [data.rules]);

  const activeCount = data.rules.filter((r) => r.isActive).length;

  async function run(rule: Rule) {
    setBusyId(rule.id);
    setError("");
    setNotice("");
    const res = await apiRequest<{ success: boolean; actions: Array<{ target: string; ok: boolean; error?: string }> }>(
      `/api/regeln/${rule.id}/run`,
      "POST",
    );
    setBusyId(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    const failed = res.data.actions.filter((a) => !a.ok);
    setNotice(
      failed.length === 0
        ? `„${rule.name}“ ausgeführt.`
        : `„${rule.name}“ teilweise ausgeführt: ${failed.map((a) => `${a.target} (${a.error})`).join(", ")}`,
    );
    router.refresh();
  }

  async function toggle(rule: Rule) {
    setBusyId(rule.id);
    setError("");
    const res = await apiRequest(`/api/regeln/${rule.id}`, "PUT", { isActive: !rule.isActive });
    setBusyId(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  function askRemove(rule: Rule) {
    setToDelete(rule);
    setConfirmOpen(true);
  }

  async function remove(rule: Rule) {
    setError("");
    const res = await apiRequest(`/api/regeln/${rule.id}`, "DELETE");
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="page-content space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {data.rules.length === 0
            ? "Noch keine Regel angelegt."
            : `${activeCount} von ${data.rules.length} ${data.rules.length === 1 ? "Regel" : "Regeln"} aktiv.`}
        </p>
        {!data.readonly && (
          <Button
            size="sm"
            className="h-8 text-xs max-sm:h-11"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Regel
          </Button>
        )}
      </div>

      {error && <Notice tone="danger" compact title={error} />}
      {notice && <Notice tone="success" compact title={notice} />}

      <Tabs defaultValue="rules" className="gap-4">
        <TabsList>
          <TabsTrigger value="rules" className="tabular-nums">
            Regeln ({data.rules.length})
          </TabsTrigger>
          <TabsTrigger value="runs">
            Verlauf
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4 sm:space-y-5">
          {data.rules.length === 0 ? (
            <Card className="py-0 sm:py-0">
              <EmptyState
                icon={Workflow}
                title="Keine Regel hinterlegt"
                description="Eine Regel verbindet einen Auslöser mit Aktionen: „Bei Betriebsbeginn im Strandbad das Licht anschalten“ oder „Bewegung nach Betriebsende meldet eine Push-Nachricht“."
              />
            </Card>
          ) : (
            grouped.map(([room, rules]) => (
              <section key={room} className="space-y-2">
                <SectionHeading title={`${room} (${rules.length})`} />
                <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
                  {rules.map((rule) => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      nowMs={nowMs}
                      readonly={data.readonly}
                      busy={busyId === rule.id}
                      onRun={() => run(rule)}
                      onToggle={() => toggle(rule)}
                      onEdit={() => setEditing(rule)}
                      onDelete={() => askRemove(rule)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </TabsContent>

        <TabsContent value="runs">
          {data.runs.length === 0 ? (
            <Card className="py-0 sm:py-0">
              <EmptyState compact icon={Clock} title="Noch kein Lauf aufgezeichnet." />
            </Card>
          ) : (
            // Zeilen mit Haarlinie in einer Karte (docs/design-regeln.md, Abschnitt 17).
            <Card className="gap-0 py-0 sm:py-0 divide-y divide-border/60">
              {data.runs.map((run) => (
                <div key={run.id} className="flex items-start gap-2 px-4 py-2.5 text-xs sm:px-[18px]">
                  {run.success ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{run.ruleName}</span>
                      <span className="text-muted-foreground">
                        {TRIGGER_KIND_LABELS[run.triggerKind] ?? run.triggerKind}
                      </span>
                    </div>
                    {run.errorMessage && (
                      <p className="mt-0.5 text-destructive">{run.errorMessage}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{fmtAgo(run.triggeredAt, nowMs)}</span>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Löschen immer mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regel „{toDelete?.name}“ löschen?</AlertDialogTitle>
            <AlertDialogDescription>Der Verlauf bleibt erhalten.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toDelete) void remove(toDelete);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {creating && (
        <RuleDialog rule={null} options={data.options} open onClose={() => setCreating(false)} />
      )}
      {editing && (
        <RuleDialog
          key={editing.id}
          rule={editing}
          options={data.options}
          open
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
