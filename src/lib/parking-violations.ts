/**
 * Falschparker im Halteverbot: Meldung des Hubs in Historie, Push und Telegram.
 *
 * Der Hub entscheidet, was ein Falschparker ist (Fläche und Standzeit kennt
 * nur er) und – ab dieser Version – auch, ob die Meldung in die Historie
 * gehört und ob jemand benachrichtigt wird (Episode, Erinnerungen,
 * Nachtruhe). Für einen älteren Hub gilt die Sperre aus
 * parking-violations-rules.ts. Die Sichtung landet mit Bild in der
 * Fahrzeug-Historie, damit man später nachsehen kann, wer wann dort stand.
 */
import { prisma } from "@/lib/prisma";
import { deleteBlobs, resolveBinary, storeSightingSnapshot } from "@/lib/blob-store";
import { sendTelegramMessage, sendTelegramPhoto } from "@/lib/telegram";
import { deliverPush, isWebPushConfigured, type PushTarget } from "@/lib/web-push";
import {
  DB_COOLDOWN_MINUTES,
  EVIDENCE_KEY_LOOKBACK_MINUTES,
  REPORT_KEY_LOOKBACK_MINUTES,
  checkEvidenceTarget,
  decideParkingViolation,
  dedupeParkingReport,
  evidenceCaption,
  evidenceSentKey,
  hubDecides,
  nothingDelivered,
  parkingMessage,
  type EvidenceCheck,
  type HubParkingParams,
} from "@/lib/parking-violations-rules";

const lastNotifiedAt = new Map<string, number>();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  /** Angaben eines neueren Hubs (notify, store, inZone, reminder). */
  params: HubParkingParams;
}

export interface ParkingViolationResult {
  sightingId: number | null;
  pushed: number;
  telegram: number;
  /** cooldown: Sperre für ältere Hubs; duplicate: Nachricht zu diesem Schlüssel ging schon hinaus. */
  skipped?: "cooldown" | "duplicate";
  /** Die Cloud hat sich nach notify/store des Hubs gerichtet. */
  hubDecides?: true;
  /** Wiederholter Versuch: Die Sichtung zu diesem Schlüssel gab es schon (sightingId nennt sie). */
  sightingExisted?: true;
  /** Ausschnitt des gespeicherten Eintrags (evidenceKey) an so viele Telegram-Chats. */
  evidenceTelegram?: number;
  /**
   * Nachweislich nichts verschickt (jeder Kanal hat abgelehnt): Der Schlüssel
   * ist wieder frei, die Route antwortet mit einem Fehler, der Hub versucht es erneut.
   */
  undelivered?: true;
}

/** Letzte Halteverbot-Sichtung der Kamera, nur so weit zurück, wie die Sperre reicht. */
async function lastSightingAt(accountId: number, cameraId: number, at: Date): Promise<number | null> {
  const last = await prisma.vehicleSighting.findFirst({
    where: {
      accountId,
      cameraId,
      source: "NO_PARKING",
      seenAt: { gte: new Date(at.getTime() - DB_COOLDOWN_MINUTES * 60_000) },
    },
    orderBy: { seenAt: "desc" },
    select: { seenAt: true },
  });
  return last ? last.seenAt.getTime() : null;
}

/** Sichtung, die ein früherer Versuch derselben Meldung (gleicher Schlüssel) angelegt hat. */
async function sightingWithKey(accountId: number, cameraId: number, reportKey: string, at: Date): Promise<number | null> {
  const found = await prisma.vehicleSighting.findFirst({
    where: {
      accountId,
      cameraId,
      source: "NO_PARKING",
      reportKey,
      seenAt: { gte: new Date(at.getTime() - REPORT_KEY_LOOKBACK_MINUTES * 60_000) },
    },
    orderBy: { seenAt: "desc" },
    select: { id: true },
  });
  return found?.id ?? null;
}

/**
 * Nachricht zu diesem Schlüssel für sich beanspruchen (in einer Anweisung,
 * damit zwei gleichzeitige Versuche nicht beide schicken). false: Sie ging
 * schon hinaus (auch mit Ausschnitt, evidenceSentKey).
 */
async function claimNotifyKey(accountId: number, cameraId: number, notifyKey: string): Promise<boolean> {
  const claimed = await prisma.camera.updateMany({
    where: {
      id: cameraId,
      accountId,
      OR: [{ noParkNotifyKey: null }, { noParkNotifyKey: { notIn: [notifyKey, evidenceSentKey(notifyKey)] } }],
    },
    data: { noParkNotifyKey: notifyKey },
  });
  return claimed.count > 0;
}

/** Beanspruchte Nachricht freigeben (nachweislich nichts verschickt): zurück auf den vorigen Schlüssel. */
async function releaseNotifyKey(accountId: number, cameraId: number, notifyKey: string, previous: string | null): Promise<void> {
  await prisma.camera.updateMany({
    where: { id: cameraId, accountId, noParkNotifyKey: notifyKey },
    data: { noParkNotifyKey: previous },
  });
}

/**
 * Ausschnitt zur ersten Nachricht `notifyKey` für Telegram beanspruchen, in
 * einer Anweisung: Nur wer die Marke setzt, schickt ihn. false: Er ging schon
 * hinaus, oder inzwischen ging eine andere Nachricht hinaus.
 */
async function claimEvidenceTelegram(accountId: number, cameraId: number, notifyKey: string): Promise<boolean> {
  const claimed = await prisma.camera.updateMany({
    where: { id: cameraId, accountId, noParkNotifyKey: notifyKey },
    data: { noParkNotifyKey: evidenceSentKey(notifyKey) },
  });
  return claimed.count > 0;
}

type TelegramTarget = { botToken: string; chatId: string };

/** Alles, was der Versand braucht – gelesen, bevor die Nachricht beansprucht wird. */
interface NotifyContext {
  timezone: string;
  telegram: TelegramTarget[];
  push: PushTarget[];
  /** Schlüssel der zuletzt verschickten Nachricht (zum Freigeben). */
  previousKey: string | null;
}

async function loadNotifyContext(accountId: number, cameraId: number): Promise<NotifyContext> {
  const [account, camera, telegram, push] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } }),
    prisma.camera.findFirst({ where: { id: cameraId, accountId }, select: { noParkNotifyKey: true } }),
    prisma.telegramConfig.findMany({ where: { accountId, isActive: true }, select: { botToken: true, chatId: true } }),
    isWebPushConfigured()
      ? prisma.pushSubscription.findMany({
          where: { accountId },
          select: { id: true, endpoint: true, p256dh: true, auth: true },
        })
      : Promise.resolve([] as PushTarget[]),
  ]);
  return {
    timezone: account?.timezone ?? "Europe/Berlin",
    telegram,
    push,
    previousKey: camera?.noParkNotifyKey ?? null,
  };
}

function clockIn(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(at);
}

/** Bild an alle Telegram-Chats; `fallbackText`: scheitert das Foto, wenigstens der Text. */
async function sendTelegramAll(
  targets: TelegramTarget[],
  jpeg: Buffer,
  caption: string,
  fallbackText: string | null,
  label: string,
): Promise<{ sent: number; uncertain: boolean }> {
  let sent = 0;
  let uncertain = false;
  for (const tg of targets) {
    try {
      const res = await sendTelegramPhoto(tg.botToken, tg.chatId, jpeg, caption);
      if (res.ok) {
        sent++;
        continue;
      }
      // Foto kann an Größe oder Format scheitern – Text ist besser als nichts.
      const fallback = fallbackText ? await sendTelegramMessage(tg.botToken, tg.chatId, fallbackText) : null;
      if (fallback?.ok) sent++;
      else console.error(`[no-parking] telegram ${label} failed:`, res.description);
    } catch (err) {
      // Netz oder Zeitüberschreitung: Ob es ankam, ist offen.
      uncertain = true;
      console.error(`[no-parking] telegram ${label} error:`, err);
    }
  }
  return { sent, uncertain };
}

/**
 * Erste Nachricht ohne neuen Eintrag (der Hub nennt evidenceKey): den
 * Ausschnitt des gespeicherten Eintrags an Telegram, genau einmal je erster
 * Nachricht (claimEvidenceTelegram). Liefert die Zahl der Chats. Wirft nie:
 * Die Nachricht selbst ist dann schon hinaus.
 */
async function sendStoredEvidence(
  input: ParkingViolationInput,
  evidenceKey: string,
  notifyKey: string,
  ctx: NotifyContext,
): Promise<number> {
  if (ctx.telegram.length === 0) return 0;
  try {
    // Erst lesen, dann beanspruchen: Scheitert das Lesen, kann ein späterer Versuch ihn noch schicken.
    const sighting = await prisma.vehicleSighting.findFirst({
      where: {
        accountId: input.accountId,
        cameraId: input.cameraId,
        source: "NO_PARKING",
        reportKey: evidenceKey,
        seenAt: { gte: new Date(input.at.getTime() - EVIDENCE_KEY_LOOKBACK_MINUTES * 60_000) },
      },
      orderBy: { seenAt: "desc" },
      select: { seenAt: true, evidence: true, evidenceBlob: true },
    });
    const jpeg = sighting ? await resolveBinary({ blob: sighting.evidenceBlob, bytes: sighting.evidence }) : null;
    if (!sighting || !jpeg) return 0;
    if (!(await claimEvidenceTelegram(input.accountId, input.cameraId, notifyKey))) return 0;
    const caption = escapeHtml(evidenceCaption(input.cameraName, clockIn(ctx.timezone, sighting.seenAt)));
    return (await sendTelegramAll(ctx.telegram, jpeg, caption, null, "stored evidence")).sent;
  } catch (err) {
    console.error("[no-parking] stored evidence error:", err);
    return 0;
  }
}

/** Historie schreiben und benachrichtigen, so wie der Hub es angibt. */
export async function processParkingViolation(
  input: ParkingViolationInput,
): Promise<ParkingViolationResult> {
  const key = `${input.accountId}:${input.cameraId}`;
  const byHub = hubDecides(input.params);
  const decision = decideParkingViolation(input.params, {
    now: input.at.getTime(),
    lastNotifiedAt: lastNotifiedAt.get(key) ?? null,
    // Nur für einen älteren Hub nötig; ein neuerer kennt seine Episode selbst.
    lastSightingAt: byHub ? null : await lastSightingAt(input.accountId, input.cameraId, input.at),
  });
  const marks = byHub ? { hubDecides: true as const } : {};
  const { storeKey, notifyKey, evidenceKey } = input.params;

  // Wiederholter Versuch: Sichtung mit demselben Schlüssel gibt es schon.
  const existingSightingId =
    decision.store && storeKey ? await sightingWithKey(input.accountId, input.cameraId, storeKey, input.at) : null;
  const beforeNotify = dedupeParkingReport(decision, { existingSightingId, notifySent: false });

  let sightingId: number | null = beforeNotify.sightingId;
  if (beforeNotify.createSighting) {
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
        reportKey: storeKey,
        ...stored,
      },
      select: { id: true },
    });
    sightingId = sighting.id;
  }
  const existed = beforeNotify.sightingId != null ? { sightingExisted: true as const } : {};

  // Alles für den Versand lesen, bevor die Nachricht beansprucht wird:
  // Scheitert eine Abfrage, darf der nächste Versuch sie noch schicken.
  const ctx = decision.notify ? await loadNotifyContext(input.accountId, input.cameraId) : null;
  // Erst nach der Sichtung beanspruchen: Scheitert das Speichern, darf der
  // nächste Versuch die Nachricht noch schicken.
  const claimed = decision.notify && notifyKey ? await claimNotifyKey(input.accountId, input.cameraId, notifyKey) : false;
  const notifySent = decision.notify && notifyKey ? !claimed : false;
  const final = dedupeParkingReport(decision, { existingSightingId, notifySent });
  // Erste Nachricht ohne neuen Eintrag: Ausschnitt des gespeicherten an Telegram (auch wenn
  // die Nachricht bei einem früheren Versuch hinausging, dessen Antwort verloren ging).
  const storedEvidenceFor = ctx && notifyKey && evidenceKey && input.params.reminder == null ? notifyKey : null;

  // Der Eintrag in der Historie entsteht unabhängig von der Benachrichtigung:
  // Ein Fahrzeug, das eine Stunde steht, soll nicht alle paar Minuten klingeln.
  if (!final.notify) {
    const evidenceTelegram =
      storedEvidenceFor && final.skipped === "duplicate" ? await sendStoredEvidence(input, evidenceKey!, storedEvidenceFor, ctx!) : 0;
    return {
      sightingId,
      pushed: 0,
      telegram: 0,
      ...(final.skipped ? { skipped: final.skipped } : {}),
      ...(evidenceTelegram > 0 ? { evidenceTelegram } : {}),
      ...marks,
      ...existed,
    };
  }
  lastNotifiedAt.set(key, input.at.getTime());
  const context = ctx!;

  const { title, body } = parkingMessage({
    cameraName: input.cameraName,
    vehicles: Math.max(1, input.params.inZone || input.vehicles),
    seconds: input.seconds,
    time: clockIn(context.timezone, input.at),
    reminder: input.params.reminder,
  });

  let push = { sent: 0, failed: 0, staleIds: [] as number[] };
  let pushThrew = false;
  try {
    push = await deliverPush(context.push, { title, body, url: "/fahrzeuge", tag: `no-parking-${input.cameraId}` });
  } catch (err) {
    // deliverPush wirft nur vor dem ersten Versand (Bibliothek, VAPID): nichts ging hinaus.
    pushThrew = true;
    console.error("[no-parking] push error:", err);
  }
  if (push.staleIds.length > 0) {
    try {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: push.staleIds }, accountId: input.accountId } });
    } catch (err) {
      console.error("[no-parking] stale push subscriptions:", err);
    }
  }

  // Push trägt kein Bild – wer Telegram nutzt, bekommt den Schnappschuss dazu.
  const caption = `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`;
  const tg = await sendTelegramAll(context.telegram, input.snapshot, caption, caption, "report");

  // Nachweislich nichts verschickt: Schlüssel freigeben, der Hub versucht es erneut.
  const none = nothingDelivered({
    channels: context.push.length + context.telegram.length + (pushThrew ? 1 : 0),
    pushSent: push.sent,
    pushUncertain: push.failed > 0,
    telegramSent: tg.sent,
    telegramUncertain: tg.uncertain,
  });
  if (claimed && none) {
    try {
      await releaseNotifyKey(input.accountId, input.cameraId, notifyKey!, context.previousKey);
      lastNotifiedAt.delete(key);
      return { sightingId, pushed: 0, telegram: 0, undelivered: true, ...marks, ...existed };
    } catch (err) {
      console.error("[no-parking] release notify key:", err);
    }
  }

  const evidenceTelegram = storedEvidenceFor ? await sendStoredEvidence(input, evidenceKey!, storedEvidenceFor, context) : 0;
  return {
    sightingId,
    pushed: push.sent,
    telegram: tg.sent,
    ...(evidenceTelegram > 0 ? { evidenceTelegram } : {}),
    ...marks,
    ...existed,
  };
}

export interface ParkingEvidenceInput {
  accountId: number;
  sightingId: number;
  /** Ausschnitt in voller Auflösung (JPEG). */
  jpeg: Buffer;
  /**
   * Erste Nachricht der Meldung (Hub ab dieser Version): Ausschnitt als
   * zweites Bild an Telegram, genau einmal je Nachricht (claimEvidenceTelegram).
   */
  notifyKey: string | null;
  /**
   * Ohne notifyKey: Zur Meldung ging eine Nachricht an Telegram, Ausschnitt
   * hinterher (älterer Hub, oder der neue Eintrag kam mit einer Erinnerung).
   */
  telegram: boolean;
  at: Date;
}

export type ParkingEvidenceResult =
  /** `existed`: Der Ausschnitt lag schon in der Historie, nur Telegram kam hinzu. */
  | { ok: true; telegram: number; existed?: true }
  | { ok: false; reason: Exclude<EvidenceCheck, "ok"> };

/** Ausschnitt einer Sichtung als zweites Bild an alle Telegram-Chats; liefert die Zahl der Chats. */
async function sendEvidenceTelegram(accountId: number, sighting: { seenAt: Date; camera: { name: string } | null }, jpeg: Buffer): Promise<number> {
  const [account, telegramConfigs] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } }),
    prisma.telegramConfig.findMany({
      where: { accountId, isActive: true },
      select: { botToken: true, chatId: true },
    }),
  ]);
  const caption = escapeHtml(evidenceCaption(sighting.camera?.name ?? null, clockIn(account?.timezone ?? "Europe/Berlin", sighting.seenAt)));
  return (await sendTelegramAll(telegramConfigs, jpeg, caption, null, "evidence")).sent;
}

/**
 * Ausschnitt zur Halteverbot-Sichtung ablegen (Historie) und bei Bedarf als
 * zweites Bild an Telegram schicken. Ein zweiter Ausschnitt zur selben
 * Sichtung wird nicht angenommen, auch nicht gleichzeitig: Nur wer ihn
 * ablegt, schickt ihn an Telegram. Liegt er schon in der Historie (der Hub
 * legte ihn nach einer nicht zugestellten Nachricht ab) und nennt der Hub die
 * erste Nachricht (`notifyKey`), geht der gespeicherte Ausschnitt einmal an
 * Telegram (claimEvidenceTelegram).
 */
export async function attachParkingEvidence(input: ParkingEvidenceInput): Promise<ParkingEvidenceResult> {
  const sighting = await prisma.vehicleSighting.findFirst({
    where: { id: input.sightingId, accountId: input.accountId },
    select: { source: true, seenAt: true, cameraId: true, evidenceBlob: true, camera: { select: { name: true } } },
  });
  const hasEvidence =
    sighting != null &&
    (sighting.evidenceBlob != null ||
      (await prisma.vehicleSighting.count({
        where: { id: input.sightingId, accountId: input.accountId, evidence: { not: null } },
      })) > 0);
  const check = checkEvidenceTarget(sighting && { source: sighting.source, seenAt: sighting.seenAt, hasEvidence }, input.at);
  if (check === "exists" && input.notifyKey && sighting?.cameraId != null) {
    // Erst lesen, dann beanspruchen: Scheitert das Lesen, kann ein späterer Versuch ihn noch schicken.
    const stored = await prisma.vehicleSighting.findFirst({
      where: { id: input.sightingId, accountId: input.accountId },
      select: { evidence: true, evidenceBlob: true },
    });
    const jpeg = stored ? await resolveBinary({ blob: stored.evidenceBlob, bytes: stored.evidence }) : null;
    if (!jpeg || !(await claimEvidenceTelegram(input.accountId, sighting.cameraId, input.notifyKey))) {
      return { ok: false, reason: "exists" };
    }
    return { ok: true, telegram: await sendEvidenceTelegram(input.accountId, sighting, jpeg), existed: true };
  }
  if (check !== "ok") return { ok: false, reason: check };

  const stored = await storeSightingSnapshot(
    "vehicle-sightings",
    input.accountId,
    new Uint8Array(input.jpeg) as Uint8Array<ArrayBuffer>,
  );
  // Nur ablegen, wenn noch kein Ausschnitt da ist (zwei gleichzeitige Aufrufe: einer gewinnt).
  const attached = await prisma.vehicleSighting.updateMany({
    where: { id: input.sightingId, accountId: input.accountId, evidence: null, evidenceBlob: null },
    data: stored.snapshotBlob ? { evidenceBlob: stored.snapshotBlob } : { evidence: stored.snapshot },
  });
  if (attached.count === 0) {
    await deleteBlobs([stored.snapshotBlob]).catch(() => 0);
    return { ok: false, reason: "exists" };
  }

  const cameraId = sighting!.cameraId;
  const toTelegram = input.notifyKey
    ? cameraId != null && (await claimEvidenceTelegram(input.accountId, cameraId, input.notifyKey))
    : input.telegram;
  if (!toTelegram) return { ok: true, telegram: 0 };
  return { ok: true, telegram: await sendEvidenceTelegram(input.accountId, sighting!, input.jpeg) };
}
