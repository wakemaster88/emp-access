import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = {
  title: "Offline – EMP Access",
  robots: { index: false, follow: false },
};

/**
 * Fallback-Seite des Service Workers: erscheint, wenn eine Seite ohne
 * Netz aufgerufen wird. Bewusst ohne Datenzugriff, damit sie sich beim
 * Installieren des Service Workers cachen laesst.
 *
 * Folgt Hell/Dunkel des Geräts: eine Glaskarte auf dem Farbgrund, wie die
 * Anmeldung.
 */
export default function OfflinePage() {
  return (
    <main className="page-ambient min-h-[100dvh] flex items-center justify-center px-6">
      <Card className="w-full max-w-sm items-center gap-3 px-6 py-10 text-center sm:py-10">
        <IconChip icon={WifiOff} size="lg" className="size-14 rounded-tile [&_svg]:size-7" />
        <h1 className="text-xl font-semibold tracking-tight">Keine Verbindung</h1>
        <p className="text-sm text-muted-foreground">
          EMP Access braucht eine Internetverbindung. Sobald WLAN oder Mobilfunk
          wieder da sind, geht es hier weiter.
        </p>
        <RetryButton />
      </Card>
    </main>
  );
}
