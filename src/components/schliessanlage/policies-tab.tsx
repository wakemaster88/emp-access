"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, History, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PolicyDialog } from "@/components/schliessanlage/policy-dialog";
import { EmptyHint, ErrorLine, apiRequest, fmtDate } from "@/components/schliessanlage/shared";
import type { PolicyRow } from "@/components/schliessanlage/types";
import { cn } from "@/lib/utils";

interface Props {
  policies: PolicyRow[];
  readonly: boolean;
}

export function PoliciesTab({ policies, readonly }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ policy: PolicyRow | null } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Gleicher Name = eine Vorlage mit Versionshistorie.
  const groups = useMemo(() => {
    const byName = new Map<string, PolicyRow[]>();
    for (const p of policies) {
      const list = byName.get(p.name) ?? [];
      list.push(p);
      byName.set(p.name, list);
    }
    return [...byName.entries()].map(([name, versions]) => ({
      name,
      versions: [...versions].sort((a, b) => b.version - a.version),
    }));
  }, [policies]);

  async function activate(policy: PolicyRow) {
    setError("");
    const res = await apiRequest(`/api/schliessanlage/policies/${policy.id}`, "PUT", {
      isActive: true,
    });
    if (!res.ok) setError(res.message);
    else router.refresh();
  }

  async function remove(policy: PolicyRow) {
    if (
      !confirm(
        `Version ${policy.version} von "${policy.name}" löschen? Bereits verwendete Versionen werden nur deaktiviert.`,
      )
    ) {
      return;
    }
    setError("");
    const res = await apiRequest(`/api/schliessanlage/policies/${policy.id}`, "DELETE");
    if (!res.ok) setError(res.message);
    else router.refresh();
  }

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base sm:text-xl">
              {groups.length} {groups.length === 1 ? "Vorlage" : "Vorlagen"}
            </CardTitle>
            <CardDescription>
              Belehrung und Haftungserklärung. Änderungen erzeugen eine neue Version, damit bereits
              unterschriebene Protokolle unverändert bleiben.
            </CardDescription>
          </div>
          {!readonly && (
            <Button
              size="sm"
              onClick={() => setDialog({ policy: null })}
              className="h-8 bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Vorlage
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        <ErrorLine message={error} />

        {groups.length === 0 && (
          <EmptyHint>
            Noch keine Vorlage. Ohne aktive Belehrung lässt sich kein Signatur-Link erzeugen.
          </EmptyHint>
        )}

        {groups.map((group) => {
          const current = group.versions.find((v) => v.isActive) ?? group.versions[0]!;
          const older = group.versions.filter((v) => v.id !== current.id);
          const isOpen = expanded === group.name;

          return (
            <div
              key={group.name}
              className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                    {group.name}
                    <Badge
                      className={cn(
                        "py-0 text-[10px]",
                        current.isActive
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800",
                      )}
                    >
                      {current.isActive ? `aktiv · v${current.version}` : `inaktiv · v${current.version}`}
                    </Badge>
                  </p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-[11px] text-slate-500 dark:text-slate-400">
                    {current.bodyText}
                  </p>
                  {current.liabilityText && (
                    <p className="mt-1 text-[10px] text-slate-400">Mit Haftungserklärung</p>
                  )}
                </div>
                {!readonly && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {!current.isActive && (
                      <button
                        type="button"
                        onClick={() => activate(current)}
                        className="p-1 text-slate-400 hover:text-emerald-600"
                        title="Diese Version aktivieren"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDialog({ policy: current })}
                      className="p-1 text-slate-400 hover:text-indigo-500"
                      title="Neue Version erstellen"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {older.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : group.name)}
                        className="inline-flex items-center gap-0.5 p-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        title="Ältere Versionen"
                      >
                        <History className="h-3.5 w-3.5" />
                        {older.length}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800">
                  {older.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 dark:bg-slate-800/50"
                    >
                      <span className="font-mono text-[11px] text-slate-500">v{v.version}</span>
                      <span className="text-[11px] text-slate-400">{fmtDate(v.createdAt)}</span>
                      {!readonly && (
                        <div className="ml-auto flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => activate(v)}
                            className="p-0.5 text-slate-400 hover:text-emerald-600"
                            title="Diese Version wieder aktivieren"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(v)}
                            className="p-0.5 text-slate-400 hover:text-rose-500"
                            title="Version löschen"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      {dialog && (
        <PolicyDialog policy={dialog.policy} open onClose={() => setDialog(null)} />
      )}
    </Card>
  );
}
