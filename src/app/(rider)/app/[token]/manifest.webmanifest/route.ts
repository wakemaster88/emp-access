import { NextResponse } from "next/server";
import { loadRiderAccountName } from "@/lib/rider-app";
import { riderAppKind, riderHome } from "@/lib/rider-base";
import { riderManifest } from "@/lib/rider-app-kind";

/** Web-App-Manifest je Person, damit die App mit eigenem Namen auf dem Home-Bildschirm liegt (Ride Pass oder Beach Pass). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const accountName = await loadRiderAccountName(token).catch(() => null);
  if (!accountName) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(riderManifest(await riderAppKind(), await riderHome(token), accountName), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "private, max-age=300" },
  });
}
