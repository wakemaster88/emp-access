import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ScannerClient } from "@/components/scanner/scanner-client";
import { QrCode } from "lucide-react";

/**
 * Oeffentlicher Scanner ueber Monitor-Token (Typ "SCANNER").
 * Identische Scan-Logik wie der angemeldete `/scanner` – ohne Login,
 * mit kontogebundener Authentifizierung ueber den Token.
 */
export default async function PublicScannerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "SCANNER") {
    notFound();
  }

  const safeToken = encodeURIComponent(token);

  // Farbgrund und `dark` kommen aus dem Layout. Die Seite ist so hoch wie der
  // Bildschirm ohne Safe-Area (oben und unten paddet das Layout); der Scanner
  // füllt den Platz unter dem Kopf.
  return (
    <div className="flex h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col">
      <header className="glass-bar flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex items-center gap-2 min-w-0">
          <QrCode className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-lg font-semibold tracking-tight truncate sm:text-xl">{monitor.name}</h1>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:inline">EMP Access · Öffentlicher Scanner</span>
      </header>
      <ScannerClient
        areasUrl={`/api/scanner/public/${safeToken}/areas`}
        scanCheckUrl={`/api/scanner/public/${safeToken}/scan-check`}
      />
    </div>
  );
}
