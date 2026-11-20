"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, MonitorPlay, Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

const noop = () => () => {};

/**
 * Alles, was die App nach außen zeigt, in einer Karte: QR-Aushang zur App
 * (`/app`, muss nie erneuert werden) und die öffentliche Rangliste für einen
 * Bildschirm (an/aus, Link).
 */
export function AppShareCard({ accountName, rankingPath }: { accountName: string; rankingPath: string | null }) {
  const router = useRouter();
  const ref = useRef<HTMLCanvasElement>(null);
  // Adresse erst im Browser bekannt (Server rendert leer).
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const appUrl = origin ? `${origin}/app` : "";
  const rankingUrl = origin && rankingPath ? `${origin}${rankingPath}` : null;
  const [copied, setCopied] = useState<"app" | "ranking" | null>(null);
  const [printing, setPrinting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !appUrl) return;
    void import("qrcode").then((m) => m.default.toCanvas(canvas, appUrl, { width: 112, margin: 1 }));
  }, [appUrl]);

  async function copy(which: "app" | "ranking", url: string | null) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Kopieren nicht möglich.");
    }
  }

  async function print() {
    setPrinting(true);
    setError("");
    try {
      const { printAppPoster } = await import("@/lib/app-poster");
      const result = await printAppPoster(appUrl, accountName);
      if (!result.ok && result.transport === "download") setError("Drucken war nicht direkt möglich. Der Aushang wurde als PDF gespeichert.");
    } catch {
      setError("Der Aushang konnte nicht erstellt werden.");
    } finally {
      setPrinting(false);
    }
  }

  async function setRanking(on: boolean) {
    setSwitching(true);
    setError("");
    try {
      const res = await fetch("/api/gamification/display", { method: on ? "POST" : "DELETE" });
      if (!res.ok) {
        setError("Das hat nicht geklappt. Bitte noch einmal versuchen.");
        return;
      }
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-primary shrink-0" />
          Aushang und Bildschirm
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <canvas
            ref={ref}
            className="size-[112px] shrink-0 rounded-md border border-border bg-white p-1"
            aria-label="QR-Code zur Kunden App"
            role="img"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-sm font-medium">QR-Code zur App</p>
              <p className="text-xs text-muted-foreground">Für Kasse und Steg. Führt zur Anmeldung, bleibt immer gleich.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void print()} disabled={printing || !appUrl} className="max-sm:h-11">
                {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                Drucken
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void copy("app", appUrl)} disabled={!appUrl} className="max-sm:h-11" aria-label="Link zur App kopieren">
                {copied === "app" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied === "app" ? "Kopiert" : "Link"}
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="ranking-on" className="flex items-center gap-2">
                <MonitorPlay className="h-4 w-4 text-muted-foreground shrink-0" />
                Rangliste für einen Bildschirm
              </Label>
              <p className="text-xs text-muted-foreground">
                Saison und laufende Top-X-Challenges. Namen nur mit Spitzname und Zustimmung in der App. Ausschalten macht den Link ungültig.
              </p>
            </div>
            <Switch id="ranking-on" checked={rankingPath != null} disabled={switching} onCheckedChange={(v) => void setRanking(v)} />
          </div>
          {rankingUrl && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void copy("ranking", rankingUrl)} className="max-sm:h-11">
                {copied === "ranking" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied === "ranking" ? "Kopiert" : "Link kopieren"}
              </Button>
              <Button type="button" size="sm" variant="outline" asChild className="max-sm:h-11">
                <a href={rankingUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Öffnen
                </a>
              </Button>
            </div>
          )}
        </div>

        {error && <Notice tone="warning" compact role="alert" title={error} />}
      </CardContent>
    </Card>
  );
}
