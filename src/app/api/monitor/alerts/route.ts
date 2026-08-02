import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

export const maxDuration = 10;

const MAX_MESSAGE_LENGTH = 500;
const KINDS = ["TAILGATE"] as const;

/** Mehr als zwei Blickwinkel bringen auf dem Kassen-Monitor nichts mehr. */
const MAX_IMAGES = 2;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

interface IncomingImage {
  label: string | null;
  data: Uint8Array<ArrayBuffer>;
}

/**
 * Bilder kommen als Base64 im selben Aufruf statt als eigener Upload: Der
 * Monitor pollt, und ein Alarm, der kurz ohne sein Bild dasteht, waere
 * genau in dem Moment unbrauchbar, in dem man hinschaut.
 */
function parseImages(raw: unknown): IncomingImage[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return { error: "Bilder muessen eine Liste sein" };

  const out: IncomingImage[] = [];
  for (const entry of raw.slice(0, MAX_IMAGES)) {
    const o = (entry ?? {}) as Record<string, unknown>;
    if (typeof o.data !== "string" || !o.data) continue;
    const buf = Buffer.from(o.data, "base64");
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      return { error: "Kein gueltiges JPEG" };
    }
    if (buf.length > MAX_IMAGE_BYTES) {
      return { error: "Bild zu gross" };
    }
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 60) : "";
    out.push({ label: label || null, data: new Uint8Array(buf) });
  }
  return out;
}

/**
 * Nimmt eine Warnung von aussen entgegen und legt sie fuer den
 * Kassen-/Check-in-Monitor ab. Genutzt vom lokalen Kamera-Server, wenn an der
 * Drehkreuz-Kamera jemand ohne gueltigen Scan durchgeht.
 *
 * Bearer-Token des Accounts, wie bei den uebrigen Maschinen-Schnittstellen.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungueltige JSON-Daten" }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const kind = typeof o.kind === "string" ? o.kind.toUpperCase() : "";
  if (!(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json(
      { error: `Unbekannte Art (erlaubt: ${KINDS.join(", ")})` },
      { status: 400 },
    );
  }

  const message = typeof o.message === "string" ? o.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Nachricht fehlt" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Nachricht zu lang (max. ${MAX_MESSAGE_LENGTH} Zeichen)` },
      { status: 400 },
    );
  }

  const source = typeof o.source === "string" ? o.source.trim().slice(0, 120) : null;
  const parsed = typeof o.occurredAt === "string" ? new Date(o.occurredAt) : null;
  const occurredAt =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();

  const images = parseImages(o.images);
  if ("error" in images) {
    return NextResponse.json({ error: images.error }, { status: 400 });
  }

  const alert = await auth.db.monitorAlert.create({
    data: {
      accountId: auth.account.id,
      kind,
      message,
      source: source || null,
      occurredAt,
      images: {
        create: images.map((img, i) => ({
          position: i,
          label: img.label,
          image: img.data,
        })),
      },
    },
    // Ohne `select` gaebe RETURNING die eben geschriebenen JPEG-Bytes zurueck.
    select: { id: true, kind: true, message: true, occurredAt: true },
  });

  return NextResponse.json({ ok: true, alert, images: images.length });
}
