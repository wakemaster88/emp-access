/**
 * Ton einer Live-Durchsage für den Zonen-Pi.
 *
 * GET ?id=<deviceId>&session=<sessionId>&after=<seq>
 *
 * Liefert alle Stücke nach `after` am Stück als rohes PCM (16 Bit
 * little-endian, mono). Ohne `after` steigt der Pi beim neuesten Stück ein,
 * statt die Durchsage von vorn nachzuspielen. Liegt noch nichts Neues vor,
 * wartet die Anfrage kurz, damit der Pi nicht im Leerlauf pollt.
 *
 * Header:
 *   X-Live-State  LIVE | ENDED – ENDED erst, wenn auch alles ausgeliefert ist
 *   X-Live-Seq    Nummer des letzten gelieferten Stücks (nächstes `after`)
 *   X-Live-Rate   Abtastrate
 */
import { NextRequest, NextResponse } from "next/server";
import { deviceTokenMismatch, validateApiToken } from "@/lib/api-auth";
import { endLiveSession } from "@/lib/audio";
import { isLiveSessionOpen } from "@/lib/audio-live";

/** Wie lange eine Anfrage auf neuen Ton wartet (Function-Limit: 10 s). */
const WAIT_MS = 3_000;
const WAIT_STEP_MS = 200;
/** Stücke pro Antwort – mehr würde nur einen stark verspäteten Pi füttern. */
const MAX_CHUNKS = 50;

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request, { allowDevice: true });
  if ("error" in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const deviceId = Number(params.get("id"));
  const sessionId = Number(params.get("session"));
  const afterParam = params.get("after");
  const requestedAfter = afterParam === null ? null : Number(afterParam);
  if (
    !Number.isInteger(deviceId) ||
    !Number.isInteger(sessionId) ||
    (requestedAfter !== null && (!Number.isInteger(requestedAfter) || requestedAfter < 0))
  ) {
    return NextResponse.json({ error: "id, session und after müssen Zahlen sein" }, { status: 400 });
  }
  const mismatch = deviceTokenMismatch(auth, deviceId);
  if (mismatch) return mismatch;

  const { db } = auth;
  // Nur Zonen, an die die Durchsage ging, dürfen mithören.
  const job = await db.audioJob.findFirst({
    where: { liveSessionId: sessionId, kind: "LIVE", zone: { deviceId } },
    select: { id: true },
  });
  if (!job) return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });

  const deadline = Date.now() + WAIT_MS;
  let after = requestedAfter;

  for (;;) {
    const live = await db.audioLiveSession.findUnique({
      where: { id: sessionId },
      select: { status: true, lastSeq: true, lastChunkAt: true, startedAt: true, sampleRate: true },
    });
    if (!live) return NextResponse.json({ error: "Sitzung nicht gefunden" }, { status: 404 });

    const now = new Date();
    const open = isLiveSessionOpen(live, now);
    if (!open && live.status === "LIVE") await endLiveSession(db, sessionId, now);

    // Einstieg: nur das neueste Stück, damit der Pi mit dem anfängt, was gerade
    // gesprochen wird.
    if (after === null) after = Math.max(0, live.lastSeq - 1);

    if (live.lastSeq > after) {
      const chunks = await db.audioLiveChunk.findMany({
        where: { sessionId, seq: { gt: after } },
        orderBy: { seq: "asc" },
        take: MAX_CHUNKS,
        select: { seq: true, data: true },
      });
      if (chunks.length > 0) {
        const lastSeq = chunks[chunks.length - 1].seq;
        const drained = !open && lastSeq >= live.lastSeq;
        return pcmResponse(Buffer.concat(chunks.map((c) => c.data)), {
          state: drained ? "ENDED" : "LIVE",
          seq: lastSeq,
          rate: live.sampleRate,
        });
      }
      // Schon weggeräumt – der Pi war zu lange weg, er macht beim Neuesten weiter.
      after = live.lastSeq;
    }

    if (!open || Date.now() + WAIT_STEP_MS > deadline) {
      return pcmResponse(Buffer.alloc(0), {
        state: open ? "LIVE" : "ENDED",
        seq: after,
        rate: live.sampleRate,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

function pcmResponse(body: Buffer, meta: { state: "LIVE" | "ENDED"; seq: number; rate: number }) {
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Live-State": meta.state,
      "X-Live-Seq": String(meta.seq),
      "X-Live-Rate": String(meta.rate),
    },
  });
}
