import { NextRequest, NextResponse } from "next/server";
import { findPublicMonitor } from "@/lib/monitor-token";
import {
  PUBLIC_APP_KINDS,
  PUBLIC_APP_MONITOR_TYPE,
  publicAppManifest,
  type PublicAppKind,
} from "@/lib/pwa-manifest";

/**
 * Web-App-Manifest je Token-Seite. Der Token ist die Berechtigung; mehr als
 * der Monitorname wird nicht preisgegeben.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string; token: string }> }) {
  const { kind, token } = await params;
  if (!(PUBLIC_APP_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "Unbekannt" }, { status: 404 });
  }
  const monitor = await findPublicMonitor(token);
  if (!monitor || !monitor.isActive || monitor.type !== PUBLIC_APP_MONITOR_TYPE[kind as PublicAppKind]) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json(publicAppManifest(kind as PublicAppKind, token, monitor.name), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
