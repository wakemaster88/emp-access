"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { RiderOpenRow } from "@/lib/riders-open";

function fmtDate(iso: string | null, empty = "offen"): string {
  if (!iso) return empty;
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin",
  });
}

function age(iso: string | null): number | null {
  if (!iso) return null;
  const b = new Date(iso);
  const now = new Date();
  let a = now.getFullYear() - b.getUTCFullYear();
  const m = now.getMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getUTCDate())) a--;
  return a;
}

interface Draft {
  row: RiderOpenRow;
  /** Person des Kontos (`p<id>`) oder neue Person. */
  choice: string;
  firstName: string;
  lastName: string;
  birthDate: string;
}

/**
 * Abos mit Kundenkonto, aber ohne Person („Fahrer offen“). Meist steht am
 * Kids-Abo das Geburtsdatum der Eltern. Hier sagt man, wer damit fährt:
 * eine Person des Kontos oder eine neue.
 */
export function RidersOpenCard({ rows }: { rows: RiderOpenRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.ticketName.toLowerCase().includes(q) || r.email.includes(q) || r.aboName?.toLowerCase().includes(q)
        || r.persons.some((p) => p.name.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  function open(row: RiderOpenRow) {
    setError(null);
    setDraft({ row, choice: "new", firstName: "", lastName: row.lastName ?? "", birthDate: "" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    const body = draft.choice === "new"
      ? { firstName: draft.firstName, lastName: draft.lastName, birthDate: draft.birthDate || null }
      : { personId: Number(draft.choice.slice(1)) };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${draft.row.id}/rider`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setDraft(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const chosen = draft && draft.choice !== "new" ? draft.row.persons.find((p) => `p${p.id}` === draft.choice) : null;
  const canSave = draft != null && (draft.choice !== "new" || !!(draft.firstName.trim() || draft.lastName.trim()));

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle>Fahrer offen ({rows.length})</CardTitle>
          <CardDescription>
            Wer mit diesen Abos fährt, ist unklar, meist steht am Kids-Abo das Geburtsdatum der Eltern.
            Trag den Fahrer hier oder an der Kasse ein.
          </CardDescription>
        </CardHeader>
        <div className="px-4 pb-3 sm:px-5">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder="Name, E-Mail oder Abo suchen"
            aria-label="Name, E-Mail oder Abo suchen"
            containerClassName="sm:max-w-sm"
          />
        </div>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Am Abo steht</TableHead>
              <TableHead className="max-sm:hidden">Abo</TableHead>
              <TableHead className="text-right max-sm:hidden">Läuft bis</TableHead>
              <TableHead className="text-right">Eintragen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && <TableEmpty colSpan={4} title="Kein Abo gefunden." />}
            {shown.map((r) => {
              const a = age(r.ticketBirthDate);
              return (
                <TableRow key={r.id}>
                  <TableCell className="max-sm:whitespace-normal">
                    <div className="font-medium">
                      {r.ticketName}
                      {a != null && <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">({a})</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                      <span className="break-all">{r.email}</span>
                      <span className="sm:hidden">· {r.aboName ?? "Abo"} · bis {fmtDate(r.endDate)}</span>
                      {r.status === "PAUSED" && <Badge variant="warning">Pausiert</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="max-sm:hidden">{r.aboName ?? "–"}</TableCell>
                  <TableCell className="text-right tabular-nums max-sm:hidden">{fmtDate(r.endDate)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Fahrer für ${r.aboName ?? "Abo"} von ${r.ticketName} eintragen`}
                      className="max-sm:size-11"
                      onClick={() => open(r)}
                    >
                      <UserPlus />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={draft != null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fahrer eintragen</DialogTitle>
            <DialogDescription>
              {draft
                ? `${draft.row.aboName ?? "Abo"} · ${draft.row.email}. Am Abo steht ${draft.row.ticketName}`
                  + (draft.row.ticketBirthDate ? `, geboren ${fmtDate(draft.row.ticketBirthDate, "")}.` : ".")
                : ""}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <form className="space-y-3" onSubmit={save}>
              {draft.row.persons.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Wer fährt?</Label>
                  <Segmented
                    aria-label="Wer fährt?"
                    value={draft.choice}
                    onValueChange={(choice) => setDraft({ ...draft, choice })}
                    options={[
                      ...draft.row.persons.map((p) => ({ value: `p${p.id}`, label: p.name })),
                      { value: "new", label: "Neue Person" },
                    ]}
                  />
                  {chosen && (
                    <p className="text-xs text-muted-foreground">
                      {chosen.birthDate ? `Geboren ${fmtDate(chosen.birthDate, "")}` : "Ohne Geburtsdatum"}
                      {chosen.abos.length > 0 ? ` · fährt schon mit ${chosen.abos.join(", ")}` : ""}
                    </p>
                  )}
                </div>
              )}
              {draft.choice === "new" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="rider-first">Vorname</Label>
                      <Input
                        id="rider-first"
                        value={draft.firstName}
                        onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                        autoComplete="off"
                        maxLength={80}
                        className="max-sm:h-11"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rider-last">Nachname</Label>
                      <Input
                        id="rider-last"
                        value={draft.lastName}
                        onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
                        autoComplete="off"
                        maxLength={80}
                        className="max-sm:h-11"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rider-birth">Geburtsdatum</Label>
                    <Input
                      id="rider-birth"
                      type="date"
                      value={draft.birthDate}
                      onChange={(e) => setDraft({ ...draft, birthDate: e.target.value })}
                      className="max-sm:h-11"
                    />
                  </div>
                </>
              )}
              {error && <Notice tone="danger" compact title={error} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" disabled={busy} className="max-sm:h-11" onClick={() => setDraft(null)}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={busy || !canSave} className="max-sm:h-11">
                  {busy ? <Loader2 className="animate-spin" /> : "Speichern"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
