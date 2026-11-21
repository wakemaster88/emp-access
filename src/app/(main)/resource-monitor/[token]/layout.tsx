import type { Metadata, Viewport } from "next";
import { findPublicMonitor } from "@/lib/monitor-token";
import { PUBLIC_APP_MONITOR_TYPE, darkViewport, publicAppMetadata } from "@/lib/pwa-manifest";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}

export const viewport: Viewport = darkViewport;

/** Manifest und iOS-App-Tags mit dem Namen des Monitors, kein Suchmaschinen-Index. */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { token } = await params;
  const monitor = await findPublicMonitor(token).catch(() => null);
  const name =
    monitor && monitor.isActive && monitor.type === PUBLIC_APP_MONITOR_TYPE["resource-monitor"] ? monitor.name : "Auslastung";
  return publicAppMetadata("resource-monitor", token, name);
}

/**
 * Der Body traegt die Safe-Area als Padding; unter der transparenten iOS-
 * Statusleiste wuerde sonst der helle Body-Hintergrund durchscheinen. Der
 * Rahmen hebt das Padding auf und paddet selbst – mit dunklem Grund.
 *
 * Wandmonitor: läuft immer dunkel (docs/design-regeln.md, Abschnitt 20). Die
 * Klasse `dark` stellt alle Tokens darunter auf ihre dunklen Werte, der
 * Farbgrund (`page-ambient`) liegt auch unter der Statusleiste.
 *
 * Fester Rahmen in Bildschirmhöhe: Er hebt das Body-Padding oben und unten auf
 * und paddet selbst, die Seite füllt den Rest (`flex-1`). So ist das Dokument
 * genau so hoch wie der Bildschirm – die Anzeige scrollt auch als App mit
 * Statusleiste und Home-Leiste nicht, und der Farbgrund reicht bis unten.
 */
export default function TokenLayout({ children }: LayoutProps) {
  return (
    <div className="dark scheme-dark page-ambient text-foreground flex h-dvh flex-col mt-[calc(env(safe-area-inset-top)*-1)] mb-[calc(env(safe-area-inset-bottom)*-1)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {children}
    </div>
  );
}
