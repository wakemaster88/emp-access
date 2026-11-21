import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, tenantClient } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { redeemAtMonitor, VOUCHER_MONITOR_TYPE } from "@/lib/voucher-monitor";

const schema = z.object({ code: z.string().trim().min(1).max(200) });

/** POST {code}: Leistungs-Gutschein am Gutschein-Monitor einlösen. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "voucher-monitor-redeem");
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== VOUCHER_MONITOR_TYPE) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Kein Code" }, { status: 400 });
  const db = tenantClient(monitor.accountId);
  const result = await redeemAtMonitor(db, monitor.accountId, parsed.data.code);
  return NextResponse.json(result, { status: result.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
}
