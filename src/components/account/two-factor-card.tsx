"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";

interface TwoFactorCardProps {
  email: string;
  initialEnabled: boolean;
  initialRecoveryCodesLeft: number;
  enabledAt: string | null;
}

type Stage = "overview" | "start" | "verify" | "codes" | "disable" | "regenerate";

interface SetupData {
  secret: string;
  secretFormatted: string;
  url: string;
}

export function TwoFactorCard({
  email,
  initialEnabled,
  initialRecoveryCodesLeft,
  enabledAt,
}: TwoFactorCardProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [codesLeft, setCodesLeft] = useState(initialRecoveryCodesLeft);
  const [stage, setStage] = useState<Stage>("overview");
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (stage !== "verify" || !setup || !canvasRef.current) return;
    const canvas = canvasRef.current;
    void import("qrcode").then((m) =>
      m.default.toCanvas(canvas, setup.url, {
        width: 208,
        margin: 1,
        color: { dark: "#0f172a", light: "#ffffff" },
      }),
    );
  }, [stage, setup]);

  function resetInputs() {
    setPassword("");
    setCode("");
    setError("");
  }

  function backToOverview() {
    setStage("overview");
    setSetup(null);
    setRecoveryCodes(null);
    resetInputs();
  }

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/account/two-factor${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Aktion fehlgeschlagen");
    return data;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aktion fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const startSetup = () =>
    run(async () => {
      const data = (await post("/setup", { password })) as SetupData;
      setSetup(data);
      setPassword("");
      setCode("");
      setStage("verify");
    });

  const activate = () =>
    run(async () => {
      const data = (await post("/activate", { code })) as { recoveryCodes: string[] };
      setRecoveryCodes(data.recoveryCodes);
      setCodesLeft(data.recoveryCodes.length);
      setEnabled(true);
      setSetup(null);
      resetInputs();
      setStage("codes");
    });

  const disable = () =>
    run(async () => {
      await post("/disable", { password, code });
      setEnabled(false);
      setCodesLeft(0);
      backToOverview();
    });

  const regenerate = () =>
    run(async () => {
      const data = (await post("/recovery-codes", { password })) as { recoveryCodes: string[] };
      setRecoveryCodes(data.recoveryCodes);
      setCodesLeft(data.recoveryCodes.length);
      resetInputs();
      setStage("codes");
    });

  function copyCodes() {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadCodes() {
    if (!recoveryCodes) return;
    const content = [
      "EMP Access – Wiederherstellungscodes",
      `Konto: ${email}`,
      `Erstellt: ${new Date().toLocaleString("de-DE")}`,
      "",
      "Jeder Code funktioniert genau einmal. Sicher aufbewahren.",
      "",
      ...recoveryCodes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "emp-access-wiederherstellungscodes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="p-5 md:p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={
                enabled
                  ? "h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0"
                  : "h-10 w-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0"
              }
            >
              {enabled ? (
                <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <ShieldOff className="h-5 w-5 text-slate-500" />
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Zwei-Faktor-Authentifizierung
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Zusätzlich zum Passwort ein Einmalcode aus einer Authenticator-App.
              </p>
            </div>
          </div>
          <Badge
            className={
              enabled
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 shrink-0"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 shrink-0"
            }
          >
            {enabled ? "Aktiv" : "Inaktiv"}
          </Badge>
        </div>

        {error && (
          <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        {stage === "overview" && (
          <div className="space-y-4">
            {enabled ? (
              <>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-slate-600 dark:text-slate-300 space-y-1">
                  {enabledAt && (
                    <p>
                      Eingerichtet am{" "}
                      {new Date(enabledAt).toLocaleString("de-DE", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                  <p className={codesLeft <= 2 ? "text-amber-600 dark:text-amber-400 font-medium" : undefined}>
                    {codesLeft} Wiederherstellungscode{codesLeft === 1 ? "" : "s"} übrig
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => { resetInputs(); setStage("regenerate"); }}>
                    <KeyRound className="h-4 w-4 mr-1.5" />
                    Neue Wiederherstellungscodes
                  </Button>
                  <Button
                    variant="outline"
                    className="text-rose-600 hover:text-rose-700 border-rose-200 dark:border-rose-900"
                    onClick={() => { resetInputs(); setStage("disable"); }}
                  >
                    <ShieldOff className="h-4 w-4 mr-1.5" />
                    Deaktivieren
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Ohne zweiten Faktor genügt ein erratenes oder abgegriffenes Passwort, um an alle Tickets,
                    Geräte und Kameras zu kommen.
                  </p>
                </div>
                <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => { resetInputs(); setStage("start"); }}>
                  <Smartphone className="h-4 w-4 mr-1.5" />
                  Einrichten
                </Button>
              </>
            )}
          </div>
        )}

        {stage === "start" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              startSetup();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="tf-password">Zur Bestätigung: aktuelles Passwort</Label>
              <Input
                id="tf-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Weiter
              </Button>
              <Button type="button" variant="ghost" onClick={backToOverview} disabled={busy}>
                Abbrechen
              </Button>
            </div>
          </form>
        )}

        {stage === "verify" && setup && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              activate();
            }}
          >
            <p className="text-sm text-slate-600 dark:text-slate-300">
              QR-Code in der Authenticator-App scannen (Google Authenticator, Microsoft Authenticator, 1Password,
              Aegis …) und anschließend den angezeigten Code eintragen.
            </p>
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <div className="bg-white p-3 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
                <canvas ref={canvasRef} className="rounded" />
              </div>
              <div className="space-y-2 min-w-0">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                  Oder manuell eintragen
                </p>
                <code className="block font-mono text-sm bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-lg break-all select-all">
                  {setup.secretFormatted}
                </code>
                <p className="text-xs text-slate-400">
                  Zeitbasiert, 6 Stellen, 30 Sekunden. Konto: {email}
                </p>
              </div>
            </div>
            <div className="space-y-2 max-w-[220px]">
              <Label htmlFor="tf-code">Code aus der App</Label>
              <Input
                id="tf-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="text-center text-lg tracking-[0.3em] font-mono"
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Aktivieren
              </Button>
              <Button type="button" variant="ghost" onClick={backToOverview} disabled={busy}>
                Abbrechen
              </Button>
            </div>
          </form>
        )}

        {stage === "codes" && recoveryCodes && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Diese Codes werden nur jetzt angezeigt. Jeder funktioniert genau einmal und ersetzt bei
                verlorenem Handy den Code aus der App. Bitte ausdrucken oder in den Passwortmanager legen.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {recoveryCodes.map((c) => (
                <code
                  key={c}
                  className="font-mono text-sm text-center bg-slate-100 dark:bg-slate-800 px-2 py-1.5 rounded select-all"
                >
                  {c}
                </code>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copyCodes}>
                {copied ? <Check className="h-4 w-4 mr-1.5 text-emerald-600" /> : <Copy className="h-4 w-4 mr-1.5" />}
                {copied ? "Kopiert" : "Kopieren"}
              </Button>
              <Button variant="outline" onClick={downloadCodes}>
                <Download className="h-4 w-4 mr-1.5" />
                Herunterladen
              </Button>
              <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={backToOverview}>
                Fertig
              </Button>
            </div>
          </div>
        )}

        {stage === "disable" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              disable();
            }}
          >
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Zum Abschalten Passwort und einen gültigen Code eingeben.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tf-disable-password">Passwort</Label>
                <Input
                  id="tf-disable-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tf-disable-code">Code oder Wiederherstellungscode</Label>
                <Input
                  id="tf-disable-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  placeholder="123456"
                  required
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Zwei-Faktor deaktivieren
              </Button>
              <Button type="button" variant="ghost" onClick={backToOverview} disabled={busy}>
                Abbrechen
              </Button>
            </div>
          </form>
        )}

        {stage === "regenerate" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              regenerate();
            }}
          >
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Neue Codes erzeugen – die bisherigen verlieren sofort ihre Gültigkeit.
            </p>
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="tf-regen-password">Passwort</Label>
              <Input
                id="tf-regen-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Codes erzeugen
              </Button>
              <Button type="button" variant="ghost" onClick={backToOverview} disabled={busy}>
                Abbrechen
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
