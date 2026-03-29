import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { syncAnnyForAccount } from "@/lib/anny-sync";

export const maxDuration = 60;

export async function POST() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { accountId } = session;

  if (!accountId) {
    return NextResponse.json({ error: "Kein Account zugeordnet" }, { status: 403 });
  }

  try {
    const result = await syncAnnyForAccount(accountId);
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
