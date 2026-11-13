"use client";

import { useState, useSyncExternalStore } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { passkeyErrorMessage, passkeySupportSnapshot } from "@/lib/passkey-client";

export interface PasskeyRow {
  id: number;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PasskeyCardProps {
  initialPasskeys: PasskeyRow[];
  suggestedName: string;
}

type Stage = "overview" | "add" | "rename";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Aktion fehlgeschlagen");
  return data as T;
}

export function PasskeyCard({ initialPasskeys, suggestedName }: PasskeyCardProps) {
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [stage, setStage] = useState<Stage>("overview");
  const [name, setName] = useState(suggestedName);
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState<PasskeyRow | null>(null);
  const [toDelete, setToDelete] = useState<PasskeyRow | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Erst nach dem Laden im Browser bekannt; vorher nichts sperren (gleiches HTML wie vom Server).
  const supported = useSyncExternalStore(...passkeySupportSnapshot(browserSupportsWebAuthn, true));


  function backToOverview() {
    setStage("overview");
    setEditing(null);
    setPassword("");
    setError("");
  }

  async function add() {
    setBusy(true);
    setError("");
    try {
      const optionsJSON = await request<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
        "/api/account/passkeys/options",
        "POST",
        { password },
      );
      setPassword("");
      const response = await startRegistration({ optionsJSON });
      const data = await request<{ passkey: PasskeyRow }>("/api/account/passkeys", "POST", { name, response });
      setPasskeys((list) => [...list, data.passkey]);
      backToOverview();
    } catch (e) {
      const message = passkeyErrorMessage(e);
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const data = await request<{ name: string }>(`/api/account/passkeys/${editing.id}`, "PATCH", { name });
      setPasskeys((list) => list.map((p) => (p.id === editing.id ? { ...p, name: data.name } : p)));
      backToOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aktion fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function remove(passkey: PasskeyRow) {
    await request(`/api/account/passkeys/${passkey.id}`, "DELETE");
    setPasskeys((list) => list.filter((p) => p.id !== passkey.id));
    setToDelete(null);
  }

  const active = passkeys.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3 min-w-0">
          <IconChip icon={Fingerprint} tone={active ? "success" : "neutral"} size="lg" />
          <div className="min-w-0 space-y-1">
            <CardTitle>
              <h3>Passkeys</h3>
            </CardTitle>
            <CardDescription>
              Anmelden ohne Passwort mit Face ID, Fingerabdruck oder Geräte-PIN. Ersetzt Passwort und Code.
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <Badge variant={active ? "success" : "neutral"}>{active ? `${passkeys.length} aktiv` : "Keine"}</Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Notice tone="danger" compact title={error} />}

        {stage === "overview" && (
          <>
            {!supported && (
              <Notice tone="warning" compact>
                Dieser Browser unterstützt keine Passkeys. Bitte einen aktuellen Browser (Safari, Chrome, Edge,
                Firefox) verwenden.
              </Notice>
            )}

            {passkeys.length === 0 ? (
              <EmptyState
                compact
                icon={Fingerprint}
                title="Noch kein Passkey eingerichtet."
                description="Mit einem Passkey meldest du dich auf diesem Gerät per Face ID oder Fingerabdruck an."
              />
            ) : (
              <ul className="space-y-2">
                {passkeys.map((p) => (
                  <li key={p.id} className="glass-tile flex items-center gap-3 px-3 py-2.5 min-h-11">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{p.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        Angelegt {formatDate(p.createdAt)}
                        {" · "}
                        {p.lastUsedAt ? `zuletzt ${formatDate(p.lastUsedAt)}` : "noch nicht benutzt"}
                        {p.deviceType === "multiDevice" ? " · synchronisiert" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        aria-label={`„${p.name}“ umbenennen`}
                        onClick={() => {
                          setError("");
                          setEditing(p);
                          setName(p.name);
                          setStage("rename");
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9 text-destructive hover:text-destructive"
                        aria-label={`„${p.name}“ löschen`}
                        onClick={() => setToDelete(p)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <Button
              onClick={() => {
                setError("");
                setName(suggestedName);
                setPassword("");
                setStage("add");
              }}
              disabled={!supported}
              className="max-sm:h-11 max-sm:w-full"
            >
              <Plus className="h-4 w-4" />
              Passkey hinzufügen
            </Button>
          </>
        )}

        {stage === "add" && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Nach „Weiter“ fragt dein Gerät nach Face ID, Fingerabdruck oder PIN. Der Passkey liegt danach im
              Schlüsselbund bzw. Passwortmanager und funktioniert nur für diese Adresse.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pk-name">Name</Label>
                <Input
                  id="pk-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder="z. B. iPhone"
                  required
                  className="max-sm:h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pk-password">Zur Bestätigung: Passwort</Label>
                <Input
                  id="pk-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  autoFocus
                  className="max-sm:h-11"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={backToOverview} disabled={busy} className="max-sm:h-11">
                Abbrechen
              </Button>
              <Button type="submit" disabled={busy} className="max-sm:h-11">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Weiter
              </Button>
            </div>
          </form>
        )}

        {stage === "rename" && editing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <div className="space-y-2 sm:max-w-sm">
              <Label htmlFor="pk-rename">Name</Label>
              <Input
                id="pk-rename"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
                autoFocus
                className="max-sm:h-11"
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={backToOverview} disabled={busy} className="max-sm:h-11">
                Abbrechen
              </Button>
              <Button type="submit" disabled={busy} className="max-sm:h-11">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Speichern
              </Button>
            </div>
          </form>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
        title={`Passkey „${toDelete?.name ?? ""}“ löschen?`}
        description="Mit diesem Passkey kannst du dich danach nicht mehr anmelden. Im Schlüsselbund des Geräts bleibt er stehen und kann dort entfernt werden."
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />
    </Card>
  );
}
