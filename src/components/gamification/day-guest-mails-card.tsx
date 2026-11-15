"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface DayGuestMailRow {
  email: string;
  tickets: number;
  /** Letzter Besuchstag, JJJJ-MM-TT. */
  lastDay: string;
  /** Der Gast hat die App mit dieser Adresse eingerichtet. */
  inApp: boolean;
}

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * E-Mail-Adressen der Tagesgäste: mit der Adresse am Ticket kommt der Gast in
 * die Kunden-App. Hier lassen sich Adressen eintragen, ändern und entfernen.
 */
export function DayGuestMailsCard({
  rows, year, withoutEmail, mailReady,
}: {
  rows: DayGuestMailRow[];
  year: number;
  /** Tagestickets der Saison ohne Adresse. */
  withoutEmail: number;
  /** E-Mail-Versand ist eingerichtet und aktiv. */
  mailReady: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [edit, setEdit] = useState<{ from: string; to: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.email.includes(q)) : rows;
  }, [rows, query]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/gamification/day-guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setCode("");
      setEmail("");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function change(to: string | null) {
    if (!edit || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const res = await fetch("/api/gamification/day-guests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: edit.from, to }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setEdit(null);
      router.refresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle>Tagesgäste</CardTitle>
          <CardDescription>
            Mit der E-Mail-Adresse am Ticket kommt ein Tagesgast in die App: Er fordert dort seinen Link an und bekommt ihn an diese Adresse.
            Alle Tickets derselben Adresse zählen zusammen. {withoutEmail > 0 && `${withoutEmail} Tagestickets der Saison ${year} haben noch keine Adresse.`}
          </CardDescription>
        </CardHeader>
        <div className="space-y-3 px-4 pb-3 sm:px-5">
          {!mailReady && (
            <Notice
              tone="warning"
              compact
              title="Der E-Mail-Versand ist nicht eingerichtet. Ohne ihn bekommt kein Gast seinen Link (Einstellungen › E-Mail)."
            />
          )}
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5 max-sm:basis-full sm:max-w-56">
              <Label htmlFor="day-guest-code">Ticket-Code</Label>
              <Input id="day-guest-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required minLength={3} className="max-sm:h-11" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 max-sm:basis-full sm:max-w-72">
              <Label htmlFor="day-guest-email">E-Mail</Label>
              <Input id="day-guest-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required maxLength={180} className="max-sm:h-11" />
            </div>
            <Button type="submit" disabled={busy} className="gap-1.5 max-sm:h-11 max-sm:w-full">
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              Adresse eintragen
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Ticket, Armband oder Karte scannen oder den Code tippen. Armband und Karte gelten nur am Tag des Besuchs.
          </p>
          {error && <Notice tone="danger" compact title={error} />}
          {saved && <Notice tone="success" compact title="Adresse gespeichert." />}
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Adresse suchen"
              aria-label="E-Mail-Adresse suchen"
              className="pl-9"
            />
          </div>
        </div>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>E-Mail</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-right max-sm:hidden">Zuletzt</TableHead>
              <TableHead className="text-right">Ändern</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableEmpty
                colSpan={4}
                title={rows.length === 0 ? "Noch kein Tagesticket mit E-Mail-Adresse." : "Keine Adresse gefunden."}
              />
            )}
            {shown.slice(0, 300).map((r) => (
              <TableRow key={r.email}>
                <TableCell className="max-sm:whitespace-normal">
                  <div className="break-all font-medium">{r.email}</div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                    <span className="sm:hidden">{fmtDay(r.lastDay)}</span>
                    {r.inApp && <Badge variant="success">App eingerichtet</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.tickets}</TableCell>
                <TableCell className="text-right tabular-nums max-sm:hidden">{fmtDay(r.lastDay)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`${r.email} ändern`}
                    className="max-sm:size-11"
                    onClick={() => { setEditError(null); setEdit({ from: r.email, to: r.email }); }}
                  >
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {shown.length > 300 && (
          <p className="px-4 py-3 text-xs text-muted-foreground sm:px-5">Es werden 300 von {shown.length} Adressen gezeigt. Über die Suche findest du die übrigen.</p>
        )}
      </Card>

      <Dialog open={edit != null} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adresse ändern</DialogTitle>
            <DialogDescription>
              Gilt für alle Tagestickets dieser Saison mit dieser Adresse. Ohne Adresse kommt der Gast nicht mehr neu in die App.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); void change(edit.to.trim() || null); }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="day-guest-edit">E-Mail</Label>
                <Input id="day-guest-edit" type="email" value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })} autoComplete="off" maxLength={180} className="max-sm:h-11" />
              </div>
              {editError && <Notice tone="danger" compact title={editError} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" disabled={editBusy} className="max-sm:h-11" onClick={() => void change(null)}>
                  Adresse entfernen
                </Button>
                <Button type="submit" disabled={editBusy || edit.to.trim().toLowerCase() === edit.from} className="max-sm:h-11">
                  {editBusy ? <Loader2 className="animate-spin" /> : "Speichern"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
