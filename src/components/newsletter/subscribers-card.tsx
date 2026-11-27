"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, MailPlus, Save, Send, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checklist, ChecklistItem } from "@/components/ui/checklist";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SOURCE_LABEL, type SubscriberStatus } from "@/lib/newsletter/rules";
import { subscriberBadge } from "./campaign-ui";

export interface SubscriberRow {
  id: number;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  statusLabel: string;
  source: string;
  createdLabel: string;
  consentText: string | null;
  consentLabel: string | null;
  consentIp: string | null;
  confirmedLabel: string | null;
  confirmIp: string | null;
  confirmMailLabel: string | null;
  unsubscribedLabel: string | null;
  unsubscribeReason: string | null;
  bouncedLabel: string | null;
  lastSentLabel: string | null;
  groupIds: number[];
}

export interface SubscriberGroup {
  id: number;
  name: string;
  key: string | null;
  active: number;
}

const REASON_LABEL: Record<string, string> = {
  link: "über den Link",
  "one-click": "mit einem Klick im Postfach",
  verwaltung: "in der Verwaltung",
};

type Pending = "unsubscribe" | "delete" | null;

/** Abonnenten mit Nachweis der Einwilligung, Suche und Eintragen. */
export function SubscribersCard({
  subscribers,
  matching,
  total,
  limit,
  query,
  status,
  groupId,
  groups,
  canSend,
}: {
  subscribers: SubscriberRow[];
  matching: number;
  total: number;
  limit: number;
  query: string;
  status: SubscriberStatus | null;
  /** Gewählte Gruppe (Filter). */
  groupId: number | null;
  groups: SubscriberGroup[];
  /** Versand bereit: Bestätigungsmails gehen raus. */
  canSend: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(query);
  const [selected, setSelected] = useState<SubscriberRow | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [invite, setInvite] = useState<{ email: string; name: string } | null>(null);
  const [memberOf, setMemberOf] = useState<number[]>([]);

  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const groupsOf = (s: SubscriberRow) => s.groupIds.map((id) => groupName.get(id)).filter(Boolean).join(", ");
  // Die Gruppe „Abos aus anny“ füllt emp-access selbst.
  const editableGroups = groups.filter((g) => g.key !== "anny-abos");
  const annyGroup = groups.find((g) => g.key === "anny-abos");

  const navigate = (next: { q?: string; group?: number | null }) => {
    const params = new URLSearchParams({ tab: "abonnenten" });
    if (status) params.set("status", status);
    const g = next.group === undefined ? groupId : next.group;
    if (g) params.set("gruppe", String(g));
    const value = next.q ?? query;
    if (value.trim()) params.set("q", value.trim());
    router.push(`/newsletter?${params.toString()}`);
  };
  const search = (value: string) => navigate({ q: value });

  const openRow = (s: SubscriberRow) => {
    setSelected(s);
    setMemberOf(s.groupIds.filter((id) => editableGroups.some((g) => g.id === id)));
    setPending(null);
    setError("");
    setInfo("");
  };
  const groupsDirty =
    !!selected &&
    JSON.stringify([...memberOf].sort((a, b) => a - b)) !==
      JSON.stringify(selected.groupIds.filter((id) => editableGroups.some((g) => g.id === id)).sort((a, b) => a - b));

  async function saveGroups() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch(`/api/newsletter/subscribers/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "groups", groupIds: memberOf }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      const kept = selected.groupIds.filter((id) => !editableGroups.some((g) => g.id === id));
      setSelected({ ...selected, groupIds: [...kept, ...memberOf] });
      setInfo("Gruppen gespeichert.");
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "unsubscribe" | "resend" | "delete") {
    if (!selected) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch(
        `/api/newsletter/subscribers/${selected.id}`,
        action === "delete"
          ? { method: "DELETE" }
          : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt");
        return;
      }
      if (action === "resend") {
        setInfo("Die Bestätigungsmail ist unterwegs.");
      } else {
        setSelected(null);
      }
      setPending(null);
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    if (!invite) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/newsletter/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: invite.email.trim(), name: invite.name.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Eintragen fehlgeschlagen");
        return;
      }
      setInvite(null);
      setInfo(typeof json.message === "string" ? json.message : "Eingetragen.");
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  const filtered = !!query || !!status || !!groupId;

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-primary" />
            Abonnenten ({matching})
          </CardTitle>
          <CardDescription>
            Neueste zuerst{matching > limit ? `, die ersten ${limit}` : ""}. Angemeldet ist eine Adresse erst nach dem Klick
            auf den Link in der Bestätigungsmail.
          </CardDescription>
          <CardAction>
            <Button
              onClick={() => {
                setInvite({ email: "", name: "" });
                setError("");
              }}
              className="max-sm:h-11"
              aria-label="Adresse eintragen"
            >
              <UserPlus className="h-4 w-4" />
              <span>Adresse<span className="max-sm:sr-only"> eintragen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:items-center sm:px-[18px]">
          <form
            className="min-w-0 flex-1"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              search(q);
            }}
          >
            <SearchInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => {
                setQ("");
                search("");
              }}
              placeholder="E-Mail oder Name suchen"
              aria-label="Abonnenten suchen"
              containerClassName="sm:max-w-sm"
              className="max-sm:h-11"
            />
          </form>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <NativeSelect
              aria-label="Gruppe"
              value={groupId ? String(groupId) : ""}
              onChange={(e) => navigate({ group: e.target.value ? Number(e.target.value) : null })}
              containerClassName="sm:w-52"
              className="max-sm:h-11"
            >
              <option value="">Alle Gruppen</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.active.toLocaleString("de-DE")})
                </option>
              ))}
            </NativeSelect>
            <Button asChild variant="outline" className="max-sm:h-11" disabled={total === 0}>
              <a href="/api/newsletter/subscribers/export" download aria-label="CSV mit Einwilligungen herunterladen">
                <Download className="h-4 w-4" />
                <span>CSV<span className="max-sm:sr-only"> mit Einwilligungen</span></span>
              </a>
            </Button>
          </div>
        </div>
        {info && !selected && (
          <div className="px-4 pb-3 sm:px-[18px]">
            <Notice tone="success" compact title={info} />
          </div>
        )}
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>E-Mail</TableHead>
              <TableHead className="hidden sm:table-cell">Gruppen</TableHead>
              <TableHead className="hidden sm:table-cell">Seit</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscribers.length === 0 && (
              <TableEmpty
                colSpan={4}
                icon={Users}
                title={filtered ? "Keine Treffer." : "Noch keine Abonnenten."}
                description={filtered ? "Suche oder Filter ändern." : "Anmeldungen kommen über das Formular auf der Website."}
                compact={false}
              />
            )}
            {subscribers.map((s) => (
              <TableRow key={s.id} className="cursor-pointer max-sm:h-11" onClick={() => openRow(s)}>
                <TableCell className="max-w-0 w-full whitespace-normal">
                  <button
                    type="button"
                    className="break-all text-left font-medium text-foreground hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openRow(s);
                    }}
                  >
                    {s.email}
                  </button>
                  {s.name && <div className="text-xs text-muted-foreground">{s.name}</div>}
                  <div className="text-xs text-muted-foreground sm:hidden">
                    {groupsOf(s) || SOURCE_LABEL[s.source] || s.source} · {s.createdLabel}
                  </div>
                </TableCell>
                <TableCell className="hidden whitespace-normal sm:table-cell">
                  {groupsOf(s) || <span className="text-muted-foreground">–</span>}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap tabular-nums sm:table-cell">{s.createdLabel}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={subscriberBadge(s.status)} className="font-normal">{s.statusLabel}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && !busy && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="break-all">{selected.email}</DialogTitle>
                <DialogDescription>
                  {selected.statusLabel}
                  {selected.name ? ` · ${selected.name}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                  <Fact label="Quelle" value={SOURCE_LABEL[selected.source] ?? selected.source} />
                  <Fact label="Eingetragen" value={selected.consentLabel ?? selected.createdLabel} />
                  <Fact label="IP bei Anmeldung" value={selected.consentIp} />
                  <Fact label="Bestätigungsmail" value={selected.confirmMailLabel} />
                  <Fact label="Bestätigt" value={selected.confirmedLabel} />
                  <Fact label="IP bei Bestätigung" value={selected.confirmIp} />
                  <Fact label="Letzte Aussendung" value={selected.lastSentLabel} />
                  <Fact
                    label="Abgemeldet"
                    value={
                      selected.unsubscribedLabel &&
                      `${selected.unsubscribedLabel}${selected.unsubscribeReason ? ` · ${REASON_LABEL[selected.unsubscribeReason] ?? selected.unsubscribeReason}` : ""}`
                    }
                  />
                  <Fact label="Unzustellbar oder Spam" value={selected.bouncedLabel} />
                </dl>
                {selected.consentText && (
                  <div className="space-y-1">
                    <p className="text-label">{selected.source === "anny" ? "Grundlage" : "Einwilligungstext"}</p>
                    <p className="glass-tile px-3 py-2 text-[13px] text-muted-foreground">{selected.consentText}</p>
                  </div>
                )}

                {(editableGroups.length > 0 || annyGroup) && (
                  <div className="space-y-1.5">
                    <p id="nl-sub-groups" className="text-label">Gruppen</p>
                    {editableGroups.length > 0 && (
                      <Checklist aria-labelledby="nl-sub-groups" maxHeight="14rem">
                        {editableGroups.map((g) => (
                          <ChecklistItem
                            key={g.id}
                            title={g.name}
                            checked={memberOf.includes(g.id)}
                            disabled={busy}
                            onCheckedChange={(on) =>
                              setMemberOf((list) => (on ? [...list, g.id] : list.filter((id) => id !== g.id)))
                            }
                          />
                        ))}
                      </Checklist>
                    )}
                    {annyGroup && (
                      <p className="text-xs text-muted-foreground">
                        {selected.groupIds.includes(annyGroup.id)
                          ? `In „${annyGroup.name}“: hat ein laufendes Abo aus anny.`
                          : `Nicht in „${annyGroup.name}“: kein laufendes Abo aus anny mit dieser Adresse.`}
                      </p>
                    )}
                    {groupsDirty && (
                      <div className="flex justify-end">
                        <Button type="button" size="sm" onClick={() => void saveGroups()} disabled={busy} className="max-sm:h-11 max-sm:w-full">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Gruppen speichern
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {info && <Notice tone="success" compact title={info} />}
                {error && <Notice tone="danger" compact title={error} />}
                {pending && (
                  <Notice
                    tone="danger"
                    compact
                    title={pending === "delete" ? "Adresse samt Versandprotokoll löschen?" : "Adresse abmelden?"}
                    action={
                      <Button type="button" variant="destructive" size="sm" onClick={() => act(pending)} disabled={busy} className="max-sm:h-11">
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : pending === "delete" ? <Trash2 className="h-3.5 w-3.5" /> : <UserMinus className="h-3.5 w-3.5" />}
                        {pending === "delete" ? "Endgültig löschen" : "Abmelden"}
                      </Button>
                    }
                  >
                    {pending === "delete"
                      ? "Der Nachweis der Einwilligung ist danach weg. Für eine Abmeldung reicht „Abmelden“."
                      : "Die Adresse bekommt keine Aussendungen mehr. Der Nachweis bleibt gespeichert."}
                  </Notice>
                )}

                <DialogFooter
                  start={
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setPending("delete")}
                      disabled={busy}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive max-sm:h-11"
                    >
                      <Trash2 className="h-4 w-4" />
                      Löschen
                    </Button>
                  }
                >
                  {selected.status === "PENDING" && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => act("resend")}
                      disabled={busy || !canSend}
                      title={canSend ? undefined : "Erst den Versand in den Einstellungen bereit machen"}
                      className="max-sm:h-11"
                    >
                      <Send className="h-4 w-4" />
                      Bestätigung erneut senden
                    </Button>
                  )}
                  {(selected.status === "ACTIVE" || selected.status === "PENDING") && (
                    <Button type="button" variant="outline" onClick={() => setPending("unsubscribe")} disabled={busy} className="max-sm:h-11">
                      <UserMinus className="h-4 w-4" />
                      Abmelden
                    </Button>
                  )}
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!invite} onOpenChange={(o) => !o && !busy && setInvite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adresse eintragen</DialogTitle>
            <DialogDescription>
              Die Person bekommt eine Bestätigungsmail und ist erst nach dem Klick auf den Link angemeldet.
            </DialogDescription>
          </DialogHeader>
          {invite && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (invite.email.trim()) void sendInvite();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="nl-invite-email">E-Mail</Label>
                <Input
                  id="nl-invite-email"
                  type="email"
                  autoComplete="off"
                  value={invite.email}
                  maxLength={180}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                  className="max-sm:h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nl-invite-name">Name (optional)</Label>
                <Input
                  id="nl-invite-name"
                  value={invite.name}
                  maxLength={120}
                  onChange={(e) => setInvite({ ...invite, name: e.target.value })}
                  className="max-sm:h-11"
                />
              </div>
              {!canSend && (
                <Notice tone="warning" compact title="Die Bestätigungsmail geht erst raus, wenn der Versand bereit ist." />
              )}
              {error && <Notice tone="danger" compact title={error} />}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInvite(null)} disabled={busy} className="max-sm:h-11">
                  Abbrechen
                </Button>
                <Button type="submit" disabled={busy || !invite.email.trim()} className="min-w-24 max-sm:h-11">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><MailPlus className="h-4 w-4" />Eintragen</>}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words tabular-nums text-foreground">{value}</dd>
    </>
  );
}
