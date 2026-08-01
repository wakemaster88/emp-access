import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

export const maxDuration = 10;

const MAX_MESSAGE_LENGTH = 500;
const KINDS = ["TAILGATE"] as const;

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

  const alert = await auth.db.monitorAlert.create({
    data: {
      accountId: auth.account.id,
      kind,
      message,
      source: source || null,
      occurredAt,
    },
    select: { id: true, kind: true, message: true, occurredAt: true },
  });

  return NextResponse.json({ ok: true, alert });
}
