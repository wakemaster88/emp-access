import { notFound } from "next/navigation";
import { Gift } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { VOUCHER_MONITOR_TYPE } from "@/lib/voucher-monitor";
import { VoucherScanMonitor } from "@/components/vouchers/voucher-scan-monitor";

export const dynamic = "force-dynamic";

/**
 * Gutschein-Monitor über Monitor-Token (Typ "VOUCHER"): Gutscheine aus der
 * Kunden-App an der Kasse scannen, prüfen und einlösen – ohne Login.
 */
export default async function VoucherMonitorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== VOUCHER_MONITOR_TYPE) notFound();

  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col">
      <header className="glass-bar flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Gift className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{monitor.name}</h1>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">EMP Access · Gutschein-Monitor</span>
      </header>
      <VoucherScanMonitor apiUrl={`/api/gutscheine/public/${encodeURIComponent(token)}`} />
    </div>
  );
}
