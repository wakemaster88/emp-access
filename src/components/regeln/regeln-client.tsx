"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorLine, apiRequest, fmtAgo } from "@/components/raeume/shared";
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
    <Card className={rule.isActive ? "p-4" : "p-4 opacity-60"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{rule.name}</h3>
            <Badge variant="secondary" className="h-5 text-[10px]">
              {TRIGGER_LABELS[rule.trigger]}
            </Badge>
            {!rule.isActive && (
              <Badge className="h-5 border-0 bg-neutral-100 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                pausiert
              </Badge>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
            <Building2 className="h-3 w-3 shrink-0" />
            {rule.room?.name ?? "betriebsweit"}
          </p>
          {rule.description && (
            <p className="mt-0.5 truncate text-xs text-neutral-500">{rule.description}</p>
          )}
        </div>

        {!readonly && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-neutral-400 hover:text-emerald-600"
              disabled={busy}
              onClick={onRun}
              title="Jetzt ausführen"
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-neutral-500"
              disabled={busy}
              onClick={onToggle}
            >
              {rule.isActive ? "Pause" : "Aktiv"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              onClick={onEdit}
              title="Bearbeiten"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-neutral-400 hover:text-red-600"
              onClick={onDelete}
              title="Löschen"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-neutral-500">Auslöser</dt>
          <dd className="font-medium">{describeTrigger(rule)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-neutral-500">Dann</dt>
          <dd>
            {rule.actions.length === 0 ? (
              <span className="text-amber-600">keine Aktion hinterlegt</span>
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

      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-neutral-100 pt-2 text-[11px] text-neutral-500 dark:border-neutral-800">
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
      </div>
    </Card>
  );
}

export function RegelnClient({ data }: { data: RegelnData }) {
  const router = useRouter();
  const nowMs = useNow(new Date(data.renderedAt).getTime());
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
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

  async function remove(rule: Rule) {
    if (!confirm(`Regel „${rule.name}“ löschen? Der Verlauf bleibt erhalten.`)) return;
    setError("");
    const res = await apiRequest(`/api/regeln/${rule.id}`, "DELETE");
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          {data.rules.length === 0
            ? "Noch keine Regel angelegt."
            : `${activeCount} von ${data.rules.length} ${data.rules.length === 1 ? "Regel" : "Regeln"} aktiv.`}
        </p>
        {!data.readonly && (
          <Button
            size="sm"
            className="h-8 bg-indigo-600 text-xs hover:bg-indigo-700"
            onClick={() => setCreating(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Regel
          </Button>
        )}
      </div>

      <ErrorLine message={error} />
      {notice && (
        <p className="rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700 dark:bg-emerald-950/30">
          {notice}
        </p>
      )}

      <Tabs defaultValue="rules">
        <TabsList className="h-8">
          <TabsTrigger value="rules" className="text-xs">
            Regeln ({data.rules.length})
          </TabsTrigger>
          <TabsTrigger value="runs" className="text-xs">
            Verlauf
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-3 space-y-4">
          {data.rules.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 p-8 text-center">
              <Workflow className="h-8 w-8 text-neutral-300" />
              <p className="text-sm font-medium">Keine Regel hinterlegt</p>
              <p className="max-w-md text-xs text-neutral-500">
                Eine Regel verbindet einen Auslöser mit Aktionen: „Bei Betriebsbeginn im Strandbad
                das Licht anschalten“ oder „Bewegung nach Betriebsende meldet eine Push-Nachricht“.
              </p>
            </Card>
          ) : (
            grouped.map(([room, rules]) => (
              <section key={room} className="space-y-2">
                <h2 className="text-xs font-semibold text-neutral-500">
                  {room} ({rules.length})
                </h2>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
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
                      onDelete={() => remove(rule)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-3">
          {data.runs.length === 0 ? (
            <p className="text-xs text-neutral-500">Noch kein Lauf aufgezeichnet.</p>
          ) : (
            <Card className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.runs.map((run) => (
                <div key={run.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                  {run.success ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{run.ruleName}</span>
                      <span className="text-neutral-500">
                        {TRIGGER_KIND_LABELS[run.triggerKind] ?? run.triggerKind}
                      </span>
                    </div>
                    {run.errorMessage && (
                      <p className="mt-0.5 text-rose-600">{run.errorMessage}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-neutral-400">{fmtAgo(run.triggeredAt, nowMs)}</span>
                </div>
              ))}
            </Card>
          )}
        </TabsContent>
      </Tabs>

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
