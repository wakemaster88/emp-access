"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe, Loader2, Pencil, Plus, Repeat, Save, Tag, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SYSTEM_GROUP_HINT, SYSTEM_GROUP_NAME, type SystemGroupKey } from "@/lib/newsletter/rules";

export interface GroupRow {
  id: number;
  name: string;
  key: string | null;
  members: number;
  active: number;
}

const GROUP_ICON: Record<SystemGroupKey, LucideIcon> = { website: Globe, "anny-abos": Repeat };

function isSystemKey(key: string | null): key is SystemGroupKey {
  return key === "website" || key === "anny-abos";
}

/**
 * Gruppen der Abonnenten: feste Gruppen (Website, Abos aus anny) und eigene.
 * Ein Klick auf den Namen filtert die Liste darunter.
 */
export function GroupsCard({
  groups,
  selectedId,
  annyAutoSubscribe,
  annySyncedLabel,
}: {
  groups: GroupRow[];
  selectedId: number | null;
  annyAutoSubscribe: boolean;
  annySyncedLabel: string | null;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<{ id: number | null; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [anny, setAnny] = useState(annyAutoSubscribe);
  const [annyBusy, setAnnyBusy] = useState(false);
  const [annyInfo, setAnnyInfo] = useState("");

  // Die Gruppe „Abos aus anny“ entsteht beim ersten Abgleich; bis dahin als leere Zeile zeigen.
  const rows: GroupRow[] = groups.some((g) => g.key === "anny-abos")
    ? groups
    : [...groups, { id: 0, name: SYSTEM_GROUP_NAME["anny-abos"], key: "anny-abos", members: 0, active: 0 }];
  rows.sort((a, b) => Number(isSystemKey(b.key)) - Number(isSystemKey(a.key)) || a.name.localeCompare(b.name, "de"));

  const filterHref = (id: number) =>
    selectedId === id ? "/newsletter?tab=abonnenten" : `/newsletter?tab=abonnenten&gruppe=${id}`;

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Netzwerkfehler");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveGroup() {
    if (!edit) return;
    const ok = edit.id
      ? await call(`/api/newsletter/groups/${edit.id}`, { method: "PATCH", body: JSON.stringify({ name: edit.name }) })
      : await call("/api/newsletter/groups", { method: "POST", body: JSON.stringify({ name: edit.name }) });
    if (ok) setEdit(null);
  }

  async function removeGroup() {
    if (!edit?.id) return;
    if (await call(`/api/newsletter/groups/${edit.id}`, { method: "DELETE" })) {
      setEdit(null);
      if (selectedId === edit.id) router.push("/newsletter?tab=abonnenten");
    }
  }

  async function toggleAnny(value: boolean) {
    setAnnyBusy(true);
    setAnny(value);
    setAnnyInfo("");
    try {
      const res = await fetch("/api/newsletter/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annyAutoSubscribe: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAnny(!value);
        setAnnyInfo(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      const s = json.annySync as { abos?: number; created?: number } | null;
      if (value && s) setAnnyInfo(`${s.abos ?? 0} Abo-Kunden in der Gruppe, ${s.created ?? 0} davon neu angemeldet.`);
      router.refresh();
    } catch {
      setAnny(!value);
      setAnnyInfo("Netzwerkfehler");
    } finally {
      setAnnyBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4 shrink-0 text-primary" />
            Gruppen
          </CardTitle>
          <CardDescription>
            Eine Aussendung geht an gewählte Gruppen oder an alle. Eine Adresse kann in mehreren Gruppen sein. Name antippen
            filtert die Liste.
          </CardDescription>
          <CardAction>
            <Button
              onClick={() => {
                setEdit({ id: null, name: "" });
                setConfirmDelete(false);
                setError("");
              }}
              className="max-sm:h-11"
              aria-label="Gruppe anlegen"
            >
              <Plus className="h-4 w-4" />
              <span>Gruppe<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="glass-tile divide-y divide-border overflow-hidden">
            {rows.map((g) => {
              const system = isSystemKey(g.key) ? g.key : null;
              const selected = g.id > 0 && selectedId === g.id;
              return (
                <div key={g.id || g.key} className={cn("space-y-2 px-3 py-2.5", selected && "bg-primary/10")}>
                  <div className="flex min-h-11 items-center gap-3 sm:min-h-0">
                    <IconChip icon={system ? GROUP_ICON[system] : Tag} tone={system ? "primary" : "neutral"} size="sm" />
                    <div className="min-w-0 flex-1">
                      {g.id > 0 ? (
                        <Link
                          href={filterHref(g.id)}
                          className="text-[13px] font-medium text-foreground hover:underline"
                          aria-current={selected ? "true" : undefined}
                        >
                          {g.name}
                        </Link>
                      ) : (
                        <span className="text-[13px] font-medium text-foreground">{g.name}</span>
                      )}
                      {system && <p className="text-xs text-muted-foreground">{SYSTEM_GROUP_HINT[system]}</p>}
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{g.active.toLocaleString("de-DE")}</span> angemeldet
                      {g.members > g.active && <span className="block">{g.members.toLocaleString("de-DE")} insgesamt</span>}
                    </div>
                    {!system && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${g.name} bearbeiten`}
                        onClick={() => {
                          setEdit({ id: g.id, name: g.name });
                          setConfirmDelete(false);
                          setError("");
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {system === "anny-abos" && (
                    <div className="flex items-start justify-between gap-3 sm:pl-10">
                      <div className="min-w-0">
                        <Label htmlFor="nl-anny-auto" className="text-[13px]">Automatisch aufnehmen</Label>
                        <p className="text-xs text-muted-foreground">
                          Als Bestandskunden, ohne Bestätigungsmail. Jede Mail sagt, dass sie jederzeit widersprechen können.
                          Abgemeldete bleiben abgemeldet.
                          {anny && annySyncedLabel ? ` Zuletzt ${annySyncedLabel}.` : ""}
                        </p>
                        {annyInfo && <p className="mt-1 text-xs text-foreground">{annyInfo}</p>}
                      </div>
                      <Switch id="nl-anny-auto" checked={anny} disabled={annyBusy} onCheckedChange={(v) => void toggleAnny(v)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!edit} onOpenChange={(o) => !o && !busy && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit?.id ? "Gruppe bearbeiten" : "Gruppe anlegen"}</DialogTitle>
            <DialogDescription>
              {edit?.id
                ? "Beim Löschen bleiben die Abonnenten erhalten, nur die Zuordnung geht."
                : "Abonnenten ordnest du danach in ihrem Eintrag einer Gruppe zu."}
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (edit.name.trim()) void saveGroup();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="nl-group-name">Name</Label>
                <Input
                  id="nl-group-name"
                  value={edit.name}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  className="max-sm:h-11"
                />
              </div>
              {error && <Notice tone="danger" compact title={error} />}
              {confirmDelete && (
                <Notice
                  tone="danger"
                  compact
                  title="Gruppe löschen?"
                  action={
                    <Button type="button" variant="destructive" size="sm" onClick={() => void removeGroup()} disabled={busy} className="max-sm:h-11">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Löschen
                    </Button>
                  }
                >
                  Die Abonnenten bleiben angemeldet.
                </Notice>
              )}
              <DialogFooter
                start={
                  edit.id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirmDelete(true)}
                      disabled={busy}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive max-sm:h-11"
                    >
                      <Trash2 className="h-4 w-4" />
                      Löschen
                    </Button>
                  ) : undefined
                }
              >
                <Button type="button" variant="outline" onClick={() => setEdit(null)} disabled={busy} className="max-sm:h-11">
                  Abbrechen
                </Button>
                <Button type="submit" disabled={busy || !edit.name.trim()} className="min-w-24 max-sm:h-11">
                  {busy && !confirmDelete ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" />Speichern</>}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
