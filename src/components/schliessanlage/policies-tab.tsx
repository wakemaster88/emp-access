"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, History, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
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
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PolicyDialog } from "@/components/schliessanlage/policy-dialog";
import { EmptyHint, ErrorLine, apiRequest, fmtDate } from "@/components/schliessanlage/shared";
import type { PolicyRow } from "@/components/schliessanlage/types";

interface Props {
  policies: PolicyRow[];
  readonly: boolean;
}

export function PoliciesTab({ policies, readonly }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ policy: PolicyRow | null } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Rückfrage vor dem Löschen (docs/design-regeln.md, Abschnitt 18); die Version bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<PolicyRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  function askRemove(policy: PolicyRow) {
    setToDelete(policy);
    setConfirmOpen(true);
  }

  async function remove(policy: PolicyRow) {
    setError("");
    const res = await apiRequest(`/api/schliessanlage/policies/${policy.id}`, "DELETE");
    if (!res.ok) setError(res.message);
    else router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="tabular-nums">
          {groups.length} {groups.length === 1 ? "Vorlage" : "Vorlagen"}
        </CardTitle>
        <CardDescription>
          Belehrung und Haftungserklärung. Änderungen erzeugen eine neue Version, damit bereits
          unterschriebene Protokolle unverändert bleiben.
        </CardDescription>
        {!readonly && (
          <CardAction>
            <Button
              size="sm"
              onClick={() => setDialog({ policy: null })}
              className="max-sm:h-11"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Vorlage
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-2">
        <ErrorLine message={error} />

        {groups.length === 0 && (
          <EmptyHint icon={ScrollText}>
            Noch keine Vorlage. Ohne aktive Belehrung lässt sich kein Signatur-Link erzeugen.
          </EmptyHint>
        )}

        {groups.map((group) => {
          const current = group.versions.find((v) => v.isActive) ?? group.versions[0]!;
          const older = group.versions.filter((v) => v.id !== current.id);
          const isOpen = expanded === group.name;

          return (
            <div key={group.name} className="glass-tile p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="inline-flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                    {group.name}
                    <Badge variant={current.isActive ? "success" : "neutral"} className="tabular-nums">
                      {current.isActive ? `aktiv · v${current.version}` : `inaktiv · v${current.version}`}
                    </Badge>
                  </p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-[11px] text-muted-foreground">
                    {current.bodyText}
                  </p>
                  {current.liabilityText && (
                    <p className="mt-1 text-[11px] text-muted-foreground">Mit Haftungserklärung</p>
                  )}
                </div>
                {!readonly && (
                  // Rechtsbündig, auch wenn die Handlungen auf dem Handy in eine zweite Zeile rutschen (wie bei Räumen).
                  <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    {!current.isActive && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => activate(current)}
                        className="text-muted-foreground hover:text-success max-sm:size-11"
                        title="Diese Version aktivieren"
                        aria-label="Diese Version aktivieren"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDialog({ policy: current })}
                      className="text-muted-foreground hover:text-primary max-sm:size-11"
                      title="Neue Version erstellen"
                      aria-label="Neue Version erstellen"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {older.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(isOpen ? null : group.name)}
                        aria-expanded={isOpen}
                        className="gap-1 text-[11px] text-muted-foreground tabular-nums hover:text-foreground max-sm:h-11"
                        title="Ältere Versionen"
                        aria-label={`Ältere Versionen (${older.length})`}
                      >
                        <History className="h-3.5 w-3.5" />
                        {older.length}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {isOpen && (
                // Ältere Versionen als Zeilen mit Haarlinie, keine eigene Fläche in der Kachel.
                <div className="mt-2 divide-y divide-border border-t border-border">
                  {older.map((v) => (
                    <div
                      key={v.id}
                      // Bei Touch etwas höher: die Tippflächen der Tasten (44 px)
                      // reichen sonst in die Zeile darüber.
                      className="flex items-center gap-2 py-1 pointer-coarse:py-1.5"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">v{v.version}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(v.createdAt)}</span>
                      {!readonly && (
                        <div className="ml-auto flex items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => activate(v)}
                            className="text-muted-foreground hover:text-success max-sm:size-11"
                            title="Diese Version wieder aktivieren"
                            aria-label="Diese Version wieder aktivieren"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => askRemove(v)}
                            className="text-muted-foreground hover:text-destructive max-sm:size-11"
                            title="Version löschen"
                            aria-label="Version löschen"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
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

      {/* Löschen immer mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Version ${toDelete?.version} von "${toDelete?.name}" löschen?`}</AlertDialogTitle>
            <AlertDialogDescription>Bereits verwendete Versionen werden nur deaktiviert.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="max-sm:h-11">Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="max-sm:h-11"
              onClick={() => {
                if (toDelete) void remove(toDelete);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
