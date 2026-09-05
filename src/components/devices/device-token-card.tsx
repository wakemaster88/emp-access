"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  async function generate() {
    if (hasToken && !confirm("Neues Token erzeugen? Das bisherige Token verliert sofort seine Gültigkeit – das Gerät muss neu konfiguriert werden (QR erneut scannen).")) return;
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
    if (!confirm("Geräte-Token zurückziehen? Das Gerät nutzt dann wieder das Account-Token.")) return;
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
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Geräte-Token</h3>
            {hasToken ? (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1">
                <ShieldCheck className="h-3 w-3" /> eigenes Token
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1">
                <ShieldOff className="h-3 w-3" /> nutzt Account-Token
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : hasToken ? "Neu erzeugen" : "Token erzeugen"}
            </Button>
            {hasToken && (
              <Button size="sm" variant="ghost" onClick={revoke} disabled={busy}>
                Zurückziehen
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Ein eigenes Token gilt nur für dieses Gerät und nur für die Geräte-Schnittstelle.
          Geht der Pi verloren, wird nur dieses Token ersetzt – nicht das Account-Token aller Geräte.
          Nach dem Erzeugen enthält der Konfigurations-QR dieses Token.
        </p>
        {freshToken && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-2">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
              Neues Token – wird nur jetzt angezeigt:
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs break-all flex-1 text-slate-800 dark:text-slate-200">{freshToken}</code>
              <Button size="sm" variant="outline" onClick={copyToken}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
