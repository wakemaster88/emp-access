"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Check, Copy, KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";

interface Props {
  deviceId: number;
  hasToken: boolean;
}

/**
 * Geraete-eigenes API-Token. Gilt nur fuer dieses Geraet und nur fuer die
 * Geraete-Endpunkte; ein abhanden gekommener Pi gibt damit nicht mehr die
 * ganze Account-API preis. Nach dem Erzeugen zeigt der Konfigurations-QR
 * bzw. das Konfigurations-JSON dieses Token statt des Account-Tokens.
 */
export function DeviceTokenCard({ deviceId, hasToken }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rückfrage vor „Neu erzeugen“ und „Zurückziehen“ (docs/design-regeln.md, Abschnitt 18):
  // beide machen das bisherige Token ungültig. Die Wahl bleibt gesetzt, solange der Dialog ausblendet.
  const [confirmAction, setConfirmAction] = useState<"generate" | "revoke" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function ask(action: "generate" | "revoke") {
    setConfirmAction(action);
    setConfirmOpen(true);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/token`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Token konnte nicht erzeugt werden");
      setFreshToken(data.apiToken);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/token`, { method: "DELETE" });
      if (!res.ok) throw new Error("Token konnte nicht zurückgezogen werden");
      setFreshToken(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h3>Geräte-Token</h3>
        </CardTitle>
        {hasToken ? (
          <Badge variant="success" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> eigenes Token
          </Badge>
        ) : (
          <Badge variant="warning" className="gap-1">
            <ShieldOff className="h-3 w-3" /> nutzt Account-Token
          </Badge>
        )}
        <CardAction className="flex flex-wrap justify-end gap-2">
          {/* Ohne eigenes Token geht nichts verloren: dann ohne Rückfrage erzeugen. */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (hasToken) ask("generate");
              else void generate();
            }}
            disabled={busy}
            className="max-sm:h-11"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : hasToken ? "Neu erzeugen" : "Token erzeugen"}
          </Button>
          {hasToken && (
            <Button size="sm" variant="ghost" onClick={() => ask("revoke")} disabled={busy} className="max-sm:h-11">
              Zurückziehen
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Ein eigenes Token gilt nur für dieses Gerät und nur für die Geräte-Schnittstelle.
          Geht der Pi verloren, wird nur dieses Token ersetzt – nicht das Account-Token aller Geräte.
          Nach dem Erzeugen enthält der Konfigurations-QR dieses Token.
        </p>
        {freshToken && (
          <Notice
            tone="success"
            compact
            title="Neues Token – wird nur jetzt angezeigt:"
            action={
              <Button size="sm" variant="outline" onClick={copyToken} aria-label="Token kopieren" className="max-sm:h-11">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            }
          >
            <code className="text-xs break-all text-foreground/90">{freshToken}</code>
          </Notice>
        )}
        {error && <Notice tone="danger" compact title={error} />}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmAction === "revoke" ? "Geräte-Token zurückziehen?" : "Neues Token erzeugen?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmAction === "revoke"
                  ? "Das Gerät nutzt dann wieder das Account-Token."
                  : "Das bisherige Token verliert sofort seine Gültigkeit – das Gerät muss neu konfiguriert werden (QR erneut scannen)."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (confirmAction === "generate") void generate();
                  else if (confirmAction === "revoke") void revoke();
                }}
              >
                {confirmAction === "revoke" ? "Zurückziehen" : "Neu erzeugen"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
