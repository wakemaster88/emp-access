import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { redeemBenefitVoucher } from "@/lib/gamification-service";
import { buildScanCodeVariants } from "@/lib/scan-code-variants";

const schema = z.object({ code: z.string().trim().min(1).max(200) });

/**
 * POST: Leistungs-Gutschein entwerten – per Code aus dem Handscanner oder per
 * Klick in der Liste. Zutritts-Gutscheine werden hier nicht angefasst.
 */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Kein Code" }, { status: 400 });
  }
  // Wie am Check-in: Scanner mit deutschem Tastaturlayout liefern "GSß…" statt "GS-…".
  const variants = buildScanCodeVariants(parsed.data.code);
  const voucher = await db.voucher.findFirst({
    where: { accountId, OR: variants.map((code) => ({ code })) },
  });
  if (!voucher) {
    return NextResponse.json({ ok: false, message: "Gutschein nicht gefunden" }, { status: 404 });
  }
  if (voucher.kind !== "BENEFIT") {
    return NextResponse.json(
      { ok: false, message: "Das ist ein Zutritts-Gutschein. Er wird am Check-in eingelöst." },
      { status: 409 },
    );
  }
  const result = await redeemBenefitVoucher(db, accountId, voucher, "ADMIN");
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
