"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, FileDown, Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
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
          <DialogTitle>Belehrung &amp; Haftung signieren</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {handover.holderName} scannt den Code, liest die Belehrung und unterschreibt direkt auf
            dem eigenen Gerät. Text und Schlüsselliste werden beim Erzeugen eingefroren.
          </p>

          {signed && signature ? (
            <Notice tone="success" title="Unterschrieben">
              <p className="tabular-nums">
                {signature.signedName} · {fmtDateTime(signature.signedAt)}
              </p>
              <Button asChild size="sm" variant="outline" className="mt-2 max-sm:h-11">
                <a
                  href={`/api/schliessanlage/signatures/${signature.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileDown className="mr-1 h-3.5 w-3.5" />
                  Protokoll als PDF
                </a>
              </Button>
            </Notice>
          ) : signature && !expired ? (
            <div className="space-y-2">
              <div className="flex justify-center">
                <TokenQr url={signatureUrl(signature.token)} />
              </div>
              <div className="space-y-1">
                <Label>Link</Label>
                <div className="flex gap-1.5">
                  <Input
                    readOnly
                    value={signatureUrl(signature.token)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 font-mono md:text-xs max-sm:h-11"
                  />
                  <Button
                    variant="outline"
                    onClick={() => copy(signatureUrl(signature.token))}
                    className="shrink-0 max-sm:h-11"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? "Kopiert" : "Kopieren"}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Gültig bis {fmtDateTime(signature.expiresAt)}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {expired && (
                <Notice
                  tone="warning"
                  compact
                  title="Der bisherige Link ist abgelaufen. Erzeuge einen neuen."
                />
              )}
              <Button
                onClick={createLink}
                disabled={creating}
                className="w-full max-sm:h-11"
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

        <Separator />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="max-sm:h-11">
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
