"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Terminal, Wifi, QrCode, CheckCircle2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeviceQrProps {
  value: string;
  size?: number;
}

export function DeviceQr({ value, size = 96 }: DeviceQrProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogCanvasRef = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void import("qrcode").then((m) =>
      m.default.toCanvas(canvas, value, {
        width: size,
        margin: 1,
        color: { dark: "#1e293b", light: "#f8fafc" },
      }),
    );
  }, [value, size]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const canvas = dialogCanvasRef.current;
      if (!canvas) return;
      void import("qrcode").then((m) =>
        m.default.toCanvas(canvas, value, {
          width: 280,
          margin: 2,
          color: { dark: "#1e293b", light: "#ffffff" },
        }),
      );
    }, 50);
    return () => clearTimeout(timer);
  }, [open, value]);

  const installCmd = "curl -sSL https://raw.githubusercontent.com/wakemaster88/emp-access/main/raspberry-pi/install.sh | sudo bash";

  async function copyCommand() {
    await navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className="rounded-lg border border-border cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all"
        onClick={() => setOpen(true)}
        title="Klicken für Installationshinweise"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              Raspberry Pi einrichten
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-2">
            {/* Step 1 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/10 text-primary text-xs">1</Badge>
                <h3 className="text-sm font-semibold text-foreground">Software installieren</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Auf dem Raspberry Pi folgenden Befehl im Terminal ausführen:
              </p>
              <div className="relative">
                <div className="bg-slate-900 dark:bg-slate-950 rounded-lg p-3 pr-12 font-mono text-xs text-emerald-400 overflow-x-auto">
                  <div className="flex items-start gap-2">
                    <Terminal className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="break-all select-all">sudo bash install.sh</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground/70">
                Alternativ das Repository manuell klonen:
              </p>
              <div className="relative group">
                <div className="bg-slate-900 dark:bg-slate-950 rounded-lg p-3 pr-12 font-mono text-xs text-slate-300 overflow-x-auto">
                  <p className="text-muted-foreground mb-1"># Repository klonen</p>
                  <p>git clone https://github.com/wakemaster88/emp-access.git</p>
                  <p>cd emp-access/raspberry-pi</p>
                  <p className="text-muted-foreground mt-1"># Installation starten</p>
                  <p>sudo bash install.sh</p>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/10 text-primary text-xs">2</Badge>
                <h3 className="text-sm font-semibold text-foreground">USB-Scanner anschließen</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Einen USB-HID-Scanner (QR/Barcode/RFID) am Raspberry Pi anschließen.
                Der Scanner wird automatisch erkannt.
              </p>
            </div>

            {/* Step 3 – QR Code */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/10 text-primary text-xs">3</Badge>
                <h3 className="text-sm font-semibold text-foreground">Konfigurations-QR scannen</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Diesen QR-Code mit dem angeschlossenen USB-Scanner am Raspberry Pi scannen.
                Er verbindet das Gerät automatisch mit dem Server.
              </p>
              <div className="flex justify-center">
                <div className="bg-white p-4 rounded-xl border-2 border-dashed border-border">
                  <canvas ref={dialogCanvasRef} className="rounded-lg" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground/70 text-center">
                Enthält Server-URL, API-Token und Geräte-ID
              </p>
            </div>

            {/* Step 4 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="success" className="text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                </Badge>
                <h3 className="text-sm font-semibold text-foreground">Fertig</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Nach dem Scannen verbindet sich der Pi automatisch mit dem Server.
                Status und System-Infos werden auf dieser Seite angezeigt.
                Updates erfolgen automatisch alle 15 Minuten.
              </p>
            </div>

            {/* Troubleshooting */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nützliche Befehle</h4>
              <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground/70">Status:</span>
                  <span className="text-muted-foreground">sudo systemctl status emp-scanner</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground/70">Logs:</span>
                  <span className="text-muted-foreground">sudo journalctl -u emp-scanner -f</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground/70">Neustart:</span>
                  <span className="text-muted-foreground">sudo systemctl restart emp-scanner</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground/70">Update:</span>
                  <span className="text-muted-foreground">cd /opt/emp-scanner && sudo git pull</span>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
