import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import {
  inferAccessKind,
  pushEmpAccessExternal,
} from "@/lib/emp-access-runtime";

export const dynamic = "force-dynamic";

/**
 * Optionaler Push-Endpoint für emp-access (oder ein Skript bei dir lokal),
 * damit Drehkreuz-Scans **sofort** als Event in der App erscheinen statt erst
 * beim nächsten Poll-Tick.
 *
 * Authentifizierung: `?secret=…` ODER Header `X-EmpAccess-Webhook-Secret`.
 * Das Secret steht unter Einstellungen → emp-access (wird automatisch
 * generiert, sobald ein Webhook eingetragen wird).
 *
 * Erwarteter Body (flexibel, kommt aus emp-access oder einem eigenen Adapter):
 *   {
 *     "deviceId": 1,                   // Pflicht
 *     "kind": "valid"|"invalid"|"info" // optional, sonst Heuristik
 *     "summary": "Scan am Drehkreuz",  // optional
 *     "detail": "Karte 12345",         // optional
 *     "device": { ... }                // optional Rohdaten für Heuristik
 *   }
 */

interface IncomingBody {
  deviceId?: number | string;
  kind?: string;
  summary?: string;
  detail?: string;
  device?: Record<string, unknown>;
  status?: string;
  granted?: boolean;
  accessGranted?: boolean;
}

function isKind(x: string | undefined): x is "valid" | "invalid" | "info" {
  return x === "valid" || x === "invalid" || x === "info";
}

async function authorized(req: Request, expected: string): Promise<boolean> {
  if (!expected) return false;
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("secret")?.trim();
  if (fromQuery && fromQuery === expected) return true;
  const fromHeader =
    req.headers.get("x-empaccess-webhook-secret")?.trim() ||
    req.headers.get("x-emp-access-webhook-secret")?.trim();
  return !!fromHeader && fromHeader === expected;
}

export async function POST(req: Request) {
  const cfg = await loadConfig();
  const expected = cfg.settings.empAccess.webhookSecret?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Webhook nicht konfiguriert" },
      { status: 503 },
    );
  }
  if (!(await authorized(req, expected))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: IncomingBody;
  try {
    body = (await req.json()) as IncomingBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  const deviceIdNum = Number(body.deviceId);
  if (!Number.isInteger(deviceIdNum) || deviceIdNum <= 0) {
    return NextResponse.json(
      { ok: false, error: "deviceId fehlt oder ungültig" },
      { status: 400 },
    );
  }

  const kind = isKind(body.kind)
    ? body.kind
    : inferAccessKind({
        ...(body.device ?? {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.granted !== undefined ? { granted: body.granted } : {}),
        ...(body.accessGranted !== undefined
          ? { accessGranted: body.accessGranted }
          : {}),
      });

  const summary =
    body.summary?.trim() ||
    (kind === "valid"
      ? `Zugang OK · Gerät #${deviceIdNum}`
      : kind === "invalid"
        ? `Zugang abgelehnt · Gerät #${deviceIdNum}`
        : `Scan · Gerät #${deviceIdNum}`);

  const res = await pushEmpAccessExternal({
    deviceId: deviceIdNum,
    kind,
    summary,
    detail: body.detail?.trim() || undefined,
  });

  return NextResponse.json({ ok: true, matched: res.matched, kind });
}
