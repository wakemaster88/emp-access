"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { KeyRound, Loader2 } from "lucide-react";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-rules";

interface PasswordCardProps {
  /** Mit aktivem zweiten Faktor verlangt der Wechsel zusätzlich einen Code. */
  twoFactorEnabled: boolean;
}

/**
 * Eigenes Passwort ändern. Danach enden alle Sitzungen des Kontos – auch die
 * eigene –, deshalb meldet die Karte nach dem Speichern ab.
 */
export function PasswordCard({ twoFactorEnabled }: PasswordCardProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Der Prop stammt vom Laden der Seite. Wird 2FA danach auf derselben Seite
  // eingeschaltet, meldet der Server `needsCode` – dann erscheint das Feld.
  const [askedForCode, setAskedForCode] = useState(false);
  const showCode = twoFactorEnabled || askedForCode;

  function close() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setRepeat("");
    setCode("");
    setError("");
  }

  async function submit() {
    if (next.length < PASSWORD_MIN_LENGTH) {
      setError(`Das neue Passwort braucht mindestens ${PASSWORD_MIN_LENGTH} Zeichen`);
      return;
    }
    if (next !== repeat) {
      setError("Die beiden neuen Passwörter stimmen nicht überein");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsCode === true) setAskedForCode(true);
        throw new Error(typeof data.error === "string" ? data.error : "Passwort konnte nicht geändert werden");
      }
      setDone(true);
      // Alle Sitzungen sind jetzt ungültig – sauber abmelden statt auf den
      // Rauswurf bei der nächsten Sitzungsprüfung zu warten.
      window.setTimeout(() => void signOut({ callbackUrl: "/login" }), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passwort konnte nicht geändert werden");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3 min-w-0">
          <IconChip icon={KeyRound} tone="neutral" size="lg" />
          <div className="min-w-0 space-y-1">
            <CardTitle>
              <h3>Passwort</h3>
            </CardTitle>
            <CardDescription>
              Mindestens {PASSWORD_MIN_LENGTH} Zeichen. Nach dem Wechsel werden alle Geräte abgemeldet.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && <Notice tone="danger" compact title={error} />}

        {done ? (
          <Notice tone="success" compact title="Passwort geändert. Du wirst jetzt abgemeldet." />
        ) : !open ? (
          <Button variant="outline" onClick={() => setOpen(true)} className="max-sm:h-11 max-sm:w-full">
            <KeyRound className="h-4 w-4" />
            Passwort ändern
          </Button>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="pw-current">Aktuelles Passwort</Label>
              <Input
                id="pw-current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pw-new">Neues Passwort</Label>
                <Input
                  id="pw-new"
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw-repeat">Neues Passwort wiederholen</Label>
                <Input
                  id="pw-repeat"
                  type="password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  required
                />
              </div>
            </div>
            {showCode && (
              <div className="space-y-2 max-w-sm">
                <Label htmlFor="pw-code">Code oder Wiederherstellungscode</Label>
                {/* Ohne `required`: Ob ein Code nötig ist, entscheidet der Server –
                    2FA kann seit dem Laden der Seite abgeschaltet worden sein. */}
                <Input
                  id="pw-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  placeholder="123456"
                />
              </div>
            )}
            {/* Primärtaste rechts, Abbrechen links davon; auf dem Handy volle Breite, Primärtaste oben
                (docs/design-regeln.md, Abschnitt 16). */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={close} disabled={busy} className="max-sm:h-11">
                Abbrechen
              </Button>
              <Button type="submit" disabled={busy} className="max-sm:h-11">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Passwort speichern
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
