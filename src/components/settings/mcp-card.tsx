"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Check, Copy, Info, Loader2, Plus, Trash2, ShieldAlert } from "lucide-react";

type Level = "read" | "operate" | "access";

export interface McpTokenRow {
  id: number;
  name: string;
  hint: string;
  level: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const LEVEL_LABEL: Record<string, string> = {
  read: "Nur lesen",
  operate: "Raumgeräte schalten",
  access: "Auch Türen und Tore",
};

const LEVEL_HELP: Record<Level, string> = {
  read: "Lage, Tickets, Zutritte, Räume, Kameras, Belegung, Vorwarnungen – schaltet nichts.",
  operate: "Zusätzlich Licht, Markisen, Steckdosen, Audio, Bewässerung, Mäher und Kameralicht.",
  access: "Zusätzlich Türen, Tore, Schlösser, Drehkreuze und Sirene. Nur für Clients, denen du voll vertraust.",
};

function fmt(iso: string | null): string {
  if (!iso) return "noch nie";
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <code className="glass-field min-w-0 flex-1 truncate px-2 py-1.5 font-mono text-xs">{value}</code>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 max-sm:size-11"
          onClick={onCopy}
          aria-label={`${label} kopieren`}
          title="Kopieren"
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function McpCard({
  endpoint,
  initialTokens,
  allowedLevels,
}: {
  endpoint: string;
  initialTokens: McpTokenRow[];
  /** Welche Stufen angeboten werden. */
  allowedLevels: Level[];
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<Level>("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<McpTokenRow | null>(null);

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), level }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Anlegen fehlgeschlagen");
        return;
      }
      const { token, ...row } = data as McpTokenRow & { token: string };
      setTokens((t) => [row, ...t]);
      setCreated({ name: row.name, token });
      setName("");
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  async function doRevoke(row: McpTokenRow) {
    const res = await fetch(`/api/settings/mcp-tokens/${row.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Widerrufen fehlgeschlagen");
    setTokens((t) => t.filter((x) => x.id !== row.id));
  }

  const urlWithToken = created ? `${endpoint}?token=${created.token}` : "";
  const claudeCode = created
    ? `claude mcp add --transport http emp-access ${endpoint} --header "Authorization: Bearer ${created.token}"`
    : "";

  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Über die MCP-Schnittstelle (Model Context Protocol) können KI-Assistenten wie Claude EMP-Access
          abfragen und – je nach Stufe – Geräte schalten. Netzwerkänderungen sind nie möglich. Jedes
          schaltende Kommando wird in Telegram gemeldet.
        </p>

        <CopyRow label="Server-URL" value={endpoint} copied={copied === "endpoint"} onCopy={() => copy(endpoint, "endpoint")} />

        {created && (
          <div className="glass-tile space-y-3 p-3">
            <Notice tone="warning" compact icon={ShieldAlert} title={`Token „${created.name}“ – nur jetzt sichtbar`}>
              Kopiere es jetzt. Danach ist nur noch das Ende zu sehen.
            </Notice>
            <CopyRow label="Token" value={created.token} copied={copied === "token"} onCopy={() => copy(created.token, "token")} />
            <CopyRow label="Claude Code" value={claudeCode} copied={copied === "cc"} onCopy={() => copy(claudeCode, "cc")} />
            <CopyRow label="Claude App (Connector-URL mit Token)" value={urlWithToken} copied={copied === "url"} onCopy={() => copy(urlWithToken, "url")} />
            <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => setCreated(null)}>
              Fertig
            </Button>
          </div>
        )}

        <div className="glass-tile space-y-3 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-token-name">Neues Token</Label>
            <Input
              id="mcp-token-name"
              className="max-sm:h-11"
              placeholder="z. B. Claude Aaron"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          {allowedLevels.length > 1 && (
            <div className="space-y-1.5">
              <Segmented
                aria-label="Stufe"
                value={level}
                onValueChange={setLevel}
                options={allowedLevels.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
                size="sm"
                stretch
              />
              <p className="text-xs text-muted-foreground">{LEVEL_HELP[level]}</p>
            </div>
          )}
          <Button size="sm" className="max-sm:h-11" disabled={busy || !name.trim()} onClick={() => void create()}>
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
                      <Badge variant="secondary">{LEVEL_LABEL[t.level] ?? t.level}</Badge>
                      <Badge variant="mono">{t.hint}</Badge>
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
            Claude App: Einstellungen → Connectors → „Eigenen Connector hinzufügen“ und die Connector-URL mit
            Token eintragen. Claude Code: den Befehl oben im Terminal ausführen.
          </p>
        </Notice>
      </CardContent>

      <ConfirmDialog
        open={revoke !== null}
        onOpenChange={(o) => !o && setRevoke(null)}
        title={`Token „${revoke?.name ?? ""}“ widerrufen?`}
        description="Der Assistent mit diesem Token verliert sofort den Zugriff."
        confirmLabel="Widerrufen"
        onConfirm={async () => {
          if (revoke) await doRevoke(revoke);
        }}
      />
    </Card>
  );
}
