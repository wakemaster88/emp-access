import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const CATEGORIES = new Set([
  "DREHKREUZ",
  "TUER",
  "SENSOR",
  "SCHALTER",
  "BELEUCHTUNG",
  "AUDIO",
  "MARKISE",
  "ROLLTOR",
  "TASTER",
]);

/**
 * POST (Hub, Token-Auth): Ein im Netz gefundenes Geraet einem Raum zuordnen.
 *
 *  - `deviceId` gesetzt: vorhandenes Geraet bekommt den Raum (oder `null`).
 *  - sonst Shelly per IP + Kanal: gibt es das Geraet schon (gleiche IP und
 *    Kanal-Suffix), wird nur der Raum gesetzt, sonst wird es angelegt.
 *
 *  - `hue` gesetzt: Philips-Hue-Lampe (Bridge-ID + Lampen-ID) anlegen oder
 *    zuordnen. Geschaltet wird sie vom Hub.
 *
 * Body: { deviceId?, ip?, mac?, channel?, hue?: { bridgeId, lightId }, name?, category?, roomId: number|null }
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const roomId = body.roomId == null ? null : Number(body.roomId);
  if (roomId !== null) {
    if (!Number.isInteger(roomId)) return NextResponse.json({ error: "Ungültiger Raum" }, { status: 400 });
    const room = await db.keyRoom.findFirst({ where: { id: roomId, accountId: account.id }, select: { id: true } });
    if (!room) return NextResponse.json({ error: "Raum nicht gefunden" }, { status: 404 });
  }
  const category =
    typeof body.category === "string" && CATEGORIES.has(body.category) ? body.category : undefined;

  if (body.deviceId != null) {
    const id = Number(body.deviceId);
    const existing = await db.device.findFirst({ where: { id, accountId: account.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 404 });
    const device = await db.device.update({
      where: { id },
      data: { keyRoomId: roomId, ...(category ? { category } : {}) },
      select: { id: true, name: true, keyRoomId: true },
    });
    return NextResponse.json({ ok: true, created: false, device });
  }

  if (body.hue && typeof body.hue === "object") {
    const bridgeId = String(body.hue.bridgeId ?? "").trim().toLowerCase();
    const lightId = String(body.hue.lightId ?? "").trim();
    if (!/^[0-9a-f]{6,32}$/.test(bridgeId) || !/^\d{1,4}$/.test(lightId)) {
      return NextResponse.json({ error: "Ungültige Hue-Lampe" }, { status: 400 });
    }
    const existing = await db.device.findFirst({
      where: { accountId: account.id, type: "HUE_LIGHT", hueBridgeId: bridgeId, hueLightId: lightId },
      select: { id: true },
    });
    if (existing) {
      const device = await db.device.update({
        where: { id: existing.id },
        data: { keyRoomId: roomId, ...(category ? { category } : {}) },
        select: { id: true, name: true, keyRoomId: true },
      });
      return NextResponse.json({ ok: true, created: false, device });
    }
    const hueName =
      typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : `Hue Lampe ${lightId}`;
    const device = await db.device.create({
      data: {
        accountId: account.id,
        name: hueName,
        type: "HUE_LIGHT",
        category: category ?? "BELEUCHTUNG",
        hueBridgeId: bridgeId,
        hueLightId: lightId,
        keyRoomId: roomId,
      },
      select: { id: true, name: true, keyRoomId: true },
    });
    return NextResponse.json({ ok: true, created: true, device });
  }

  const ip = String(body.ip ?? "").trim();
  if (!IPV4_RE.test(ip)) return NextResponse.json({ error: "Ungültige IP" }, { status: 400 });
  const channel = Number.isInteger(Number(body.channel)) ? Math.max(0, Number(body.channel)) : 0;
  const mac = String(body.mac ?? "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  // Shelly-ID wie aus der Shelly Cloud: Geraete-ID (MAC) plus "_<Kanal+1>" ab
  // dem zweiten Kanal. So passt sie zu `shellySwitchIndex` in Cloud und Hub.
  const shellyId = mac.length === 12 ? (channel > 0 ? `${mac}_${channel + 1}` : mac) : null;

  const candidates = await db.device.findMany({
    where: { accountId: account.id, type: "SHELLY", ipAddress: ip },
    select: { id: true, shellyId: true },
  });
  const sameChannel = candidates.find((d) => {
    const suffix = d.shellyId?.includes("_") ? Number(d.shellyId.split("_").pop()) : 0;
    const ch = Number.isFinite(suffix) && suffix > 0 ? suffix - 1 : 0;
    return ch === channel;
  });

  if (sameChannel) {
    const device = await db.device.update({
      where: { id: sameChannel.id },
      data: { keyRoomId: roomId, ...(category ? { category } : {}) },
      select: { id: true, name: true, keyRoomId: true },
    });
    return NextResponse.json({ ok: true, created: false, device });
  }

  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : `Shelly ${ip}`;
  const device = await db.device.create({
    data: {
      accountId: account.id,
      name,
      type: "SHELLY",
      category: category ?? "SCHALTER",
      ipAddress: ip,
      shellyId,
      keyRoomId: roomId,
    },
    select: { id: true, name: true, keyRoomId: true },
  });
  return NextResponse.json({ ok: true, created: true, device });
}
