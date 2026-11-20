import { after, NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderAuthContext } from "@/lib/rider-auth-api";
import { sendRiderResetMail } from "@/lib/rider-reset";

/**
 * POST: Passwort vergessen. Schickt einen Link zum Neufestlegen an die Adresse
 * dieses Zugangs. Die Antwort ist immer dieselbe; gesendet wird erst danach.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "reset");
  if ("error" in ctx) return ctx.error;
  const limited = publicRateLimit(ctx.profile.token, "rider-reset-mail", { limit: 3, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const origin = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
  const profile = ctx.profile;
  after(() =>
    sendRiderResetMail(profile, origin).catch((err) => {
      console.error("[rider] reset mail failed:", err);
    }),
  );
  return NextResponse.json({ ok: true });
}
