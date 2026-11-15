"use client";

import { useMemo, useState } from "react";
import { Check, Copy, KeyRound, Loader2, QrCode, Search } from "lucide-react";
import { useOrigin } from "@/hooks/use-origin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface RiderRow {
  ticketId: number;
  name: string;
  subscription: string;
  visitDays: number;
  starts: number;
  /** Fahrer hat die App schon geöffnet. */
  appUsed: boolean;
  optOut: boolean;
  /** Ohne Kartennummer und Geburtsdatum klappt die Selbst-Anmeldung nicht. */
  canSelfLogin: boolean;
}

/** Abo-Fahrer mit Saisonstand; je Fahrer lässt sich der persönliche App-Link zeigen. */
export function RidersCard({ riders, year }: { riders: RiderRow[]; year: number }) {
  const origin = useOrigin();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ ticketId: number; name: string; url: string; qr: string; reset: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copied, setCopied] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? riders.filter((r) => r.name.toLowerCase().includes(q)) : riders;
  }, [riders, query]);

  async function loadLink(ticketId: number, name: string, action: "link" | "reset") {
    const res = await fetch(`/api/gamification/riders/${ticketId}/${action}`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
    if (!res.ok || !data.path) throw new Error(data.error ?? "Link konnte nicht erzeugt werden");
    const url = `${origin || window.location.origin}${data.path}`;
    const qrcode = (await import("qrcode")).default;
    const qr = await qrcode.toDataURL(url, { width: 480, margin: 2 });
    setCopied(false);
    setConfirmReset(false);
      setLink({ ticketId, name, url, qr, reset: action === "reset" });
  }

  async function showLink(r: RiderRow) {
    if (busy != null) return;
    setBusy(r.ticketId);
    setError(null);
    try {
      await loadLink(r.ticketId, r.name, "link");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link konnte nicht erzeugt werden");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!link || resetting) return;
    setResetting(true);
    setError(null);
    try {
      await loadLink(link.ticketId, link.name, "reset");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zurücksetzen fehlgeschlagen");
    } finally {
      setResetting(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle>Fahrer</CardTitle>
          <CardDescription>
            Abo-Fahrer der Saison {year}. Der App-Link ist persönlich: als QR-Code zeigen oder weitergeben.
          </CardDescription>
        </CardHeader>
        <div className="px-4 pb-3 sm:px-5">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name suchen"
              aria-label="Fahrer suchen"
              className="pl-9"
            />
          </div>
          {error && <Notice tone="danger" compact title={error} className="mt-3" />}
        </div>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Fahrer</TableHead>
              <TableHead className="max-sm:hidden">Abo</TableHead>
              <TableHead className="text-right">Tage</TableHead>
              <TableHead className="text-right max-sm:hidden">Starts</TableHead>
              <TableHead className="text-right">App</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableEmpty
                colSpan={5}
                title={riders.length === 0 ? "Keine Tickets mit einem teilnehmenden Abo." : "Kein Fahrer mit diesem Namen."}
              />
            )}
            {shown.map((r) => (
              <TableRow key={r.ticketId}>
                <TableCell className="max-sm:whitespace-normal">
                  <div className="font-medium">{r.name}</div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                    <span className="sm:hidden">{r.subscription}</span>
                    {r.optOut && <Badge variant="neutral">macht nicht mit</Badge>}
                    {!r.optOut && r.appUsed && <Badge variant="success">App aktiv</Badge>}
                    {!r.optOut && !r.canSelfLogin && <Badge variant="warning">nur per Link</Badge>}
                  </div>
                </TableCell>
                <TableCell className="max-sm:hidden">{r.subscription}</TableCell>
                <TableCell className="text-right tabular-nums">{r.visitDays}</TableCell>
                <TableCell className="text-right tabular-nums max-sm:hidden">{r.starts}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-sm:h-11"
                    disabled={busy != null}
                    onClick={() => showLink(r)}
                    aria-label={`App-Link für ${r.name}`}
                  >
                    {busy === r.ticketId ? <Loader2 className="animate-spin" /> : <QrCode />}
                    <span className="max-sm:hidden">App-Link</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={link != null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>App-Link für {link?.name}</DialogTitle>
            <DialogDescription>
              Mit dem Handy scannen. Beim ersten Öffnen richtet der Fahrer Passkey oder Passwort ein, danach öffnet der Link allein die App nicht mehr.
            </DialogDescription>
          </DialogHeader>
          {link && (
            <div className="space-y-3">
              {/* QR-Code bleibt auf Weiß (Ruhezone und Kontrast zum Scannen, auch im Dunkeln). */}
              <div className="mx-auto w-fit rounded-md bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={link.qr} alt="QR-Code zum App-Link" width={240} height={240} className="size-60" />
              </div>
              <div className="break-all rounded-md border bg-muted/40 px-3 py-2 text-xs">{link.url}</div>
              <Button variant="outline" className="w-full max-sm:h-11" onClick={copy}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Kopiert" : "Link kopieren"}
              </Button>
              {link.reset && <Notice tone="success" compact title="Zugang zurückgesetzt. Das ist der neue Link, der alte gilt nicht mehr." />}
              {confirmReset ? (
                <Notice
                  tone="danger"
                  compact
                  title="Passwort und Passkeys löschen und einen neuen Link ausgeben? Statistik und Gutscheine bleiben."
                  action={
                    <Button type="button" variant="destructive" size="sm" onClick={reset} disabled={resetting} className="max-sm:h-11">
                      {resetting ? <Loader2 className="animate-spin" /> : <KeyRound />}
                      Zurücksetzen
                    </Button>
                  }
                />
              ) : (
                <Button variant="ghost" className="w-full text-muted-foreground max-sm:h-11" onClick={() => setConfirmReset(true)}>
                  <KeyRound />
                  Zugang zurücksetzen
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
