import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { adminRoleRequired } from "@/lib/api-auth";
import { z } from "zod";
import {
  MASK_EDIT_ERROR,
  hasEditedMaskInExtraConfig,
  isEditedMask,
  keepStoredIfMasked,
  maskApiConfig,
  restoreMaskedExtraConfig,
} from "@/lib/secret-mask";

/** Anbieter, bei denen das Token optional ist; ein leeres Feld entfernt es dort wie bisher. */
const TOKEN_OPTIONAL = new Set(["WAKESYS", "EMP_CONTROL"]);

const providerSchema = z.enum(["ANNY", "WAKESYS", "BINARYTEC", "EMP_CONTROL", "NUKI", "LOQED", "EMP_SHOP"]);

const schema = z
  .object({
    provider: providerSchema,
    token: z.string(),
    eventId: z.string().optional().nullable(),
    baseUrl: z.string().url().optional().nullable().or(z.literal("")),
    extraConfig: z.string().optional().nullable(),
  })
  .refine((data) => data.provider !== "WAKESYS" || data.baseUrl?.trim(), {
    message: "Base URL ist für Wakesys erforderlich",
    path: ["baseUrl"],
  })
  .refine((data) => data.provider === "WAKESYS" || data.provider === "EMP_CONTROL" || data.token.trim().length > 0, {
    message: "API Token ist erforderlich",
    path: ["token"],
  });

async function getSession(req: NextRequest) {
  const session = await safeAuth();
  if (!session?.user || !session.user.accountId) return null;
  return session;
}

/**
 * Anbieter, die uns per Webhook zurueckrufen. Ihre Rueckrufe tragen kein
 * signiertes Kennzeichen, deshalb steht ein Geheimnis in der URL – nur damit
 * kommt ein Aufruf durch. Der Wert wird beim ersten Speichern erzeugt.
 *
 * Der Wert der Zuordnung nennt weitere Angaben aus `extraConfig`, die beim
 * Speichern nicht verloren gehen duerfen.
 */
const WEBHOOK_PROVIDERS: Record<string, readonly string[]> = {
  // Live-Monitor-Link fuer „Wer arbeitet gerade?“ (Hub, src/lib/emp-control-live.ts).
  EMP_CONTROL: ["monitorUrl"],
  ANNY: [],
  // Kennzeichen der bei Nuki registrierten Benachrichtigung – sonst legt der
  // naechste Abgleich dort eine zweite an.
  NUKI: ["notificationId"],
  LOQED: [],
};

/**
 * `extraConfig` fuer das Speichern vorbereiten: Webhook-Geheimnis erzeugen,
 * falls noch keines existiert, und bereits gespeicherte Angaben uebernehmen,
 * die die Oberflaeche nicht mitschickt.
 */
async function prepareExtraConfig(
  db: ReturnType<typeof tenantClient>,
  accountId: number,
  provider: string,
  raw: string | null,
): Promise<string | null> {
  const carryOver = WEBHOOK_PROVIDERS[provider];
  if (!carryOver) return raw;

  let extra: Record<string, unknown> = {};
  try {
    if (raw) extra = JSON.parse(raw) as Record<string, unknown>;
  } catch { /* unlesbares JSON wird durch einen frischen Satz ersetzt */ }

  const existing = await db.apiConfig.findFirst({ where: { accountId, provider: provider as never } });
  if (existing?.extraConfig) {
    try {
      const stored = JSON.parse(existing.extraConfig) as Record<string, unknown>;
      for (const key of ["webhookSecret", ...carryOver]) {
        if (stored[key] !== undefined && extra[key] === undefined) extra[key] = stored[key];
      }
    } catch { /* unlesbares JSON in der Datenbank ignorieren */ }
  }

  if (typeof extra.webhookSecret !== "string" || extra.webhookSecret.length === 0) {
    extra.webhookSecret = randomBytes(32).toString("hex");
  }
  return JSON.stringify(extra);
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Schnittstellen-Tokens und Webhook-Secrets: nur fuer Admins, auch lesend.
  const denied = adminRoleRequired(session.user.role);
  if (denied) return denied;

  const db = tenantClient(session.user.accountId!);
  // Nur die Anbieter der Integrationskarten; SHELLY und GARDENA haben eigene
  // Einstellungen und Routen.
  const configs = await db.apiConfig.findMany({
    where: { accountId: session.user.accountId!, provider: { in: providerSchema.options } },
    orderBy: { provider: "asc" },
  });

  // Token und Geheimnisse gehen nur maskiert an den Browser; das Webhook-
  // Geheimnis liefert bei Bedarf ./reveal.
  return NextResponse.json(configs.map(maskApiConfig));
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Schnittstellen-Tokens und Webhook-Secrets: nur fuer Admins, auch lesend.
  const denied = adminRoleRequired(session.user.role);
  if (denied) return denied;

  const body = await req.json();
  const db = tenantClient(session.user.accountId!);

  // Maskierte Werte (und beim Pflicht-Token ein leeres Feld) heißen
  // „unverändert“: gespeicherte Werte wieder einsetzen, bevor geprüft wird.
  const provider = providerSchema.safeParse(body?.provider);
  const existing = provider.success
    ? await db.apiConfig.findFirst({ where: { accountId: session.user.accountId!, provider: provider.data } })
    : null;
  if (
    body && typeof body === "object" &&
    (isEditedMask(body.token, existing?.token) ||
      (typeof body.extraConfig === "string" && hasEditedMaskInExtraConfig(body.extraConfig, existing?.extraConfig)))
  ) {
    return NextResponse.json({ error: MASK_EDIT_ERROR }, { status: 400 });
  }
  if (existing && body && typeof body === "object") {
    if (typeof body.token === "string") {
      body.token = keepStoredIfMasked(body.token, existing.token);
      if (!body.token.trim() && !TOKEN_OPTIONAL.has(existing.provider)) body.token = existing.token;
    }
    if (typeof body.extraConfig === "string") {
      body.extraConfig = restoreMaskedExtraConfig(body.extraConfig, existing.extraConfig);
    }
  } else if (body && typeof body === "object" && typeof body.token === "string") {
    // Ohne gespeicherten Datensatz gibt es nichts einzusetzen.
    body.token = keepStoredIfMasked(body.token, "");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const extraConfig = await prepareExtraConfig(
    db,
    session.user.accountId!,
    parsed.data.provider,
    parsed.data.extraConfig ?? null,
  );

  if (existing) {
    const updated = await db.apiConfig.update({
      where: { id: existing.id },
      data: {
        token: parsed.data.token,
        eventId: parsed.data.eventId ?? null,
        baseUrl: parsed.data.baseUrl || null,
        extraConfig,
        lastUpdate: new Date(),
      },
    });
    return NextResponse.json(maskApiConfig(updated));
  }

  const config = await db.apiConfig.create({
    data: {
      accountId: session.user.accountId!,
      provider: parsed.data.provider,
      token: parsed.data.token,
      eventId: parsed.data.eventId ?? null,
      baseUrl: parsed.data.baseUrl || null,
      extraConfig,
    },
  });

  return NextResponse.json(maskApiConfig(config), { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Schnittstellen-Tokens und Webhook-Secrets: nur fuer Admins, auch lesend.
  const denied = adminRoleRequired(session.user.role);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");
  if (!provider) return NextResponse.json({ error: "Provider fehlt" }, { status: 400 });

  const db = tenantClient(session.user.accountId!);
  await db.apiConfig.deleteMany({
    where: { accountId: session.user.accountId!, provider: provider as never },
  });

  return NextResponse.json({ ok: true });
}
