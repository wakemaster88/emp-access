import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { loadSendContext, sendConfirmMail } from "@/lib/newsletter/service";
import { sesErrorText } from "@/lib/newsletter/ses";

type Params = { params: Promise<{ id: string }> };

/**
 * { action: "unsubscribe" } meldet ab (z. B. auf Wunsch per Telefon),
 * { action: "resend" } schickt die Bestätigungsmail erneut.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const body = await readRequestBody(request);
  const subscriber = await auth.db.newsletterSubscriber.findFirst({ where: { id, accountId: auth.accountId } });
  if (!subscriber) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  if (body?.action === "unsubscribe") {
    if (subscriber.status !== "ACTIVE" && subscriber.status !== "PENDING") {
      return NextResponse.json({ error: "Diese Adresse ist nicht angemeldet" }, { status: 409 });
    }
    await auth.db.newsletterSubscriber.update({
      where: { id },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), unsubscribeReason: "verwaltung" },
    });
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "resend") {
    if (subscriber.status !== "PENDING") {
      return NextResponse.json({ error: "Nur offene Anmeldungen bekommen eine Bestätigungsmail" }, { status: 409 });
    }
    const ctx = await loadSendContext(auth.accountId);
    if (ctx.gaps.length) return NextResponse.json({ error: `Versand nicht bereit: ${ctx.gaps.join(", ")}` }, { status: 409 });
    try {
      await sendConfirmMail(ctx, subscriber);
    } catch (err) {
      return NextResponse.json({ error: sesErrorText(err) }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
}

/** Adresse samt Versandprotokoll löschen (Recht auf Löschung). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const r = await auth.db.newsletterSubscriber.deleteMany({ where: { id, accountId: auth.accountId } });
  if (r.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
