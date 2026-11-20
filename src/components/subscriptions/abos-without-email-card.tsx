"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { AboSource, AboWithoutEmailRow } from "@/lib/abos-without-email";

const SOURCE_LABEL: Record<AboSource, string> = {
  reepay: "Reepay-Import",
  anny: "anny",
  manual: "Manuell",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "offen";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin",
  });
}

/**
 * Laufende Abos ohne E-Mail-Adresse. Über die Adresse findet der Kunde sein
 * Abo in der App; neue Abos brauchen sie, ältere bekommen sie hier.
 */
export function AbosWithoutEmailCard({ rows }: { rows: AboWithoutEmailRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<{ row: AboWithoutEmailRow; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.person.toLowerCase().includes(q) || r.aboName?.toLowerCase().includes(q));
  }, [rows, query]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${edit.row.id}/email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: edit.email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setEdit(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle>Abos ohne E-Mail ({rows.length})</CardTitle>
          <CardDescription>
            Ohne Adresse findet der Kunde sein Abo nicht in der App und bekommt keinen Hinweis zum Ablauf.
            Frag beim nächsten Besuch danach und trag sie hier ein.
          </CardDescription>
        </CardHeader>
        <div className="px-4 pb-3 sm:px-5">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder="Name oder Abo suchen"
            aria-label="Name oder Abo suchen"
            containerClassName="sm:max-w-sm"
          />
        </div>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="max-sm:hidden">Abo</TableHead>
              <TableHead className="text-right max-sm:hidden">Läuft bis</TableHead>
              <TableHead className="text-right">Eintragen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && <TableEmpty colSpan={4} title="Kein Abo gefunden." />}
            {shown.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-sm:whitespace-normal">
                  <div className="font-medium">{r.person}</div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                    <span className="sm:hidden">{r.aboName ?? "Abo"} · bis {fmtDate(r.endDate)}</span>
                    <Badge variant="neutral">{SOURCE_LABEL[r.source]}</Badge>
                    {r.status === "PAUSED" && <Badge variant="warning">Pausiert</Badge>}
                    {r.suggestion && <Badge variant="info">Vorschlag da</Badge>}
                  </div>
                </TableCell>
                <TableCell className="max-sm:hidden">{r.aboName ?? "–"}</TableCell>
                <TableCell className="text-right tabular-nums max-sm:hidden">{fmtDate(r.endDate)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`E-Mail für ${r.person} eintragen`}
                    className="max-sm:size-11"
                    onClick={() => { setError(null); setEdit({ row: r, email: r.suggestion ?? "" }); }}
                  >
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={edit != null} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>E-Mail eintragen</DialogTitle>
            <DialogDescription>
              {edit ? `${edit.row.person}, ${edit.row.aboName ?? "Abo"}. ` : ""}
              Mit dieser Adresse meldet sich der Kunde in der App an.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form className="space-y-3" onSubmit={save}>
              <div className="space-y-1.5">
                <Label htmlFor="abo-email">E-Mail</Label>
                <Input
                  id="abo-email"
                  type="email"
                  value={edit.email}
                  onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                  autoComplete="off"
                  required
                  maxLength={180}
                  className="max-sm:h-11"
                />
                {edit.row.suggestion && (
                  <p className="text-xs text-muted-foreground">
                    Vorschlag aus anderen Tickets mit demselben Namen. Bitte mit dem Kunden prüfen, bevor du speicherst.
                  </p>
                )}
              </div>
              {error && <Notice tone="danger" compact title={error} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" disabled={busy} className="max-sm:h-11" onClick={() => setEdit(null)}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={busy || !edit.email.trim()} className="max-sm:h-11">
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
