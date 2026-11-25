"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { ToggleChip, ToggleChipGroup } from "@/components/ui/toggle-chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Check, Copy, Info, Loader2, Plus, Trash2, ShieldAlert } from "lucide-react";
import {
  INTEGRATION_SCOPES,
  INTEGRATION_SCOPE_IDS,
  INTEGRATION_SCOPE_LABEL,
  isIntegrationScope,
  type IntegrationScope,
} from "@/lib/integration-scopes";

export interface IntegrationTokenRow {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

function fmt(iso: string | null): string {
  if (!iso) return "noch nie";
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function scopeLabel(s: string): string {
  return isIntegrationScope(s) ? INTEGRATION_SCOPE_LABEL[s] : s;
}

/** Kurzbeschreibung je Scope: die erlaubten Aufrufe. */
function scopeHelp(s: IntegrationScope): string {
  return INTEGRATION_SCOPES[s].map((g) => `${g.method} ${g.route}`).join(", ");
}

export function IntegrationTokensCard({ initialTokens }: { initialTokens: IntegrationTokenRow[] }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<IntegrationScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [revoke, setRevoke] = useState<IntegrationTokenRow | null>(null);

  const toggleScope = (s: IntegrationScope, on: boolean) =>
    setScopes((cur) => (on ? [...cur.filter((x) => x !== s), s] : cur.filter((x) => x !== s)));

  // Haken nur, wenn der Browser das Kopieren bestätigt; sonst Hinweis zum
  // Markieren von Hand (das Token ist nur jetzt sichtbar).
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/integration-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Anlegen fehlgeschlagen");
        return;
      }
      const { token, ...row } = data as IntegrationTokenRow & { token: string };
      setTokens((t) => [row, ...t]);
      setCreated({ name: row.name, token });
      setCopied(false);
      setCopyFailed(false);
      setName("");
      setScopes([]);
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  async function doRevoke(row: IntegrationTokenRow) {
    const res = await fetch(`/api/settings/integration-tokens/${row.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Widerrufen fehlgeschlagen");
    setTokens((t) => t.filter((x) => x.id !== row.id));
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Eigene Tokens für angebundene Systeme. Jedes Token darf nur die gewählten Aufrufe, gilt nur im
          Header „Authorization: Bearer …“ und lässt sich einzeln widerrufen. Das API-Token oben bleibt
          davon unberührt.
        </p>

        {created && (
          <div className="glass-tile space-y-3 p-3">
            <Notice tone="warning" compact icon={ShieldAlert} title={`Token „${created.name}“ – nur jetzt sichtbar`}>
              Kopiere es jetzt. Danach ist nur noch der Anfang zu sehen.
            </Notice>
            <div className="flex items-center gap-1">
              <code className="glass-field min-w-0 flex-1 break-all select-all px-2 py-1.5 font-mono text-xs">
                {created.token}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 max-sm:size-11"
                onClick={() => void copy(created.token)}
                aria-label="Token kopieren"
                title="Kopieren"
              >
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            {copyFailed && (
              <Notice tone="danger" compact title="Kopieren nicht möglich – bitte das Token oben markieren und kopieren." />
            )}
            <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => setCreated(null)}>
              Fertig
            </Button>
          </div>
        )}

        <div className="glass-tile space-y-3 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="integration-token-name">Neues Token</Label>
            <Input
              id="integration-token-name"
              className="max-sm:h-11"
              placeholder="z. B. Website Auslastung"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Erlaubt</p>
            <ToggleChipGroup aria-label="Erlaubte Aufrufe" className="flex flex-wrap gap-2">
              {INTEGRATION_SCOPE_IDS.map((s) => (
                <ToggleChip
                  key={s}
                  size="sm"
                  className="max-sm:h-11"
                  pressed={scopes.includes(s)}
                  onPressedChange={(on) => toggleScope(s, on)}
                  title={scopeHelp(s)}
                >
                  {INTEGRATION_SCOPE_LABEL[s]}
                </ToggleChip>
              ))}
            </ToggleChipGroup>
            {scopes.length > 0 && (
              <p className="wrap-anywhere text-xs text-muted-foreground">
                {scopes.map(scopeHelp).join(" · ")}
              </p>
            )}
          </div>
          <Button
            size="sm"
            className="max-sm:h-11"
            disabled={busy || !name.trim() || scopes.length === 0}
            onClick={() => void create()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Token anlegen
          </Button>
          {error && <Notice tone="danger" compact title={error} />}
        </div>

        <div className="space-y-2">
          <p className="text-label">Aktive Tokens</p>
          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch kein Token angelegt.</p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((t) => (
                <li key={t.id} className="glass-tile flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                      <Badge variant="mono">{t.prefix}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s} variant="secondary">
                          {scopeLabel(s)}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Zuletzt genutzt: {fmt(t.lastUsedAt)} · angelegt {fmt(t.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 max-sm:size-11"
                    onClick={() => setRevoke(t)}
                    aria-label={`Token ${t.name} widerrufen`}
                    title="Widerrufen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Notice tone="info" compact icon={Info}>
          <p className="wrap-anywhere">
            Ein Token mit „… lesen“ darf nur lesen. „Fundsachen“ darf Fundsachen und Verlustmeldungen
            suchen, anlegen, ändern und löschen – wie die Fundsachen-API mit dem API-Token.
          </p>
        </Notice>
      </CardContent>

      <ConfirmDialog
        open={revoke !== null}
        onOpenChange={(o) => !o && setRevoke(null)}
        title={`Token „${revoke?.name ?? ""}“ widerrufen?`}
        description="Das System mit diesem Token verliert sofort den Zugriff."
        confirmLabel="Widerrufen"
        onConfirm={async () => {
          if (revoke) await doRevoke(revoke);
        }}
      />
    </Card>
  );
}
