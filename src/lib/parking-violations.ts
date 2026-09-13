/**
 * Falschparker im Halteverbot: Meldung des Hubs in Historie, Push und Telegram.
 *
 * Der Hub entscheidet, was ein Falschparker ist (Fläche und Standzeit kennt
 * nur er); hier geht es allein darum, wer davon erfährt. Die Sichtung landet
 * mit Bild in der Fahrzeug-Historie, damit man später nachsehen kann, wer wann
 * dort stand.
 */
import { prisma } from "@/lib/prisma";
import { storeSightingSnapshot } from "@/lib/blob-store";
import { sendTelegramMessage, sendTelegramPhoto } from "@/lib/telegram";
import { sendPushToAccount } from "@/lib/web-push";

/** Ein Fahrzeug steht dort oft eine Weile – ohne Sperre käme im Minutentakt Post. */
const COOLDOWN_MINUTES = 10;

const lastNotifiedAt = new Map<string, number>();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function standingLabel(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} Sekunden`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} Minuten` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export interface ParkingViolationInput {
  accountId: number;
  cameraId: number;
  cameraName: string;
  /** Anzahl Fahrzeuge in der gesperrten Fläche. */
  vehicles: number;
  /** Standzeit des am längsten stehenden Fahrzeugs. */
  seconds: number;
  snapshot: Buffer;
  at: Date;
}

export interface ParkingViolationResult {
  sightingId: number | null;
  pushed: number;
  telegram: number;
  skipped?: "cooldown";
}

/** Historie schreiben und benachrichtigen. */
export async function processParkingViolation(
  input: ParkingViolationInput,
): Promise<ParkingViolationResult> {
  const key = `${input.accountId}:${input.cameraId}`;
  const last = lastNotifiedAt.get(key);
  const cooldownMs = COOLDOWN_MINUTES * 60_000;
  const withinCooldown = last != null && input.at.getTime() - last < cooldownMs;

  const stored = await storeSightingSnapshot(
    "vehicle-sightings",
    input.accountId,
    new Uint8Array(input.snapshot) as Uint8Array<ArrayBuffer>,
  );
  const sighting = await prisma.vehicleSighting.create({
    data: {
      accountId: input.accountId,
      cameraId: input.cameraId,
      source: "NO_PARKING",
      seenAt: input.at,
      ...stored,
    },
    select: { id: true },
  });

  // Der Eintrag in der Historie entsteht immer, die Benachrichtigung nicht:
  // Ein Fahrzeug, das eine Stunde steht, soll nicht stündlich klingeln.
  if (withinCooldown) {
    return { sightingId: sighting.id, pushed: 0, telegram: 0, skipped: "cooldown" };
  }
  lastNotifiedAt.set(key, input.at.getTime());

  const account = await prisma.account.findUnique({
    where: { id: input.accountId },
    select: { timezone: true },
  });
  const timeStr = new Intl.DateTimeFormat("de-DE", {
    timeZone: account?.timezone ?? "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input.at);

  const subject =
    input.vehicles === 1 ? "Ein Fahrzeug" : `${input.vehicles} Fahrzeuge`;
  const body = `${input.cameraName}: ${subject} seit ${standingLabel(input.seconds)} · ${timeStr}`;

  const push = await sendPushToAccount(input.accountId, {
    title: "Falschparker im Halteverbot",
    body,
    url: "/fahrzeuge",
    tag: `no-parking-${input.cameraId}`,
  });

  // Push trägt kein Bild – wer Telegram nutzt, bekommt den Schnappschuss dazu.
  const telegramConfigs = await prisma.telegramConfig.findMany({
    where: { accountId: input.accountId, isActive: true },
    select: { botToken: true, chatId: true },
  });
  const caption = `<b>Falschparker im Halteverbot</b>\n${escapeHtml(body)}`;
  let telegramSent = 0;
  for (const tg of telegramConfigs) {
    try {
      const res = await sendTelegramPhoto(tg.botToken, tg.chatId, input.snapshot, caption);
      if (res.ok) {
        telegramSent++;
      } else {
        // Foto kann an Größe oder Format scheitern – Text ist besser als nichts.
        const fallback = await sendTelegramMessage(tg.botToken, tg.chatId, caption);
        if (fallback.ok) telegramSent++;
        else console.error("[no-parking] telegram failed:", res.description);
      }
    } catch (err) {
      console.error("[no-parking] telegram error:", err);
    }
  }

  return { sightingId: sighting.id, pushed: push.sent, telegram: telegramSent };
}
