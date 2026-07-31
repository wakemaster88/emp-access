"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      className="gap-1.5 text-xs shrink-0"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
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
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Abspieler einrichten
          </h3>
        </div>

        {/* Schritt 1 – Software */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 text-xs">1</Badge>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Software auf dem Raspberry Pi</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="bg-slate-900 dark:bg-slate-950 rounded-lg p-3 font-mono text-xs text-slate-300 overflow-x-auto flex-1">
              <div className="flex items-start gap-2">
                <Terminal className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                <span className="whitespace-pre select-all">{installCmd}</span>
              </div>
            </div>
            <CopyButton value={installCmd} label="Befehle" />
          </div>
          <p className="text-xs text-slate-400">
            Installiert mpv, den Dienst <span className="font-mono">emp-audio</span> und den Update-Timer.
          </p>
        </div>

        {/* Schritt 2 – Konfiguration */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 text-xs">2</Badge>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Konfigurations-JSON eingeben</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-600 dark:text-slate-300 break-all flex-1 select-all">
              {configJson}
            </div>
            <CopyButton value={configJson} label="JSON" />
          </div>
          <p className="text-xs text-slate-400">
            Das Installationsskript fragt diesen Text ab. Nachtragen geht später mit:
          </p>
          <div className="flex items-start gap-2">
            <div className="bg-slate-900 dark:bg-slate-950 rounded-lg p-3 font-mono text-xs text-slate-300 overflow-x-auto flex-1">
              <span className="break-all select-all">{setupCmd}</span>
            </div>
            <CopyButton value={setupCmd} label="Befehl" />
          </div>
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Enthält das API-Token des Mandanten – nur auf den eigenen Pi kopieren.</span>
          </div>
        </div>

        {/* Schritt 3 – Zone */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 text-xs">3</Badge>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Beschallungszone zuweisen</p>
          </div>
          {zoneName ? (
            <p className="text-xs text-slate-500">
              Zugewiesen an Zone <span className="font-medium text-slate-700 dark:text-slate-300">{zoneName}</span>.
            </p>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Noch keine Zone zugewiesen – ohne Zone spielt der Abspieler nichts.
              Unter <span className="font-medium">Audio → Zonen</span> nachholen.
            </p>
          )}
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 space-y-2">
          <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Nützliche Befehle</h4>
          <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Status:</span>
              <span className="text-slate-600 dark:text-slate-300">systemctl status emp-audio</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Logs:</span>
              <span className="text-slate-600 dark:text-slate-300">journalctl -u emp-audio -f</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Ausgabe testen:</span>
              <span className="text-slate-600 dark:text-slate-300">speaker-test -c2 -twav</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Soundkarten:</span>
              <span className="text-slate-600 dark:text-slate-300">aplay -l</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
