import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, wawiSession } from "@/lib/warenwirtschaft-server";
import { createSignOptions, relyingPartyFrom } from "@/lib/passkey";
import { signBlockedReason } from "@/lib/stocktake-log";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ role: z.enum(["COUNTER", "WRITER"]) });

/**
 * POST /api/warenwirtschaft/stocktakes/[id]/sign/options – startet die
 * Bestätigung als Zähler oder Schreiber. Mit Passkey kommen die Optionen für
 * navigator.credentials.get(), sonst `{ method: "password" }`.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  if (s.adminId == null) return NextResponse.json({ error: "Bestätigen geht nur mit persönlichem Login" }, { status: 403 });
  const id = Number((await params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());

  const st = await s.db.stocktake.findFirst({
    where: { id, accountId: s.accountId },
    select: { status: true, signatures: { select: { role: true, adminId: true, name: true, contentHash: true } } },
  });
  if (!st) return notFound("Inventur");
  if (st.status !== "OPEN") return NextResponse.json({ error: "Inventur ist schon festgeschrieben" }, { status: 409 });
  const blocked = signBlockedReason(st.signatures, parsed.data.role, s.adminId);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  const options = await createSignOptions(relyingPartyFrom(request.headers), s.adminId);
  return NextResponse.json(options ? { method: "passkey", options } : { method: "password" }, { headers: { "Cache-Control": "no-store" } });
}
