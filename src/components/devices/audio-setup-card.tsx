"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Volume2, Copy, Check, Terminal, AlertCircle } from "lucide-react";

interface AudioSetupCardProps {
  /** Server-URL, API-Token und Geräte-ID – derselbe Inhalt wie im Scanner-QR. */
  configJson: string;
  /** Zone, die dieser Abspieler bedient; ohne Zone spielt er nichts. */
  zoneName: string | null;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className="gap-1.5 text-xs shrink-0 max-sm:h-11"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Kopiert" : label}
    </Button>
  );
}

export function AudioSetupCard({ configJson, zoneName }: AudioSetupCardProps) {
  const installCmd = [
    "git clone https://github.com/wakemaster88/emp-access.git",
    "cd emp-access/raspberry-pi",
    "sudo bash install-audio.sh",
  ].join("\n");

  // Nachtragen, wenn beim Installieren noch kein JSON zur Hand war.
  const setupCmd = `sudo /opt/emp-audio/venv/bin/python -m emp_audio.setup '${configJson}'`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <h3>
            Abspieler einrichten
          </h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Schritt 1 – Software */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">1</Badge>
            <p className="text-sm font-medium text-foreground/80">Software auf dem Raspberry Pi</p>
          </div>
          <div className="flex items-start gap-2">
            {/* Befehle als Kachel in der Karte; min-w-0 und Umbruch, damit lange Zeilen die Seite nicht verbreitern und auf dem Handy ganz lesbar bleiben.
                Auf dem Handy kein Scrollbereich: die Befehle brechen um (docs/design-regeln.md, Abschnitt 5). */}
            <div className="glass-tile min-w-0 flex-1 p-3 font-mono text-xs text-foreground max-sm:whitespace-pre-wrap max-sm:break-all sm:overflow-x-auto">
              <div className="flex items-start gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap break-all select-all">{installCmd}</span>
              </div>
            </div>
            <CopyButton value={installCmd} label="Befehle" />
          </div>
          <p className="text-xs text-muted-foreground">
            Installiert mpv, den Dienst <span className="font-mono">emp-audio</span> und den Update-Timer.
          </p>
        </div>

        {/* Schritt 2 – Konfiguration */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">2</Badge>
            <p className="text-sm font-medium text-foreground/80">Konfigurations-JSON eingeben</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="glass-tile min-w-0 flex-1 select-all break-all p-3 font-mono text-xs text-muted-foreground">
              {configJson}
            </div>
            <CopyButton value={configJson} label="JSON" />
          </div>
          <p className="text-xs text-muted-foreground">
            Das Installationsskript fragt diesen Text ab. Nachtragen geht später mit:
          </p>
          <div className="flex items-start gap-2">
            <div className="glass-tile min-w-0 flex-1 p-3 font-mono text-xs text-foreground max-sm:whitespace-pre-wrap max-sm:break-all sm:overflow-x-auto">
              <span className="break-all select-all">{setupCmd}</span>
            </div>
            <CopyButton value={setupCmd} label="Befehl" />
          </div>
          <Notice
            tone="warning"
            compact
            icon={AlertCircle}
            title="Enthält das API-Token des Mandanten – nur auf den eigenen Pi kopieren."
          />
        </div>

        {/* Schritt 3 – Zone */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">3</Badge>
            <p className="text-sm font-medium text-foreground/80">Beschallungszone zuweisen</p>
          </div>
          {zoneName ? (
            <p className="text-xs text-muted-foreground">
              Zugewiesen an Zone <span className="font-medium text-foreground/80">{zoneName}</span>.
            </p>
          ) : (
            <Notice tone="warning" compact title="Noch keine Zone zugewiesen – ohne Zone spielt der Abspieler nichts.">
              Unter <span className="font-medium">Audio → Zonen</span> nachholen.
            </Notice>
          )}
        </div>

        <div className="glass-tile p-4 space-y-2">
          <h4 className="text-label">Nützliche Befehle</h4>
          <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Status:</span>
              <span className="text-foreground/80">systemctl status emp-audio</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Logs:</span>
              <span className="text-foreground/80">journalctl -u emp-audio -f</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Ausgabe testen:</span>
              <span className="text-foreground/80">speaker-test -c2 -twav</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Soundkarten:</span>
              <span className="text-foreground/80">aplay -l</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
