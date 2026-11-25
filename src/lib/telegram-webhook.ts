import { getTelegramWebhookInfo, setTelegramWebhook, telegramWebhookSecret } from "@/lib/telegram";

/**
 * Selbst-Umstellung des Telegram-Webhooks auf die Form `?id=<configId>` mit
 * Geheimnis im Header `X-Telegram-Bot-Api-Secret-Token`.
 *
 * Grundlage ist allein die URL, die Telegram fuer den Bot gerade gespeichert
 * hat: der Host wird daraus uebernommen (nie aus einer Umgebungsvariable oder
 * dem eingehenden Request), damit der Bot weiter denselben Host aufruft.
 */

const WEBHOOK_PATH = "/api/telegram/webhook";

export type TelegramWebhookPlan =
  /** Kein Webhook registriert – nichts zu tun. */
  | { action: "none"; reason: "unregistered" }
  /** Bereits die id-Form fuer diese Config – nichts zu tun. */
  | { action: "none"; reason: "current" }
  /** Alte Form mit Bot-Token in der URL – auf `url` umstellen. */
  | { action: "convert"; url: string }
  /** Andere URL (anderer Pfad, andere Config, anderes Schema …) – nicht anfassen. */
  | { action: "foreign" };

/**
 * Entscheidet anhand der bei Telegram registrierten URL, ob umgestellt wird.
 * Rein, ohne Netz: die neue URL hat denselben Origin wie die registrierte,
 * den Pfad `/api/telegram/webhook` und als einzigen Parameter `id`.
 */
export function planTelegramWebhook(currentUrl: string | null | undefined, configId: number): TelegramWebhookPlan {
  const raw = (currentUrl ?? "").trim();
  if (!raw) return { action: "none", reason: "unregistered" };
  if (!Number.isSafeInteger(configId) || configId <= 0) return { action: "foreign" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { action: "foreign" };
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return { action: "foreign" };
  if (url.pathname !== WEBHOOK_PATH) return { action: "foreign" };

  const params = [...url.searchParams.keys()];
  if (params.length === 1 && params[0] === "id" && url.searchParams.get("id") === String(configId)) {
    return { action: "none", reason: "current" };
  }
  if (url.searchParams.has("token")) {
    return { action: "convert", url: `${url.origin}${WEBHOOK_PATH}?id=${configId}` };
  }
  return { action: "foreign" };
}

/** URL ohne Query-String und Fragment, fuer Logzeilen. */
function urlWithoutQuery(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(ungueltige URL)";
  }
}

export type EnsureTelegramWebhookResult =
  | { status: "unchanged" }
  | { status: "converted"; url: string }
  | { status: "foreign" }
  | { status: "failed"; error: string };

/**
 * Prueft die Webhook-Registrierung eines Bots und stellt die alte Form
 * (Bot-Token in der URL) auf die id-Form um. Wirft nie; jeder Telegram-Aufruf
 * hat das Zeitlimit aus lib/telegram (hoechstens drei Aufrufe). Ausstehende
 * Updates bleiben erhalten (kein drop_pending_updates).
 *
 * Umgestellt wird nur bei VERCEL_ENV=production; sonst meldet die Funktion
 * failed, ohne setWebhook aufzurufen.
 *
 * Logzeilen (je Umstellung oder Fehler genau eine, nie mit Bot-Token):
 *   [telegram webhook-setup] Config #<id>: umgestellt auf <origin>/api/telegram/webhook (id-Form)
 *   [telegram webhook-setup] Config #<id>: fehlgeschlagen – <Grund>
 */
export async function ensureTelegramWebhook(config: { id: number; botToken: string }): Promise<EnsureTelegramWebhookResult> {
  const { id, botToken } = config;
  // Fehlertexte koennten Teile der Aufruf-URL enthalten: Token unkenntlich machen.
  const clean = (msg: string) => (botToken ? msg.split(botToken).join("***") : msg);
  const fail = (error: string): EnsureTelegramWebhookResult => {
    const msg = clean(error);
    console.error(`[telegram webhook-setup] Config #${id}: fehlgeschlagen – ${msg}`);
    return { status: "failed", error: msg };
  };

  try {
    if (!botToken) return fail("kein Bot-Token");
    const info = await getTelegramWebhookInfo(botToken);
    if (!info?.ok) return fail(`getWebhookInfo: ${info?.description ?? "keine Antwort"}`);

    const plan = planTelegramWebhook(info.result?.url, id);
    if (plan.action === "none") return { status: "unchanged" };
    if (plan.action === "foreign") return { status: "foreign" };

    // Umgestellt wird nur aus der Produktion: Preview- und Dev-Umgebungen
    // koennen ein anderes AUTH_SECRET haben, das Geheimnis passte dann nicht
    // zur Produktion. Die Kontrolle unten vergleicht nur die URL.
    if (process.env.VERCEL_ENV !== "production") return fail("nicht in der Produktionsumgebung, keine Umstellung");

    // Ohne Schluessel waere das Header-Geheimnis nicht an den Server gebunden.
    if (!process.env.TWO_FACTOR_KEY && !process.env.AUTH_SECRET) return fail("AUTH_SECRET fehlt");

    const set = await setTelegramWebhook(botToken, plan.url, telegramWebhookSecret(botToken));
    if (!set?.ok) return fail(`setWebhook: ${set?.description ?? "keine Antwort"}`);

    const check = await getTelegramWebhookInfo(botToken);
    if (!check?.ok) return fail(`Kontrolle getWebhookInfo: ${check?.description ?? "keine Antwort"}`);
    if (check.result?.url !== plan.url) {
      return fail(`Kontrolle: registriert ist ${urlWithoutQuery(check.result?.url ?? "")}`);
    }

    console.log(`[telegram webhook-setup] Config #${id}: umgestellt auf ${urlWithoutQuery(plan.url)} (id-Form)`);
    return { status: "converted", url: plan.url };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
