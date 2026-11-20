"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Copy, Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

const noop = () => () => {};

/**
 * QR-Code zur Kunden-App für neue Kunden: zeigt den Einstieg `/app`, lässt
 * den Link kopieren und druckt einen A4-Aushang.
 */
export function AppQrCard({ accountName }: { accountName: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Adresse erst im Browser bekannt (Server rendert leer).
  const url = useSyncExternalStore(noop, () => `${window.location.origin}/app`, () => "");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !url) return;
    void import("qrcode").then((m) => m.default.toCanvas(canvas, url, { width: 180, margin: 1 }));
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kopieren nicht möglich. Link bitte manuell markieren.");
    }
  }

  async function print() {
    setBusy(true);
    setError("");
    try {
      const { printAppPoster } = await import("@/lib/app-poster");
      const result = await printAppPoster(url, accountName);
      if (!result.ok && result.transport === "download") setError("Drucken war nicht direkt möglich. Der Aushang wurde als PDF gespeichert.");
    } catch {
      setError("Der Aushang konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-muted-foreground" />
          QR-Code für neue Kunden
        </CardTitle>
        <CardDescription>
          Zum Aushängen an Kasse und Steg: Kunden scannen den Code, öffnen die Kunden App, melden sich an und können sie auf dem Handy installieren.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Notice tone="warning" compact role="alert" title={error} />}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <canvas ref={ref} className="size-[180px] shrink-0 rounded-md border border-border bg-white p-1" aria-label="QR-Code zur Kunden App" role="img" />
          <div className="min-w-0 flex-1 space-y-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Link zur Kunden App" className="h-11 font-mono text-xs sm:h-9" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void print()} disabled={busy || !url} className="max-sm:h-11">
                <Printer className="h-4 w-4" />
                Aushang drucken
              </Button>
              <Button type="button" variant="outline" onClick={() => void copy()} disabled={!url} className="max-sm:h-11">
                <Copy className="h-4 w-4" />
                {copied ? "Kopiert" : "Kopieren"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Der Code führt immer zur Anmeldung der App und muss nie erneuert werden. Persönliche Links für einzelne Fahrer gibt es weiter unter Fahrer.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
