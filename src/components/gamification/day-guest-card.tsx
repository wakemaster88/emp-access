"use client";

import { useState } from "react";
import { Check, Copy, Loader2, QrCode } from "lucide-react";
import { useOrigin } from "@/hooks/use-origin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";

/** Kasse: zu einem Tagesticket den QR-Code zeigen, mit dem der Gast in die App kommt. */
export function DayGuestCard() {
  const origin = useOrigin();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; qr: string; claimed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function show(e: React.FormEvent) {
    e.preventDefault();
    if (busy || code.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/gamification/riders/day-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => ({}))) as { path?: string; claimed?: boolean; error?: string };
      if (!res.ok || !data.path) throw new Error(data.error ?? "Link konnte nicht erzeugt werden");
      const url = `${origin || window.location.origin}${data.path}`;
      const qrcode = (await import("qrcode")).default;
      const qr = await qrcode.toDataURL(url, { width: 480, margin: 2 });
      setCopied(false);
      setLink({ url, qr, claimed: data.claimed === true });
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link konnte nicht erzeugt werden");
    } finally {
      setBusy(false);
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
      <Card>
        <CardHeader>
          <CardTitle>Tagesgast in die App holen</CardTitle>
          <CardDescription>
            Ticket, Armband oder Karte scannen oder den Code eintippen. Der Gast scannt danach den QR-Code mit dem Handy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={show} className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-sm">
              <Label htmlFor="day-guest-code">Ticket-Code</Label>
              <Input id="day-guest-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className="max-sm:h-11" />
            </div>
            <Button type="submit" disabled={busy || code.trim().length < 3} className="gap-1.5 max-sm:h-11 max-sm:w-full">
              {busy ? <Loader2 className="animate-spin" /> : <QrCode />}
              QR-Code zeigen
            </Button>
          </form>
          {error && <Notice tone="danger" compact title={error} className="mt-3" />}
        </CardContent>
      </Card>

      <Dialog open={link != null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>App-Link zum Tagesticket</DialogTitle>
            <DialogDescription>
              Mit dem Handy scannen. Wer die App schon nutzt, sammelt den Besuch in seinem Profil, alle anderen richten Passkey oder Passwort ein.
            </DialogDescription>
          </DialogHeader>
          {link && (
            <div className="space-y-3">
              {/* QR-Code bleibt auf Weiß (Ruhezone und Kontrast zum Scannen, auch im Dunkeln). */}
              <div className="mx-auto w-fit rounded-md bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={link.qr} alt="QR-Code zum App-Link" width={240} height={240} className="size-60" />
              </div>
              {link.claimed && <Notice tone="info" compact title="Dieses Ticket ist schon in der App angemeldet. Der Link führt zur Anmeldung." />}
              <div className="break-all rounded-md border bg-muted/40 px-3 py-2 text-xs">{link.url}</div>
              <Button variant="outline" className="w-full max-sm:h-11" onClick={copy}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Kopiert" : "Link kopieren"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
