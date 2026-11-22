import { NextResponse } from "next/server";
import { loadRider } from "@/lib/rider-app";
import { riderAppKind, riderHome } from "@/lib/rider-base";
import { riderManifest } from "@/lib/rider-app-kind";

/** Web-App-Manifest je Person, damit die App mit eigenem Namen auf dem Home-Bildschirm liegt (Ride Pass oder Beach Pass). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await loadRider(token).catch(() => null);
  if (!rider) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(riderManifest(await riderAppKind(), await riderHome(token), rider.accountName), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "private, max-age=300" },
  });
}
