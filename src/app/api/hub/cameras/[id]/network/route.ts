import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * POST (Hub, Token-Auth): Netzwerk-Daten einer Kamera aktualisieren.
 * Der Hub lernt die MAC-Adresse beim ersten erfolgreichen Kontakt und
 * meldet eine neue IP, wenn er die Kamera per MAC-Abgleich (ARP-Scan)
 * unter anderer Adresse wiederfindet (DHCP-Wechsel).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const { id } = await params;
  const cameraId = Number(id);
  if (isNaN(cameraId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id },
    select: { id: true, name: true, host: true, macAddress: true },
  });
  if (!camera) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    macAddress?: unknown;
    host?: unknown;
  };

  const data: { macAddress?: string; host?: string } = {};

  if (body.macAddress !== undefined) {
    const mac = String(body.macAddress).toUpperCase();
    if (!MAC_RE.test(mac)) {
      return NextResponse.json({ error: "Ungültige MAC-Adresse" }, { status: 400 });
    }
    data.macAddress = mac;
  }

  if (body.host !== undefined) {
    const host = String(body.host).trim();
    if (!IP_RE.test(host)) {
      return NextResponse.json({ error: "Ungültige IP-Adresse" }, { status: 400 });
    }
    data.host = host;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "macAddress oder host erforderlich" }, { status: 400 });
  }

  await db.camera.update({ where: { id: cameraId }, data });

  if (data.host && data.host !== camera.host) {
    console.log(
      `[hub-network] Kamera "${camera.name}" (#${cameraId}): IP ${camera.host} → ${data.host} (MAC-Re-Mapping)`
    );
  }

  return NextResponse.json({ ok: true, ...data });
}
