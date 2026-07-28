import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import { loqedBoltStateLabel } from "@/lib/loqed-constants";

/**
 * POST /api/integrations/loqed/webhook?secret=…
 *
 * Empfaengt die ausgehenden Webhooks von LOQED. Sie muessen auf app.loqed.com
 * unter API eingetragen werden – LOQED bietet keine Schnittstelle, um sie von
 * hier aus zu registrieren.
 *
 * Warum ueberhaupt: Der Statusabruf von LOQED ist auf zwoelf Anfragen pro Tag
 * begrenzt, danach sperrt LOQED zwoelf Stunden. Regelmaessiges Nachfragen ist
 * damit ausgeschlossen; der Zustand kommt hier herein, sobald sich etwas ruehrt.
 *
 * Die Aufrufe tragen keine Signatur. Abgesichert sind sie ueber das Geheimnis in
 * der URL – wie bei den uebrigen Anbietern, die ohne Signatur arbeiten.
 */

/** Alle Nutzlasten, die LOQED schicken kann – je Ereignisart andere Felder. */
interface LoqedWebhookPayload {
  lock_id?: string;
  /// Zustand, der erreicht wurde.
  requested_state?: string;
  /// Zustand, auf den das Schloss zufaehrt. Es kann ihn verfehlen.
  go_to_state?: string;
  event_type?: string;
  key_local_id?: number | null;
  key_name_user?: string | null;
  key_name_admin?: string | null;
  key_account_name?: string | null;
  /// Nur im Signalstaerke-Webhook.
  battery_percentage?: number;
  ble_strength?: number;
  wifi_strength?: number;
  /// Nur im Online-Webhook.
  online?: number;
}

/** LOQED schreibt die Zustaende gross, EMP fuehrt sie klein. */
function boltState(value: string | undefined | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return ["open", "day_lock", "night_lock", "unknown"].includes(lower) ? lower : null;
}

export async function POST(request: NextRequest) {
  const secret =
    request.nextUrl.searchParams.get("secret")?.trim() ||
    request.headers.get("x-webhook-secret")?.trim() ||
    null;
  if (!secret) {
    return NextResponse.json({ error: "Missing webhook secret (?secret=…)" }, { status: 401 });
  }

  const configs = await prisma.apiConfig.findMany({ where: { provider: "LOQED" } });
  const config = configs.find((c) => {
    if (!c.extraConfig) return false;
    try {
      return (JSON.parse(c.extraConfig) as Record<string, unknown>).webhookSecret === secret;
    } catch {
      return false;
    }
  });
  if (!config) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  let body: LoqedWebhookPayload;
  try {
    body = (await request.json()) as LoqedWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.lock_id) {
    return NextResponse.json({ error: "Missing lock_id in payload" }, { status: 400 });
  }

  const accountId = config.accountId;
  const db = tenantClient(accountId);
  const device = await db.device.findFirst({
    where: { accountId, type: "LOQED_SMARTLOCK", loqedLockId: body.lock_id },
  });

  const reached = boltState(body.requested_state);
  const heading = boltState(body.go_to_state);
  const keyName = body.key_name_admin ?? body.key_account_name ?? body.key_name_user ?? null;
  const now = new Date();

  if (device) {
    const existing = typeof device.systemInfo === "object" && device.systemInfo !== null
      ? (device.systemInfo as Record<string, unknown>)
      : {};
    await db.device.update({
      where: { id: device.id },
      data: {
        lastUpdate: now,
        systemInfo: {
          ...existing,
          // Nur ein erreichter Zustand beschreibt den Riegel. Eine begonnene
          // Fahrt sagt noch nichts – bei schwacher Batterie kommt das Schloss
          // unterwegs zum Stehen.
          ...(reached ? { boltState: reached } : {}),
          ...(body.battery_percentage != null ? { batteryPercentage: body.battery_percentage } : {}),
          ...(body.ble_strength != null ? { bleStrength: body.ble_strength } : {}),
          ...(body.wifi_strength != null ? { wifiStrength: body.wifi_strength } : {}),
          ...(body.online != null ? { lockOnline: body.online === 1 } : {}),
          ...(reached || heading
            ? {
                lastEvent: {
                  boltState: reached ?? heading,
                  eventType: body.event_type ?? null,
                  keyName,
                  at: now.toISOString(),
                },
              }
            : {}),
        },
      },
    });
  }

  // Nur erreichte Zustaende landen im Verlauf; sonst stuende jede Bewegung
  // doppelt darin. Ein Motorstillstand ist die Ausnahme – der gehoert gemeldet.
  const stalled = body.event_type === "MOTOR_STALL";
  if (reached || stalled) {
    await db.scan.create({
      data: {
        accountId,
        deviceId: device?.id ?? null,
        code: `loqed:${body.event_type ?? "event"}`,
        note: stalled
          ? "LOQED: Motor blockiert – Riegel steht nicht eindeutig"
          : `LOQED ${loqedBoltStateLabel(reached)}${keyName ? ` (${keyName})` : ""}`,
        scanTime: now,
        result: stalled ? "DENIED" : "GRANTED",
      },
    });
  }

  return NextResponse.json({
    ok: true,
    lockId: body.lock_id,
    matchedDevice: !!device,
    boltState: reached ?? heading ?? null,
  });
}

export async function GET() {
  return NextResponse.json({
    info:
      "LOQED webhook receiver. Diese URL auf app.loqed.com unter API als ausgehenden Webhook eintragen; " +
      "das Geheimnis steht in der Adresse.",
    events: ["STATE_CHANGED_*", "GO_TO_STATE_*", "MOTOR_STALL", "Signalstärke", "Online"],
  });
}
