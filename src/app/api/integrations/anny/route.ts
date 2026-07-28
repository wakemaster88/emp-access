import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { syncAnnyForAccount } from "@/lib/anny-sync";

// Gleiches Zeitbudget wie der Cron - ein manuell ausgeloester Voll-Sync macht
// dieselbe Arbeit und brach bei 60s mitten im Ticket-Upsert ab.
export const maxDuration = 300;

export async function POST() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { accountId } = session;

  if (!accountId) {
    return NextResponse.json({ error: "Kein Account zugeordnet" }, { status: 403 });
  }

  try {
    // Manuell ausgeloest: immer der Volllauf. Wer hier klickt, will einen
    // vollstaendigen Abgleich sehen, nicht nur das Tagesfenster.
    const result = await syncAnnyForAccount(accountId, { mode: "full" });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unbekannt";
    console.error("[anny sync error]", msg);

    if (msg.includes("nicht konfiguriert")) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes("API Fehler")) {
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    return NextResponse.json({ error: `Sync fehlgeschlagen: ${msg}` }, { status: 500 });
  }
}
