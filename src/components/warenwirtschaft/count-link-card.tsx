"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Copy, Link2, RefreshCw, Share2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

function countUrl(path: string, token: string): string {
  if (typeof window === "undefined") return `${path}${token}`;
  return `${window.location.origin}${path}${token}`;
}

function LinkQr({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    void import("qrcode").then((m) => m.default.toCanvas(canvas, url, { width: 180, margin: 1, color: { dark: "#1e293b", light: "#ffffff" } }));
  }, [url]);
  return <canvas ref={ref} className="size-[180px] shrink-0 rounded-md border border-border bg-white p-1" aria-label="QR-Code zum Zähl-Link" role="img" />;
}

/** Zähl-Link einer Inventur (wird beim Anlegen erzeugt). */
export function StocktakeLinkCard({ stocktakeId, token, expiresAt }: { stocktakeId: number; token: string | null; expiresAt: string | null }) {
  return (
    <CountLinkCard
      token={token}
      expiresAt={expiresAt}
      path="/zaehlen/"
      createUrl={`/api/warenwirtschaft/stocktakes/${stocktakeId}/link`}
      revokeUrl={`/api/warenwirtschaft/stocktakes/${stocktakeId}/link`}
      description="Mitarbeiter scannen den Code oder öffnen den Link und zählen ohne Anmeldung. Sie sehen nur diese Inventur, keine Preise und keinen Soll-Bestand, und können fehlende Artikel und Fotos ergänzen."
      validity="oder bis zum Festschreiben"
    />
  );
}

/**
 * Zähl-Link fürs Handy: QR-Code und Link für Mitarbeiter ohne Login. Lässt
 * sich teilen, erneuern (der alte wird ungültig) oder sperren.
 */
export function CountLinkCard({
  token: initialToken,
  expiresAt: initialExpires,
  path,
  createUrl,
  createBody = {},
  revokeUrl,
  description,
  validity,
  title = "Zählen am Handy",
}: {
  token: string | null;
  expiresAt: string | null;
  path: string;
  createUrl: string;
  createBody?: Record<string, unknown>;
  revokeUrl: string;
  description: string;
  validity?: string;
  title?: string;
}) {
  const [token, setToken] = useState(initialToken);
  const [expiresAt, setExpiresAt] = useState(initialExpires);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const expired = expiresAt != null && new Date(expiresAt) < new Date();
  const url = token ? countUrl(path, token) : "";

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(createUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createBody) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Link konnte nicht erzeugt werden");
      setToken(body.token);
      setExpiresAt(body.expiresAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link konnte nicht erzeugt werden");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const res = await fetch(revokeUrl, { method: "DELETE" });
    if (!res.ok) throw new Error("Sperren fehlgeschlagen");
    setToken(null);
    setExpiresAt(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kopieren nicht möglich. Link bitte manuell markieren.");
    }
  }

  // Am Handy öffnet das den Teilen-Dialog (WhatsApp, Mail …), sonst kopieren.
  function share() {
    if (typeof navigator.share === "function") void navigator.share({ title: "Inventur zählen", url }).catch(() => {});
    else void copy();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Notice tone="danger" compact role="alert" title={error} />}
        {token && !expired ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <LinkQr url={url} />
            <div className="min-w-0 flex-1 space-y-2">
              <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Zähl-Link" className="h-11 font-mono text-xs sm:h-9" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={copy} className="max-sm:h-11">
                  <Copy className="h-4 w-4" />
                  {copied ? "Kopiert" : "Kopieren"}
                </Button>
                <Button type="button" variant="outline" onClick={share} className="max-sm:h-11">
                  <Share2 className="h-4 w-4" />
                  Teilen
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmRenew(true)} disabled={busy} className="max-sm:h-11">
                  <RefreshCw className="h-4 w-4" />
                  Neuer Link
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmRevoke(true)} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive max-sm:h-11">
                  <Ban className="h-4 w-4" />
                  Sperren
                </Button>
              </div>
              {expiresAt && <p className="text-xs text-muted-foreground">Gültig bis {new Date(expiresAt).toLocaleDateString("de-DE")}{validity ? ` ${validity}` : ""}.</p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{expired ? "Der Link ist abgelaufen." : "Es gibt gerade keinen Zähl-Link."}</p>
            <Button type="button" onClick={() => void create().catch(() => {})} disabled={busy} className="max-sm:h-11">
              <Link2 className="h-4 w-4" />
              Link erzeugen
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmRenew}
        onOpenChange={setConfirmRenew}
        title="Neuen Link erzeugen?"
        description="Der bisherige Link funktioniert danach nicht mehr. Bereits gezählte Mengen bleiben erhalten."
        confirmLabel="Neuer Link"
        destructive={false}
        onConfirm={create}
      />
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Zähl-Link sperren?"
        description="Wer den Link hat, kann danach nicht mehr zählen. Bereits gezählte Mengen bleiben erhalten."
        confirmLabel="Sperren"
        onConfirm={revoke}
      />
    </Card>
  );
}
