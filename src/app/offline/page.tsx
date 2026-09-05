import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = {
  title: "Offline – EMP Access",
  robots: { index: false, follow: false },
};

/**
 * Fallback-Seite des Service Workers: erscheint, wenn eine Seite ohne
 * Netz aufgerufen wird. Bewusst ohne Datenzugriff, damit sie sich beim
 * Installieren des Service Workers cachen laesst.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-slate-950 text-slate-100 px-6">
      <div className="max-w-sm text-center space-y-4">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-slate-800 flex items-center justify-center">
          <WifiOff className="h-8 w-8 text-slate-300" />
        </div>
        <h1 className="text-xl font-semibold">Keine Verbindung</h1>
        <p className="text-sm text-slate-400">
          EMP Access braucht eine Internetverbindung. Sobald WLAN oder Mobilfunk
          wieder da sind, geht es hier weiter.
        </p>
        <RetryButton />
      </div>
    </main>
  );
}
