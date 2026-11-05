"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Check, Info, Loader2, RefreshCw, Save } from "lucide-react";

interface OwnApiCardProps {
  baseUrl: string;
  apiToken: string;
}

const ENDPOINTS = [
  { method: "GET", path: "/api/areas", desc: "Ressourcen (Zugangsbereiche) auflisten" },
  {
    method: "GET",
    path: "/api/webhook/utilization?date=YYYY-MM-DD",
    desc: "Auslastung pro Ressource (Tickets am Tag / personLimit); optional &all=1 für alle Bereiche",
  },
  {
    method: "GET",
    path: "/api/devices",
    desc: "Geräte auflisten; jedes Gerät nennt in controls seine Bedienknöpfe (Aktion + Beschriftung) und in control sein Bedienmodell",
  },
  { method: "GET", path: "/api/devices/[id]", desc: "Einzelnes Gerät abrufen (inkl. control und controls)" },
  {
    method: "GET",
    path: "/api/employees",
    desc: "Mitarbeiter auflisten mit ihren Bereichen (areaIds) und einzeln freigegebenen Geräten (deviceIds); gesetzt werden beide über den emp-control-Webhook",
  },
  {
    method: "POST",
    path: "/api/devices/[id]/action",
    desc: "Gerät steuern – Zutritt und Schalter: open, emergency, reset, deactivate; Markise/Rolltor: open, stop, close; Audio-Zone: open (Start), stop",
  },
  {
    method: "POST",
    path: "/api/devices/[id]/audio",
    desc: 'Audio-Zone: {"action":"PLAY"} (optional playlistId, trackId, streamUrl), {"action":"STOP"}, {"action":"VOLUME","volume":0-100}',
  },
  {
    method: "GET",
    path: "/api/audio/library",
    desc: "Playlists, Webradio-Sender und Musiktitel für die Quellenwahl an Audio-Zonen",
  },
  {
    method: "GET",
    path: "/api/lost-items?filter=open&kind=found&q=...",
    desc: "Fundsachen & Verlustmeldungen suchen (Bilder via &withImages=1)",
  },
  {
    method: "POST",
    path: "/api/lost-items",
    desc: 'Eintrag anlegen – Fundsache: {"description","foundDate"}; Verlustmeldung: {"kind":"LOST_REPORT","description","reporterName"} (callbackPhone optional)',
  },
  { method: "PATCH", path: "/api/lost-items/[id]", desc: 'Eintrag ändern, z. B. {"pickedUp": true}' },
];

export function OwnApiCard({ baseUrl, apiToken }: OwnApiCardProps) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [displayToken, setDisplayToken] = useState(apiToken);
  const [customToken, setCustomToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  // Rückfrage vor dem Ersetzen des Tokens (docs/design-regeln.md, Abschnitt 18): alle Geräte melden
  // sich mit diesem Token an. Der Body für „Neu generieren“ oder „Speichern“ bleibt gesetzt, solange
  // der Dialog ausblendet.
  const [pendingToken, setPendingToken] = useState<{ regenerate: true } | { apiToken: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const regenerating = pendingToken !== null && "regenerate" in pendingToken;

  useEffect(() => {
    setDisplayToken(apiToken);
  }, [apiToken]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  async function patchToken(body: Record<string, unknown>) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fe = data.error?.fieldErrors as Record<string, string[]> | undefined;
        const fromFields = fe ? (Object.values(fe).flat() as string[]).find(Boolean) : undefined;
        const fromForm = Array.isArray(data.error?.formErrors) ? data.error.formErrors[0] : undefined;
        setFeedback({
          type: "err",
          text:
            typeof data.error === "string"
              ? data.error
              : (fromFields ?? fromForm ?? "Speichern fehlgeschlagen"),
        });
        return;
      }
      if (data.apiToken) {
        setDisplayToken(data.apiToken);
        setCustomToken("");
        setFeedback({ type: "ok", text: "API-Token gespeichert. Geräte ggf. neu konfigurieren." });
        router.refresh();
      }
    } catch {
      setFeedback({ type: "err", text: "Netzwerkfehler" });
    } finally {
      setBusy(false);
    }
  }

  function askTokenChange(body: { regenerate: true } | { apiToken: string }) {
    setPendingToken(body);
    setConfirmOpen(true);
  }

  async function confirmTokenChange() {
    if (!pendingToken) return;
    try {
      await patchToken(pendingToken);
    } finally {
      setConfirmOpen(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Andere Systeme können mit dem API-Token auf Ressourcen und Geräte zugreifen. Token hier setzen oder neu generieren – wird in der Datenbank gespeichert.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground shrink-0">Base-URL</span>
            <div className="flex items-center gap-1 min-w-0">
              {/* Gleiche Pille wie beim Token darunter; lange URL kürzt mit Auslassung. */}
              <Badge variant="mono" className="min-w-0 max-w-[240px] shrink">
                <span className="truncate">{baseUrl}</span>
              </Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 max-sm:size-11"
                onClick={() => copy(baseUrl, "url")}
                title="Base-URL kopieren"
                aria-label="Base-URL kopieren"
              >
                {copied === "url" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground shrink-0">API-Token</span>
            <div className="flex items-center gap-1 min-w-0">
              {/* Langer Token: Pille darf schrumpfen, der Text kürzt mit Auslassung. */}
              <Badge variant="mono" className="min-w-0 max-w-[180px] shrink">
                <span className="truncate">{displayToken || "—"}</span>
              </Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 max-sm:size-11"
                onClick={() => copy(displayToken, "token")}
                disabled={!displayToken}
                title="API-Token kopieren"
                aria-label="API-Token kopieren"
              >
                {copied === "token" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="glass-tile p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="max-sm:h-11"
              disabled={busy}
              onClick={() => askTokenChange({ regenerate: true })}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Neu generieren
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-api-token">
              Eigenen Token speichern (min. 16 Zeichen)
            </Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="custom-api-token"
                className="font-mono max-sm:h-11"
                placeholder="Neuer Token …"
                value={customToken}
                onChange={(e) => setCustomToken(e.target.value)}
                autoComplete="off"
              />
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0 max-sm:h-11"
                disabled={busy || customToken.trim().length < 16}
                onClick={() => askTokenChange({ apiToken: customToken.trim() })}
              >
                <Save className="h-3.5 w-3.5" />
                Speichern
              </Button>
            </div>
          </div>
          {feedback && (
            <Notice tone={feedback.type === "ok" ? "success" : "danger"} compact title={feedback.text} />
          )}
        </div>

        <div className="glass-tile p-3 space-y-2">
          <p className="text-label">Authentifizierung</p>
          <p className="text-xs text-muted-foreground">
            Header: <code className="bg-muted px-1 rounded">Authorization: Bearer {'<token>'}</code>
            {" "}oder Query: <code className="bg-muted px-1 rounded">?token={'<token>'}</code>
          </p>
          <p className="text-xs text-muted-foreground">
            Token ändern (eingeloggt): <code className="bg-muted px-1 rounded">PATCH /api/settings/account</code> mit{" "}
            <code className="bg-muted px-1 rounded">{`{ "regenerate": true }`}</code> oder{" "}
            <code className="bg-muted px-1 rounded">{`{ "apiToken": "…" }`}</code>
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-label">Endpunkte (Lesen & Geräte steuern)</p>
          <ul className="space-y-1.5 text-xs">
            {ENDPOINTS.map((ep) => (
              <li key={ep.path} className="flex flex-wrap items-baseline gap-2">
                <Badge variant="mono">
                  {ep.method}
                </Badge>
                <code className="text-muted-foreground break-all">{ep.path}</code>
                <span className="text-muted-foreground">– {ep.desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <Notice tone="info" compact icon={Info}>
          <p className="wrap-anywhere">
            Beispiel Gerät öffnen: <code className="bg-muted px-1 rounded">POST {baseUrl}/api/devices/1/action</code> mit Body <code className="bg-muted px-1 rounded">{`{"action": "open"}`}</code>
          </p>
        </Notice>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!busy) setConfirmOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{regenerating ? "API-Token neu erzeugen?" : "Eigenen Token speichern?"}</AlertDialogTitle>
            <AlertDialogDescription>
              Alle Geräte mit dem alten Token verlieren sofort den Zugriff und müssen aktualisiert werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                // Offen lassen, bis der Token ersetzt ist; das Ergebnis steht danach in der Karte.
                e.preventDefault();
                void confirmTokenChange();
              }}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : regenerating ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {regenerating ? "Neu generieren" : "Speichern"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
