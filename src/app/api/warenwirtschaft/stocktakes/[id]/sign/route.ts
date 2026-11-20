import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { badRequest, notFound, stocktakeSignSchema, wawiSession } from "@/lib/warenwirtschaft-server";
import { hasPasskey, relyingPartyFrom, verifyPasskeySignature } from "@/lib/passkey";
import { hitLoginThrottle } from "@/lib/login-throttle";
import { prisma } from "@/lib/prisma";
import { ROLE_LABEL, signBlockedReason } from "@/lib/stocktake-log";
import { logEvents, stocktakeHash, voidSignatures } from "@/lib/stocktake-audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Digitale Bestätigung einer offenen Inventur – ersetzt die Unterschrift von
 * Zähler und Schreiber auf Papier.
 *   POST   { role, response | password } – bestätigen
 *   DELETE ?role=COUNTER|WRITER         – eigene Bestätigung zurückziehen
 *
 * Gespeichert werden Login, Name, E-Mail, Verfahren, Zeit und die Prüfsumme
 * der Zählliste. Zähler und Schreiber müssen verschiedene Personen sein.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const adminId = s.adminId;
  if (adminId == null) return NextResponse.json({ error: "Bestätigen geht nur mit persönlichem Login" }, { status: 403 });
  const id = Number((await params).id);
  const parsed = stocktakeSignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const { role } = parsed.data;

  const throttle = hitLoginThrottle(`stocktake-sign|${adminId}`);
  if (!throttle.allowed) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte gleich noch einmal probieren." }, { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } });
  }

  const actor = { name: s.userName, adminId, via: "app" as const };
  const st = await s.db.stocktake.findFirst({ where: { id, accountId: s.accountId }, select: { status: true } });
  if (!st) return notFound("Inventur");
  if (st.status !== "OPEN") return NextResponse.json({ error: "Inventur ist schon festgeschrieben" }, { status: 409 });

  // Veraltete Bestätigungen (Liste danach geändert) vorher aufräumen.
  await voidSignatures(s.db, id, s.accountId, actor, true);
  const signatures = await s.db.stocktakeSignature.findMany({
    where: { stocktakeId: id, accountId: s.accountId },
    select: { role: true, adminId: true, name: true, contentHash: true },
  });
  const blocked = signBlockedReason(signatures, role, adminId);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  let method: "passkey" | "password";
  if (parsed.data.response !== undefined) {
    const ok = await verifyPasskeySignature(relyingPartyFrom(request.headers), adminId, parsed.data.response);
    if (!ok) return NextResponse.json({ error: "Passkey nicht bestätigt. Bitte erneut versuchen." }, { status: 403 });
    method = "passkey";
  } else {
    // Passwort nur, wenn kein Passkey eingerichtet ist (sonst ist Passkey Pflicht).
    if (await hasPasskey(adminId)) return NextResponse.json({ error: "Bitte mit deinem Passkey bestätigen" }, { status: 400 });
    const admin = await prisma.admin.findUnique({ where: { id: adminId }, select: { password: true } });
    const password = parsed.data.password ?? "";
    if (!admin || password.length === 0 || !(await compare(password, admin.password))) {
      return NextResponse.json({ error: "Passwort ist falsch" }, { status: 403 });
    }
    method = "password";
  }

  const contentHash = await stocktakeHash(s.db, id, s.accountId);
  try {
    await s.db.stocktakeSignature.create({
      data: { accountId: s.accountId, stocktakeId: id, role, adminId, name: s.userName.slice(0, 120), email: s.email, method, contentHash },
    });
  } catch {
    return NextResponse.json({ error: `Die Zählung ist als ${ROLE_LABEL[role]} schon bestätigt.` }, { status: 409 });
  }
  await logEvents(s.db, id, s.accountId, actor, [{ type: "SIGNED", note: `${ROLE_LABEL[role]} (${method === "passkey" ? "Passkey" : "Passwort"})` }]);
  return NextResponse.json({ ok: true, method, contentHash });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const role = request.nextUrl.searchParams.get("role");
  if (role !== "COUNTER" && role !== "WRITER") return badRequest("role fehlt");
  const st = await s.db.stocktake.findFirst({ where: { id, accountId: s.accountId }, select: { status: true } });
  if (!st) return notFound("Inventur");
  if (st.status !== "OPEN") return NextResponse.json({ error: "Inventur ist schon festgeschrieben" }, { status: 409 });
  const res = await s.db.stocktakeSignature.deleteMany({ where: { stocktakeId: id, accountId: s.accountId, role, adminId: s.adminId ?? -1 } });
  if (res.count === 0) return NextResponse.json({ error: "Nur die eigene Bestätigung lässt sich zurückziehen" }, { status: 403 });
  await logEvents(s.db, id, s.accountId, { name: s.userName, adminId: s.adminId, via: "app" }, [
    { type: "SIGNATURE_VOID", note: `Bestätigung als ${ROLE_LABEL[role]} von ${s.userName} zurückgezogen` },
  ]);
  return NextResponse.json({ ok: true });
}
