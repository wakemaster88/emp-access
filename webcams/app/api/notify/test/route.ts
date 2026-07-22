import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { notifyTest } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Test-Endpoint für die Telegram-Konfig im Settings-UI.
 *
 * Ablauf:
 *   1. Body ist optional. Wenn `botToken` / `chatIds` mitkommt, nehmen wir
 *      die — so kann der User testen ohne vorher zu speichern.
 *   2. Sonst: aktuelle Config aus settings.telegram.
 *   3. Wir rufen `getMe` (validiert Token) und schicken eine Test-Nachricht
 *      an alle Chat-IDs.
 *   4. Antwort enthält Bot-Username und pro Chat-ID ein OK/Error.
 *
 * `botToken === "***"` bedeutet „nicht ändern" → wir ziehen den Token
 * aus der gespeicherten Config (analog zu adminPin).
 */

interface TestBody {
  botToken?: string;
  chatIds?: string[];
}

export async function POST(req: Request) {
  let body: TestBody = {};
  try {
    body = ((await req.json()) as TestBody) ?? {};
  } catch {
    body = {};
  }

  const config = await loadConfig();
  const stored = config.settings.telegram;

  const tokenInput = body.botToken;
  const token =
    !tokenInput || tokenInput === "***" ? stored.botToken : tokenInput;
  const chatIds =
    Array.isArray(body.chatIds) && body.chatIds.length > 0
      ? body.chatIds.filter((s) => typeof s === "string" && s.trim().length > 0)
      : stored.chatIds;

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Bot-Token fehlt" },
      { status: 400 },
    );
  }
  if (chatIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Keine Chat-IDs konfiguriert" },
      { status: 400 },
    );
  }

  const result = await notifyTest(token, chatIds);
  return NextResponse.json(result, {
    status: result.ok ? 200 : 502,
  });
}
