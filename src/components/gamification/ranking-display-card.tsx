"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, MonitorPlay } from "lucide-react";
import { useOrigin } from "@/hooks/use-origin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

/** Öffentliche Rangliste für einen Bildschirm ein- und ausschalten, Link zeigen. */
export function RankingDisplayCard({ path }: { path: string | null }) {
  const router = useRouter();
  const origin = useOrigin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const url = path ? `${origin}${path}` : null;

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/gamification/display", { method });
      if (!res.ok) {
        setError("Das hat nicht geklappt. Bitte noch einmal versuchen.");
        return;
      }
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorPlay className="h-4 w-4 text-primary shrink-0" />
          Rangliste für einen Bildschirm
        </CardTitle>
        <CardDescription>
          Zeigt die Saison und laufende Top-X-Challenges. Mit Namen erscheint nur, wer in der App einen Spitznamen
          gesetzt und der Rangliste zugestimmt hat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {url ? (
          <>
            <div className="break-all rounded-md border bg-muted/40 px-3 py-2 text-xs">{url}</div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copy} className="max-sm:h-11">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Kopiert" : "Link kopieren"}
              </Button>
              <Button variant="outline" asChild className="max-sm:h-11">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Öffnen
                </a>
              </Button>
              <Button variant="ghost" onClick={() => call("DELETE")} disabled={busy} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 max-sm:h-11">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Abschalten
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Nach dem Abschalten gilt der Link nicht mehr. Beim Einschalten entsteht ein neuer.</p>
          </>
        ) : (
          <Button onClick={() => call("POST")} disabled={busy} className="max-sm:h-11">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Rangliste einschalten
          </Button>
        )}
        {error && <Notice tone="danger" compact title={error} />}
      </CardContent>
    </Card>
  );
}
