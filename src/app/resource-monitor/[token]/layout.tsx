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
 */
export default function TokenLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-slate-950 mt-[calc(env(safe-area-inset-top)*-1)] pt-[env(safe-area-inset-top)]">
      {children}
    </div>
  );
}
