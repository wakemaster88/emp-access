"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
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
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, {
        width: size,
        margin: 1,
        color: { dark: "#1e293b", light: "#f8fafc" },
      });
    }
  }, [value, size]);

  useEffect(() => {
    if (open && dialogCanvasRef.current) {
      QRCode.toCanvas(dialogCanvasRef.current, value, {
        width: 280,
        margin: 2,
        color: { dark: "#1e293b", light: "#ffffff" },
      });
    }
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
        className="rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all"
        onClick={() => setOpen(true)}
        title="Klicken für Installationshinweise"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-indigo-600" />
              Raspberry Pi einrichten
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-2">
            {/* Step 1 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs">1</Badge>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Software installieren</h3>
              </div>
              <p className="text-sm text-slate-500">
                Auf dem Raspberry Pi folgenden Befehl im Terminal ausführen:
              </p>
              <div className="relative">
                <div className="bg-slate-900 dark:bg-slate-950 rounded-lg p-3 pr-12 font-mono text-xs text-emerald-400 overflow-x-auto">
                  <div className="flex items-start gap-2">
                    <Terminal className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                    <span className="break-all select-all">sudo bash install.sh</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Alternativ das Repository manuell klonen:
              </p>
              <div className="relative group">
                <div className="bg-slate-900 dark:bg-slate-950 rounded-lg p-3 pr-12 font-mono text-xs text-slate-300 overflow-x-auto">
                  <p className="text-slate-500 mb-1"># Repository klonen</p>
                  <p>git clone https://github.com/wakemaster88/emp-access.git</p>
                  <p>cd emp-access/raspberry-pi</p>
                  <p className="text-slate-500 mt-1"># Installation starten</p>
                  <p>sudo bash install.sh</p>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs">2</Badge>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">USB-Scanner anschließen</h3>
              </div>
              <p className="text-sm text-slate-500">
                Einen USB-HID-Scanner (QR/Barcode/RFID) am Raspberry Pi anschließen.
                Der Scanner wird automatisch erkannt.
              </p>
            </div>

            {/* Step 3 – QR Code */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs">3</Badge>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Konfigurations-QR scannen</h3>
              </div>
              <p className="text-sm text-slate-500">
                Diesen QR-Code mit dem angeschlossenen USB-Scanner am Raspberry Pi scannen.
                Er verbindet das Gerät automatisch mit dem Server.
              </p>
              <div className="flex justify-center">
                <div className="bg-white p-4 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                  <canvas ref={dialogCanvasRef} className="rounded-lg" />
                </div>
              </div>
              <p className="text-xs text-slate-400 text-center">
                Enthält Server-URL, API-Token und Geräte-ID
              </p>
            </div>

            {/* Step 4 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                </Badge>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Fertig</h3>
              </div>
              <p className="text-sm text-slate-500">
                Nach dem Scannen verbindet sich der Pi automatisch mit dem Server.
                Status und System-Infos werden auf dieser Seite angezeigt.
                Updates erfolgen automatisch alle 15 Minuten.
              </p>
            </div>

            {/* Troubleshooting */}
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 space-y-2">
              <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Nützliche Befehle</h4>
              <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Status:</span>
                  <span className="text-slate-600 dark:text-slate-300">sudo systemctl status emp-scanner</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Logs:</span>
                  <span className="text-slate-600 dark:text-slate-300">sudo journalctl -u emp-scanner -f</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Neustart:</span>
                  <span className="text-slate-600 dark:text-slate-300">sudo systemctl restart emp-scanner</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Update:</span>
                  <span className="text-slate-600 dark:text-slate-300">cd /opt/emp-scanner && sudo git pull</span>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
