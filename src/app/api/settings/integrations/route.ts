import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { z } from "zod";

const schema = z
  .object({
    provider: z.enum(["ANNY", "WAKESYS", "BINARYTEC", "EMP_CONTROL", "NUKI", "LOQED"]),
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
  EMP_CONTROL: [],
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

  const db = tenantClient(session.user.accountId!);
  const configs = await db.apiConfig.findMany({
    where: { accountId: session.user.accountId! },
    orderBy: { provider: "asc" },
  });

  return NextResponse.json(configs);
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = tenantClient(session.user.accountId!);

  const extraConfig = await prepareExtraConfig(
    db,
    session.user.accountId!,
    parsed.data.provider,
    parsed.data.extraConfig ?? null,
  );

  const existing = await db.apiConfig.findFirst({
    where: { accountId: session.user.accountId!, provider: parsed.data.provider },
  });

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
    return NextResponse.json(updated);
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

  return NextResponse.json(config, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");
  if (!provider) return NextResponse.json({ error: "Provider fehlt" }, { status: 400 });

  const db = tenantClient(session.user.accountId!);
  await db.apiConfig.deleteMany({
    where: { accountId: session.user.accountId!, provider: provider as never },
  });

  return NextResponse.json({ ok: true });
}
