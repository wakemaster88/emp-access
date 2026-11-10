"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusDot } from "@/components/ui/status-dot";
import { Check, Copy, ExternalLink, Info } from "lucide-react";

/** Ein Geraet, das sich selbst von GitHub aktualisiert (Pi oder Hub). */
export interface RepoAccessEntry {
  key: string;
  name: string;
  kind: "Hub" | "Pi";
  /** "ssh" = per Deploy-Key angebunden, "https" = noch anonym, null = Geraet meldet nichts (alter Stand). */
  mode: "ssh" | "https" | null;
  publicKey: string | null;
}

const DEPLOY_KEYS_URL = "https://github.com/wakemaster88/emp-access/settings/keys/new";

function CopyKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} className="gap-1.5 text-xs shrink-0 max-sm:h-11">
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Kopiert" : "Schlüssel kopieren"}
    </Button>
  );
}

/**
 * Deploy-Keys der Geraete fuer ein privates GitHub-Repository: Jeder Pi und
 * jeder Hub erzeugt seinen eigenen Lese-Schluessel und meldet ihn hier. Ist
 * er bei GitHub eingetragen, stellt das Geraet von selbst auf SSH um.
 */
export function RepoAccessCard({ entries }: { entries: RepoAccessEntry[] }) {
  const open = entries.filter((e) => e.mode !== "ssh");
  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Hub und Raspberry Pis holen sich ihre Updates selbst von GitHub. Für ein privates Repository
          braucht jedes Gerät einen eigenen Lese-Schlüssel. Schlüssel kopieren und bei GitHub unter{" "}
          <span className="text-foreground">Settings → Deploy keys → Add deploy key</span> eintragen,
          Schreibzugriff nicht erlauben. Das Gerät stellt danach innerhalb von 5 Minuten selbst um.
        </p>
        <Button asChild variant="outline" size="sm" className="gap-1.5 max-sm:h-11">
          <a href={DEPLOY_KEYS_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" /> Deploy-Key bei GitHub eintragen
          </a>
        </Button>

        {entries.length === 0 ? (
          <Notice tone="info" compact icon={Info}>
            Noch kein Gerät hat einen Schlüssel gemeldet.
          </Notice>
        ) : (
          <ul className="divide-y divide-border/60">
            {entries.map((e) => (
              <li key={e.key} className="py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{e.name}</span>
                  <Badge variant="secondary" className="text-xs">{e.kind}</Badge>
                  <span className="ml-auto">
                    {e.mode === "ssh" ? (
                      <Badge variant="success" className="gap-1 text-xs">
                        <StatusDot tone="success" size="xs" /> per Schlüssel angebunden
                      </Badge>
                    ) : e.mode === "https" ? (
                      <Badge variant="warning" className="text-xs">Schlüssel noch nicht eingetragen</Badge>
                    ) : (
                      <Badge variant="neutral" className="text-xs">meldet noch keinen Schlüssel</Badge>
                    )}
                  </span>
                </div>
                {e.publicKey && e.mode !== "ssh" && (
                  <div className="flex flex-wrap items-start gap-2">
                    <code className="glass-tile flex-1 min-w-0 p-2 font-mono text-xs break-all select-all">
                      {e.publicKey}
                    </code>
                    <CopyKey value={e.publicKey} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {entries.length > 0 && open.length === 0 && (
          <Notice tone="success" compact icon={Check}>
            Alle Geräte sind per Schlüssel angebunden. Das Repository kann privat gestellt werden.
          </Notice>
        )}
      </CardContent>
    </Card>
  );
}
