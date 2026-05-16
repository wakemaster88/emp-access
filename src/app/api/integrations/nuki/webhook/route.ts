import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import { nukiStateLabel, nukiTriggerLabel } from "@/lib/nuki";

/**
 * Nuki Webhook ("Notification") Empfaenger.
 *
 * Nuki sendet bei abonnierten Triggern (DeviceStatus, DeviceLogs, …) ein
 * POST mit JSON-Body. Authentifizierung erfolgt ueber das in der URL
 * mitgegebene `secret` (gleich wie ANNY/EMP_CONTROL – Nuki erlaubt keine
 * Custom-Header).
 *
 * Wir uebersetzen jedes Event in einen Scan-Eintrag (`code` = trigger-Label,
 * `result` = GRANTED bei erfolgreicher Action, sonst DENIED) und aktualisieren
 * den State im verknuepften Device.
 *
 * Beispiel-Payload (Auszug):
 *   {
 *     "smartlockId": 12345,
 *     "deviceType": 4,
 *     "state": 3,
 *     "trigger": 4,
 *     "auth": { "id": "...", "name": "Daniel" },
 *     "action": 1,
 *     "date": "2026-05-16T08:32:11Z"
 *   }
 */

interface NukiWebhookPayload {
  smartlockId?: number | string;
  smartLockId?: number | string;
  deviceType?: number;
  state?: number;
  stateName?: string;
  trigger?: number;
  triggerName?: string;
  action?: number;
  auth?: { id?: string; name?: string } | string;
  authId?: string;
  authName?: string;
  date?: string;
  timestamp?: string;
  batteryCritical?: boolean;
  batteryCharge?: number;
}

function pickSmartlockId(body: NukiWebhookPayload): string | null {
  const raw = body.smartlockId ?? body.smartLockId;
  if (raw == null) return null;
  return String(raw);
}

function pickAuthName(body: NukiWebhookPayload): string | null {
  if (body.authName) return body.authName;
  if (typeof body.auth === "string") return body.auth;
  if (body.auth && typeof body.auth === "object" && body.auth.name) return body.auth.name;
  return null;
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-webhook-secret");
  const secretParam = request.nextUrl.searchParams.get("secret");

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : secretHeader?.trim() || secretParam?.trim() || null;

  if (!token) {
    return NextResponse.json(
      { error: "Missing webhook secret (?secret=…, Authorization Bearer or X-Webhook-Secret)" },
      { status: 401 },
    );
  }

  const configs = await prisma.apiConfig.findMany({
    where: { provider: "NUKI" },
  });

  let config: (typeof configs)[0] | null = null;
  for (const c of configs) {
    if (!c.extraConfig) continue;
    try {
      const extra = JSON.parse(c.extraConfig) as Record<string, unknown>;
      if (extra.webhookSecret === token) {
        config = c;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!config) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const accountId = config.accountId;
  const db = tenantClient(accountId);

  let body: NukiWebhookPayload;
  try {
    body = (await request.json()) as NukiWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const smartlockId = pickSmartlockId(body);
  if (!smartlockId) {
    return NextResponse.json({ error: "Missing smartlockId in payload" }, { status: 400 });
  }

  const device = await db.device.findFirst({
    where: { accountId, type: "NUKI_SMARTLOCK", nukiSmartlockId: smartlockId },
  });

  const stateLabel = body.stateName ?? nukiStateLabel(body.state);
  const triggerLabel = body.triggerName ?? nukiTriggerLabel(body.trigger);
  const authName = pickAuthName(body);
  const eventDate = body.date ?? body.timestamp ?? null;
  const scanTime = eventDate ? new Date(eventDate) : new Date();

  // Ein Event ist "erfolgreicher Zutritt", wenn der State unlatched (5) oder
  // unlocked (3) ist und kein motor-blocked/undefined.
  const isAccess = body.state === 3 || body.state === 5 || body.state === 6;
  const isBlocked = body.state === 254 || body.state === 255;
  const result = isBlocked ? "DENIED" : isAccess ? "GRANTED" : "GRANTED";

  if (device) {
    await db.device.update({
      where: { id: device.id },
      data: {
        lastUpdate: new Date(),
        systemInfo: {
          ...(typeof device.systemInfo === "object" && device.systemInfo !== null
            ? (device.systemInfo as Record<string, unknown>)
            : {}),
          lastEvent: {
            state: body.state ?? null,
            stateLabel,
            trigger: body.trigger ?? null,
            triggerLabel,
            authName,
            at: scanTime.toISOString(),
          },
          ...(body.batteryCharge != null ? { batteryCharge: body.batteryCharge } : {}),
          ...(body.batteryCritical != null ? { batteryCritical: body.batteryCritical } : {}),
        },
      },
    });
  }

  // Scan-Log – auch wenn das Device (noch) nicht angelegt ist, behalten wir
  // den Event, damit nichts verloren geht.
  await db.scan.create({
    data: {
      accountId,
      deviceId: device?.id ?? null,
      code: `nuki:${triggerLabel}`,
      note:
        `Nuki ${stateLabel} via ${triggerLabel}` +
        (authName ? ` (${authName})` : "") +
        (body.action != null ? ` [action=${body.action}]` : ""),
      scanTime,
      result,
    },
  });

  return NextResponse.json({
    ok: true,
    smartlockId,
    matchedDevice: !!device,
    state: stateLabel,
    trigger: triggerLabel,
  });
}

export async function GET() {
  return NextResponse.json({
    info: "Nuki webhook receiver. Configure this URL in Nuki Web (Notifications) – the secret is included in the URL query string.",
    triggers: ["DeviceStatus", "DeviceConfig", "Settings", "DeviceLogs"],
  });
}
