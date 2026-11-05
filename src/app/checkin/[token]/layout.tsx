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
    monitor && monitor.isActive && monitor.type === PUBLIC_APP_MONITOR_TYPE["checkin"] ? monitor.name : "Check-in";
  return publicAppMetadata("checkin", token, name);
}

/**
 * Der Body traegt die Safe-Area als Padding; unter der transparenten iOS-
 * Statusleiste, der Home-Leiste und (quer) neben der Notch wuerde sonst der
 * helle Body-Hintergrund durchscheinen. Der Rahmen hebt das Padding auf allen
 * vier Seiten auf und paddet selbst – mit dunklem Grund.
 * Der Kiosk ist fest dunkel: `dark` schaltet die Tokens um, `page-ambient`
 * liefert den Liquid-Glass-Hintergrund.
 */
export default function TokenLayout({ children }: LayoutProps) {
  return (
    <div className="dark page-ambient text-foreground [color-scheme:dark] min-h-[100dvh] mt-[calc(env(safe-area-inset-top)*-1)] pt-[env(safe-area-inset-top)] mb-[calc(env(safe-area-inset-bottom)*-1)] pb-[env(safe-area-inset-bottom)] ml-[calc(env(safe-area-inset-left)*-1)] pl-[env(safe-area-inset-left)] mr-[calc(env(safe-area-inset-right)*-1)] pr-[env(safe-area-inset-right)]">
      {children}
    </div>
  );
}
