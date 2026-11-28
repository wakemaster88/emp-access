/**
 * Ton einer Live-Durchsage für die Abspieler einer Zone: Audio-Pi
 * (`/api/devices/audio/live`) und Monitor im Browser
 * (`/api/monitor-audio/[token]/live`).
 *
 * Liefert alle Stücke nach `after` am Stück als rohes PCM (16 Bit
 * little-endian, mono). Ohne `after` steigt der Abspieler beim neuesten Stück
 * ein, statt die Durchsage von vorn nachzuspielen. Liegt noch nichts Neues vor,
 * wartet die Anfrage kurz, damit der Abspieler nicht im Leerlauf pollt.
 *
 * Header der Antwort:
 *   X-Live-State  LIVE | ENDED – ENDED erst, wenn auch alles ausgeliefert ist
 *   X-Live-Seq    Nummer des letzten gelieferten Stücks (nächstes `after`)
 *   X-Live-Rate   Abtastrate
 */
import { NextResponse } from "next/server";
import type { TenantDb } from "@/lib/prisma";
import { endLiveSession } from "@/lib/audio";
import { isLiveSessionOpen } from "@/lib/audio-live";

/** Wie lange eine Anfrage auf neuen Ton wartet (Function-Limit: 10 s). */
const WAIT_MS = 3_000;
const WAIT_STEP_MS = 200;
/** Stücke pro Antwort – mehr würde nur einen stark verspäteten Abspieler füttern. */
const MAX_CHUNKS = 50;

/**
 * Antwort mit dem nächsten Ton der Sitzung; null, wenn es die Sitzung nicht
 * gibt. Ob der Abspieler sie hören darf, prüft der Aufrufer vorher.
 */
export async function liveAudioResponse(
  db: TenantDb,
  sessionId: number,
  requestedAfter: number | null
): Promise<NextResponse | null> {
  const deadline = Date.now() + WAIT_MS;
  let after = requestedAfter;

  for (;;) {
    const live = await db.audioLiveSession.findUnique({
      where: { id: sessionId },
      select: { status: true, lastSeq: true, lastChunkAt: true, startedAt: true, sampleRate: true },
    });
    if (!live) return null;

    const now = new Date();
    const open = isLiveSessionOpen(live, now);
    if (!open && live.status === "LIVE") await endLiveSession(db, sessionId, now);

    // Einstieg: nur das neueste Stück, damit der Abspieler mit dem anfängt,
    // was gerade gesprochen wird.
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
      // Schon weggeräumt – der Abspieler war zu lange weg, er macht beim
      // Neuesten weiter.
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

/** `after` aus der Anfrage: null ohne Angabe, NaN bei Unsinn. */
export function parseLiveAfter(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
}
