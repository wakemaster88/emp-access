"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, FileDown, Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ErrorLine, apiRequest, fmtDateTime } from "@/components/schliessanlage/shared";
import type { HandoverRow, SignatureRow } from "@/components/schliessanlage/types";

interface Props {
  handover: HandoverRow;
  open: boolean;
  onClose: () => void;
}

function signatureUrl(token: string): string {
  if (typeof window === "undefined") return `/schluessel/${token}`;
  return `${window.location.origin}/schluessel/${token}`;
}

function TokenQr({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void import("qrcode").then((m) =>
      m.default.toCanvas(canvas, url, {
        width: 220,
        margin: 1,
        color: { dark: "#1e293b", light: "#ffffff" },
      }),
    );
  }, [url]);

  return <canvas ref={canvasRef} className="rounded-md bg-white p-1" />;
}

export function SignatureDialog({ handover, open, onClose }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState<SignatureRow | null>(null);

  // Der jüngste Vorgang ist der relevante: entweder frisch erzeugt oder aus
  // den bereits geladenen Daten.
  const signature = created ?? handover.signatures[0] ?? null;
  const signed = signature?.signedAt != null;
  const expired = signature != null && !signed && new Date(signature.expiresAt) < new Date();

  async function createLink() {
    setCreating(true);
    setError("");
    const res = await apiRequest<SignatureRow>(
      `/api/schliessanlage/handovers/${handover.id}/signature`,
      "POST",
      { kind: "HANDOVER" },
    );
    setCreating(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setCreated(res.data);
    router.refresh();
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kopieren nicht möglich – Link bitte manuell markieren.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-1.5 text-base">
            <QrCode className="h-4 w-4 text-indigo-500" />
            Belehrung &amp; Haftung signieren
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {handover.holderName} scannt den Code, liest die Belehrung und unterschreibt direkt auf
            dem eigenen Gerät. Text und Schlüsselliste werden beim Erzeugen eingefroren.
          </p>

          {signed && signature ? (
            <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/10">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Unterschrieben
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {signature.signedName} · {fmtDateTime(signature.signedAt)}
              </p>
              <Button asChild size="sm" variant="outline" className="h-8">
                <a
                  href={`/api/schliessanlage/signatures/${signature.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileDown className="mr-1 h-3.5 w-3.5" />
                  Protokoll als PDF
                </a>
              </Button>
            </div>
          ) : signature && !expired ? (
            <div className="space-y-2">
              <div className="flex justify-center">
                <TokenQr url={signatureUrl(signature.token)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Link</Label>
                <div className="flex gap-1.5">
                  <input
                    readOnly
                    value={signatureUrl(signature.token)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-8 flex-1 rounded border border-slate-200 bg-slate-50 px-2 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-800"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(signatureUrl(signature.token))}
                    className="h-8 shrink-0"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? "Kopiert" : "Kopieren"}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-slate-400">
                Gültig bis {fmtDateTime(signature.expiresAt)}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {expired && (
                <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  Der bisherige Link ist abgelaufen. Erzeuge einen neuen.
                </p>
              )}
              <Button
                size="sm"
                onClick={createLink}
                disabled={creating}
                className="h-9 w-full bg-indigo-600 hover:bg-indigo-700"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <QrCode className="mr-1 h-3.5 w-3.5" />
                    Signatur-Link erzeugen
                  </>
                )}
              </Button>
            </div>
          )}

          <ErrorLine message={error} />
        </div>

        <Separator className="dark:bg-slate-800" />

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="h-8">
            Schließen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
