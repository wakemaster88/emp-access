import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { attachParkingEvidence } from "@/lib/parking-violations";
import { MAX_EVIDENCE_BYTES, parseHubParkingParams } from "@/lib/parking-violations-rules";

/**
 * POST (Hub): Ausschnitt in voller Auflösung zu einer Halteverbot-Sichtung.
 * Der Hub schickt ihn nur, wenn die Antwort auf die Meldung `evidence: true`
 * enthielt; ältere Hubs rufen die Route nie auf.
 * Query: sightingId;
 *   notifyKey (Hub ab dieser Version, die Meldung trug die erste Nachricht):
 *   als zweites Bild an Telegram, genau einmal je Nachricht – auch wenn sie
 *   bei einem früheren Versuch hinausging, und auch, wenn der Ausschnitt
 *   schon in der Historie liegt (nach einer nicht zugestellten Nachricht;
 *   Antwort existed: true);
 *   telegram (0|1, ohne notifyKey): als zweites Bild an Telegram – ein
 *   älterer Hub, oder der neue Eintrag kam mit einer Erinnerung.
 * Nur wer den Ausschnitt ablegt (liegt er schon, wer die Marke der ersten
 * Nachricht setzt), schickt ihn an Telegram; ein zweiter, auch gleichzeitiger,
 * wird abgelehnt.
 * Body: rohes JPEG
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { account } = auth;

  const q = request.nextUrl.searchParams;
  const sightingId = Number(q.get("sightingId"));
  if (!Number.isInteger(sightingId) || sightingId <= 0) {
    return NextResponse.json({ error: "sightingId fehlt" }, { status: 400 });
  }

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return NextResponse.json({ error: "Kein gültiges JPEG" }, { status: 400 });
  }
  if (buf.length > MAX_EVIDENCE_BYTES) {
    return NextResponse.json({ error: "Ausschnitt zu groß" }, { status: 413 });
  }

  const result = await attachParkingEvidence({
    accountId: account.id,
    sightingId,
    jpeg: buf,
    notifyKey: parseHubParkingParams(q).notifyKey,
    telegram: q.get("telegram") === "1",
    at: new Date(),
  });
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    const error =
      result.reason === "not_found"
        ? "Sichtung nicht gefunden"
        : result.reason === "exists"
          ? "Ausschnitt schon vorhanden"
          : "Sichtung zu alt";
    return NextResponse.json({ error, reason: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, telegram: result.telegram, ...(result.existed ? { existed: true } : {}) });
}
