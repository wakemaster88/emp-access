import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, tenantClient } from "@/lib/prisma";
import { publicRateLimit } from "@/lib/rate-limit";
import { checkVoucher, todaysRedemptions, VOUCHER_MONITOR_TYPE } from "@/lib/voucher-monitor";

const NO_STORE = { "Cache-Control": "no-store" };
const schema = z.object({ code: z.string().trim().min(1).max(200) });

async function voucherMonitor(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== VOUCHER_MONITOR_TYPE) return null;
  return monitor;
}

/** GET: heute eingelöste Gutscheine für die Liste unter dem Scanfeld. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const monitor = await voucherMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const db = tenantClient(monitor.accountId);
  const redemptions = await todaysRedemptions(db, monitor.accountId);
  return NextResponse.json({ redemptions }, { headers: NO_STORE });
}

/** POST {code}: Gutschein prüfen, ohne ihn zu entwerten. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "voucher-monitor-check");
  if (limited) return limited;
  const monitor = await voucherMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ found: false, message: "Kein Code" }, { status: 400 });
  const db = tenantClient(monitor.accountId);
  const result = await checkVoucher(db, monitor.accountId, parsed.data.code);
  return NextResponse.json(result, { headers: NO_STORE });
}
