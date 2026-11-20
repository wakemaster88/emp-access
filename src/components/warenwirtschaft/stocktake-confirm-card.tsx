"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { CheckCircle2, Fingerprint, Loader2, PenLine, ShieldCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { passkeyErrorMessage } from "@/lib/passkey-client";
import { METHOD_LABEL, ROLE_LABEL, STOCKTAKE_ROLES, shortHash, type StocktakeRole } from "@/lib/stocktake-log";

export interface SignatureView {
  role: StocktakeRole;
  adminId: number | null;
  name: string;
  method: string;
  signedAt: string;
  contentHash: string;
}

const ROLE_HINT: Record<StocktakeRole, string> = {
  COUNTER: "hat gezählt",
  WRITER: "hat aufgeschrieben und geprüft",
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Bestätigen hat nicht geklappt");
  return data as T;
}

function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("de-DE")}, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
}

/**
 * Digitale Bestätigung einer offenen Inventur durch Zähler und Schreiber
 * (statt Unterschrift). Jede Person bestätigt mit ihrem eigenen Login per
 * Passkey, ohne Passkey mit dem Passwort. Ändert sich danach eine Menge,
 * hebt der Server die Bestätigungen auf.
 */
export function StocktakeConfirmCard({
  stocktakeId,
  signatures,
  currentAdminId,
  pendingSaves,
}: {
  stocktakeId: number;
  signatures: SignatureView[];
  currentAdminId: number | null;
  /** Laufende Speichervorgänge der Liste: erst danach bestätigen. */
  pendingSaves: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<StocktakeRole | null>(null);
  const [passwordFor, setPasswordFor] = useState<StocktakeRole | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [noPasskey, setNoPasskey] = useState(false);

  const mine = signatures.find((s) => s.adminId != null && s.adminId === currentAdminId);
  const done = signatures.length;

  async function confirm(role: StocktakeRole) {
    setBusy(role);
    setError("");
    try {
      if (passwordFor === role) {
        await post(`/api/warenwirtschaft/stocktakes/${stocktakeId}/sign`, { role, password });
        setPassword("");
        setPasswordFor(null);
      } else {
        const start = await post<{ method: "passkey"; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] } | { method: "password" }>(
          `/api/warenwirtschaft/stocktakes/${stocktakeId}/sign/options`,
          { role },
        );
        if (start.method === "password") {
          // Kein Passkey eingerichtet: Passwort als Ersatz abfragen.
          setNoPasskey(true);
          setPasswordFor(role);
          return;
        }
        const response = await startAuthentication({ optionsJSON: start.options });
        await post(`/api/warenwirtschaft/stocktakes/${stocktakeId}/sign`, { role, response });
      }
      router.refresh();
    } catch (e) {
      const message = passkeyErrorMessage(e);
      if (message) setError(message);
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(role: StocktakeRole) {
    setBusy(role);
    setError("");
    try {
      const res = await fetch(`/api/warenwirtschaft/stocktakes/${stocktakeId}/sign?role=${role}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Zurückziehen hat nicht geklappt");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zurückziehen hat nicht geklappt");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <IconChip icon={ShieldCheck} tone={done === 2 ? "success" : "neutral"} size="lg" />
          <div className="min-w-0 space-y-1">
            <CardTitle>
              <h3>Bestätigung</h3>
            </CardTitle>
            <CardDescription>
              Statt Unterschrift bestätigen Zähler und Schreiber die Zählung mit ihrem eigenen Login. Ändert sich danach eine Menge, muss neu bestätigt werden.
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <Badge variant={done === 2 ? "success" : "neutral"}>{done} von 2</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Notice tone="danger" compact role="alert" title={error} />}
        <ul className="space-y-2">
          {STOCKTAKE_ROLES.map((role) => {
            const sig = signatures.find((s) => s.role === role);
            const canSign = !sig && currentAdminId != null && !mine;
            return (
              <li key={role} className="glass-tile flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {sig ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                  ) : (
                    <PenLine className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {ROLE_LABEL[role]}
                      <span className="font-normal text-muted-foreground"> · {ROLE_HINT[role]}</span>
                    </p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {sig
                        ? `${sig.name} · ${dateTime(sig.signedAt)} · ${METHOD_LABEL[sig.method] ?? sig.method} · Prüfsumme ${shortHash(sig.contentHash)}`
                        : "noch nicht bestätigt"}
                    </p>
                  </div>
                </div>
                {sig && sig.adminId != null && sig.adminId === currentAdminId && (
                  <Button type="button" variant="ghost" onClick={() => withdraw(role)} disabled={busy != null} className="h-11 gap-1.5 text-muted-foreground sm:h-9">
                    {busy === role ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                    Zurückziehen
                  </Button>
                )}
                {canSign && passwordFor !== role && (
                  <Button type="button" onClick={() => confirm(role)} disabled={busy != null || pendingSaves > 0} className="h-11 gap-1.5 sm:h-9">
                    {busy === role ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                    Als {ROLE_LABEL[role]} bestätigen
                  </Button>
                )}
                {canSign && passwordFor === role && (
                  <form
                    className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void confirm(role);
                    }}
                  >
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Dein Passwort"
                      aria-label="Dein Passwort zur Bestätigung"
                      className="h-11 sm:h-9 sm:w-44"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => { setPasswordFor(null); setPassword(""); }} className="h-11 flex-1 sm:h-9">
                        Abbrechen
                      </Button>
                      <Button type="submit" disabled={busy != null || password.length === 0} className="h-11 flex-1 gap-1.5 sm:h-9">
                        {busy === role && <Loader2 className="h-4 w-4 animate-spin" />}
                        Bestätigen
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {mine && done < 2 && (
          <p className="text-xs text-muted-foreground">
            Du hast als {ROLE_LABEL[mine.role]} bestätigt. Die zweite Bestätigung muss eine andere Person mit ihrem eigenen Login geben.
          </p>
        )}
        {noPasskey && (
          <p className="text-xs text-muted-foreground">
            Du hast noch keinen Passkey. Ersatzweise bestätigst du mit deinem Passwort; einrichten kannst du ihn unter{" "}
            <Link href="/sicherheit" className="text-primary underline-offset-2 hover:underline">Sicherheit</Link>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
