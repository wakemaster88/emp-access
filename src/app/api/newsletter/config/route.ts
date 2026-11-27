import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { loadNewsletterConfig } from "@/lib/newsletter/service";
import { syncAnnyAboGroup } from "@/lib/newsletter/groups";
import { isConfigurationSetName, isPlainEmail, isSnsTopicArn } from "@/lib/newsletter/rules";
import { prisma } from "@/lib/prisma";

/** Einstellungen des Newsletters ändern (nur Admins). Der Schlüssel der Links bleibt unberührt. */
export async function PUT(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const body = await readRequestBody(request);
  if (!body) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });

  const data: Record<string, unknown> = {};
  const text = (key: string, max: number): string | null | undefined => {
    if (!(key in body)) return undefined;
    const v = body[key];
    if (v === null || v === "") return null;
    if (typeof v !== "string") throw new Error(`${key} ist ungültig`);
    const t = v.trim();
    if (t.length > max) throw new Error(`${key} ist zu lang`);
    return t || null;
  };

  try {
    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") throw new Error("enabled ist ungültig");
      data.enabled = body.enabled;
    }
    if ("annyAutoSubscribe" in body) {
      if (typeof body.annyAutoSubscribe !== "boolean") throw new Error("annyAutoSubscribe ist ungültig");
      data.annyAutoSubscribe = body.annyAutoSubscribe;
    }
    const fromEmail = text("fromEmail", 180);
    if (fromEmail !== undefined) {
      if (fromEmail && !isPlainEmail(fromEmail.toLowerCase())) throw new Error("Absender ist keine gültige Adresse");
      data.fromEmail = fromEmail?.toLowerCase() ?? null;
    }
    const fromName = text("fromName", 80);
    if (fromName !== undefined) data.fromName = fromName;
    const replyTo = text("replyTo", 180);
    if (replyTo !== undefined) {
      if (replyTo && !isPlainEmail(replyTo.toLowerCase())) throw new Error("Antwortadresse ist keine gültige Adresse");
      data.replyTo = replyTo?.toLowerCase() ?? null;
    }
    const configurationSet = text("configurationSet", 64);
    if (configurationSet !== undefined) {
      if (configurationSet && !isConfigurationSetName(configurationSet)) throw new Error("Name des Konfigurationssatzes ist ungültig");
      data.configurationSet = configurationSet;
    }
    const snsTopicArn = text("snsTopicArn", 300);
    if (snsTopicArn !== undefined) {
      if (snsTopicArn && !isSnsTopicArn(snsTopicArn)) throw new Error("SNS-Thema: Bitte die ARN (arn:aws:sns:…) eintragen");
      data.snsTopicArn = snsTopicArn;
    }
    const linkBaseUrl = text("linkBaseUrl", 300);
    if (linkBaseUrl !== undefined) {
      if (linkBaseUrl && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(linkBaseUrl)) throw new Error("Link-Adresse muss mit https:// beginnen");
      data.linkBaseUrl = linkBaseUrl?.replace(/\/+$/, "") ?? null;
    }
    const consentText = text("consentText", 2_000);
    if (consentText !== undefined) data.consentText = consentText;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Ungültige Anfrage" }, { status: 400 });
  }

  if (data.snsTopicArn) {
    const taken = await prisma.newsletterConfig.findFirst({
      where: { snsTopicArn: data.snsTopicArn as string, accountId: { not: auth.accountId } },
      select: { id: true },
    });
    if (taken) return NextResponse.json({ error: "Dieses SNS-Thema nutzt schon ein anderer Mandant" }, { status: 409 });
  }

  await loadNewsletterConfig(auth.accountId);
  const updated = await auth.db.newsletterConfig.update({ where: { accountId: auth.accountId }, data });
  // Eingeschaltet: Gruppe „Abos aus anny“ gleich füllen, nicht erst in einer Stunde.
  const annySync = data.annyAutoSubscribe === true ? await syncAnnyAboGroup(auth.accountId) : null;
  const { tokenSecret: _secret, ...safe } = updated;
  void _secret;
  return NextResponse.json({ ...safe, annySync });
}
