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
        className="rounded-lg border border-border cursor-pointer hover:ring-2 hover:ring-primary/60 transition-all"
        onClick={() => setOpen(true)}
        title="Klicken für Installationshinweise"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-muted-foreground" />
              Raspberry Pi einrichten
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-2">
            {/* Step 1 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="tabular-nums">1</Badge>
                <h3 className="text-sm font-semibold text-foreground">Software installieren</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Auf dem Raspberry Pi folgenden Befehl im Terminal ausführen:
              </p>
              <div className="relative">
                {/* Befehle als ruhige Glas-Kachel (in der Ebene getönt), ohne eigene Terminal-Farben. */}
                <div className="glass-tile p-3 font-mono text-xs text-foreground overflow-x-auto">
                  <div className="flex items-start gap-2">
                    <Terminal className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="break-all select-all">sudo bash install.sh</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Alternativ das Repository manuell klonen:
              </p>
              <div className="relative group">
                <div className="glass-tile p-3 font-mono text-xs text-foreground/90 overflow-x-auto">
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
                <Badge variant="secondary" className="tabular-nums">2</Badge>
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
                <Badge variant="secondary" className="tabular-nums">3</Badge>
                <h3 className="text-sm font-semibold text-foreground">Konfigurations-QR scannen</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Diesen QR-Code mit dem angeschlossenen USB-Scanner am Raspberry Pi scannen.
                Er verbindet das Gerät automatisch mit dem Server.
              </p>
              <div className="flex justify-center">
                {/* Weißer Grund bleibt: der Scanner braucht die helle Ruhezone um den QR-Code, auch im Dunkelmodus. */}
                <div className="bg-white p-4 rounded-xl border-2 border-dashed border-border">
                  <canvas ref={dialogCanvasRef} className="rounded-lg" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
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
            {/* Gruppe im Dialog als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (Abschnitt 18). */}
            <div className="glass-tile p-4 space-y-2">
              <h4 className="text-label">Nützliche Befehle</h4>
              <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="text-foreground/80">sudo systemctl status emp-scanner</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Logs:</span>
                  <span className="text-foreground/80">sudo journalctl -u emp-scanner -f</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Neustart:</span>
                  <span className="text-foreground/80">sudo systemctl restart emp-scanner</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Update:</span>
                  <span className="text-foreground/80">cd /opt/emp-scanner && sudo git pull</span>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
