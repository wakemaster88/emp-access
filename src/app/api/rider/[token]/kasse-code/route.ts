import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiSession } from "@/lib/rider-auth";
import { appCode } from "@/lib/rider-kasse-link";

/**
 * POST: App-Code für die Kasse (Profil › „Abo fehlt?“). Das Personal scannt
 * ihn am Shop-Monitor und verknüpft so ein Abo mit dieser App
 * (lib/rider-kasse-link). Kommt per API statt mit der Seite, weil der
 * Service Worker Seiten zwischenspeichert und der Code abläuft.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited =
    publicRateLimit(ip, "rider-kasse-code-ip", { limit: 30, windowMs: 10 * 60_000 }) ??
    publicRateLimit(token, "rider-kasse-code", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const ctx = await riderApiSession(token);
  if ("error" in ctx) return ctx.error;
  if (ctx.profile.familyId != null && !ctx.profile.familyAdult) {
    return NextResponse.json({ error: "Das geht nur in der App eines Erwachsenen der Familie." }, { status: 409 });
  }

  const { code, expiresAt } = appCode(ctx.profile.id);
  const svg = await QRCode.toString(code, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return NextResponse.json({ code, svg, expiresAt: expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
