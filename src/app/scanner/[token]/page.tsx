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

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <QrCode className="h-5 w-5 text-indigo-400 shrink-0" />
          <h1 className="text-sm font-semibold truncate">{monitor.name}</h1>
        </div>
        <span className="text-xs text-slate-500 hidden sm:inline">EMP Access · Public Scanner</span>
      </header>
      <ScannerClient
        areasUrl={`/api/scanner/public/${safeToken}/areas`}
        scanCheckUrl={`/api/scanner/public/${safeToken}/scan-check`}
      />
    </div>
  );
}
