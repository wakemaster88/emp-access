/**
 * Was ein Zonen-Abspieler bei jedem Abruf bekommt und was er zurückmeldet.
 *
 * Gemeinsam für den Audio-Pi (`/api/devices/audio`, Geräte-Token) und den
 * Monitor im Browser (`/api/monitor-audio/[token]`, Link des Monitors). Beide
 * holen die Zonenkonfiguration samt offener Jobs ab und melden Ist-Zustand und
 * Jobstatus per Heartbeat. So verhält sich ein Monitor in der Zone genau wie
 * ein Pi: Durchsagen, Start/Stopp, Lautstärke und Musik-Automatik.
 */
import type { Prisma } from "@prisma/client";
import type { TenantDb } from "@/lib/prisma";
import { clampVolume, isMusicMuted, musicWindowState, pairableSeconds, parseExternalKind } from "@/lib/audio";
import { scheduleSpecInclude } from "@/lib/operating-queries";
import { zoneMusicSpec } from "@/lib/operating-extent-queries";
import { followLeaderSelect, syncFollower } from "@/lib/audio-follow";

const JOB_BATCH_SIZE = 20;

/** Was der Abruf von der Zone braucht. */
export const playerZoneInclude = {
  stream: { select: { url: true } },
  playlist: {
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { track: { select: { id: true, title: true, url: true } } },
      },
    },
  },
  account: { select: { timezone: true } },
  keyRoom: { select: { operatingScheduleId: true, operatingSchedule: { include: scheduleSpecInclude } } },
  followZone: { select: followLeaderSelect },
} satisfies Prisma.AudioZoneInclude;

export type PlayerZone = Prisma.AudioZoneGetPayload<{ include: typeof playerZoneInclude }>;

export interface PlayerStateOptions {
  /** false: nur Konfiguration, Jobs bleiben offen (Monitor, der nicht spielt). */
  deliverJobs?: boolean;
  /**
   * Offene Jobs, die vor diesem Zeitpunkt angelegt wurden, gehen nicht mehr
   * raus, sondern werden mit `staleMessage` als FAILED abgelegt. Für den
   * Monitor: eine Durchsage, die Stunden zu spät aus dem Shop kommt, hilft
   * niemandem. Der Pi arbeitet dagegen alles nach (ohne Grenze).
   */
  staleBefore?: Date;
  staleMessage?: string;
}

/**
 * Antwort für den Abspieler: Zone, Musikfenster und offene Jobs. Die Jobs
 * stehen danach auf SENT.
 */
export async function playerStateBody(db: TenantDb, zone: PlayerZone, options: PlayerStateOptions = {}) {
  const { deliverJobs = true, staleBefore, staleMessage } = options;
  const now = new Date();

  if (deliverJobs && staleBefore) {
    await db.audioJob.updateMany({
      where: { zoneId: zone.id, status: "PENDING", createdAt: { lt: staleBefore } },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorMessage: staleMessage ?? "Zu alt – der Abspieler war nicht erreichbar",
      },
    });
  }

  // Musikfenster aus den Musikzeiten der Zone bzw. der Betriebszeit des Raums
  // – hier gerechnet, weil der Abspieler weder Saison noch Ausnahmetage kennt.
  // `until` nennt den nächsten Wechsel, damit der Pi ihn auch ohne Verbindung
  // einhält.
  // Mit `musicExtent` zählen gebuchte Bahnmieten und Kurse mit.
  const musicSpecRead = zoneMusicSpec(db, zone.accountId, zone, now, zone.account.timezone);

  // Folgt die Zone einer anderen, kommt ein Wechsel dort jetzt als Befehl in
  // die Warteschlange – vor dem Lesen der Jobs, damit er gleich mitgeht. Sie
  // folgt nur in ihrem eigenen Musikfenster (lib/audio-follow), deshalb wartet
  // nur dieser Weg auf das Fenster.
  const follow =
    deliverJobs && zone.followZone
      ? await syncFollower(
          db,
          zone,
          musicWindowState(zone, await musicSpecRead, now, zone.account.timezone)
        )
      : null;

  // Offene Jobs und Musikfenster sind unabhaengig voneinander und werden
  // gleichzeitig gelesen; Jobs kommen bei jedem Abruf mit.
  const [musicSpec, jobs] = await Promise.all([
    musicSpecRead,
    deliverJobs
      ? db.audioJob.findMany({
          where: { zoneId: zone.id, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          take: JOB_BATCH_SIZE,
        })
      : Promise.resolve([]),
  ]);
  const music = musicWindowState(zone, musicSpec, now, zone.account.timezone);

  // Der Abspieler setzt zum Fensterbeginn `sourceKind` fort. Nach einem Stopp
  // steht dort SILENCE, und die Musik bliebe am nächsten Tag aus. Deshalb gilt
  // ein Stopp nur bis zum Fensterende: danach ist die Quelle der Zone wieder
  // die Vorgabe.
  let sourceKind = zone.sourceKind;
  if (
    !follow &&
    !music.allowed &&
    sourceKind === "SILENCE" &&
    zone.defaultSource !== "SILENCE"
  ) {
    sourceKind = zone.defaultSource;
    await db.audioZone.update({ where: { id: zone.id }, data: { sourceKind } });
  }

  if (jobs.length > 0) {
    await db.audioJob.updateMany({
      where: { id: { in: jobs.map((j) => j.id) } },
      data: { status: "SENT", sentAt: new Date() },
    });
  }

  // Solange die Zone folgt, gilt die Quelle der gefolgten statt der eigenen –
  // Start und Stopp kommen als Befehl. Nach einem Neustart setzt der Abspieler
  // so dort fort, wo die gefolgte Zone gerade ist. Das Musikfenster bleibt das
  // eigene: Am Fensterende stoppt der Abspieler auch ohne Verbindung.
  const ownPlaylist = zone.playlist
    ? {
        id: zone.playlist.id,
        name: zone.playlist.name,
        shuffle: zone.playlist.shuffle,
        crossfadeSec: zone.playlist.crossfadeSec,
        tracks: zone.playlist.items.map((item) => ({
          id: item.track.id,
          title: item.track.title,
          url: item.track.url,
        })),
      }
    : null;

  return {
    zone: {
      id: zone.id,
      name: zone.name,
      isActive: zone.isActive,
      syncGroup: zone.syncGroup,
      volume: zone.volume,
      announcementVolume: zone.announcementVolume,
      duckVolume: zone.duckVolume,
      // Musik lautlos, Durchsagen normal (Taste „Audio“ am Monitor). Nur der
      // Monitor setzt das um; ältere Abspieler und der Pi übergehen das Feld.
      musicMuted: isMusicMuted(zone.musicMutedUntil, now),
      sourceKind: follow ? follow.sourceKind : sourceKind,
      streamUrl: follow ? follow.streamUrl : (zone.stream?.url ?? zone.streamUrl),
      music: { allowed: music.allowed, until: music.until?.toISOString() ?? null },
      // Empfänger, die diese Zone übernehmen dürfen. null = abgeschaltet, der
      // Abspieler hält den Dienst dann gestoppt. Ältere Abspieler kennen die
      // Felder nicht und übergehen sie.
      airplay: zone.airplayEnabled ? { name: zone.externalName || zone.name } : null,
      bluetooth: zone.bluetoothEnabled
        ? {
            name: zone.externalName || zone.name,
            pairableFor: pairableSeconds(zone.pairableUntil),
          }
        : null,
      playlist: follow ? follow.playlist : ownPlaylist,
    },
    jobs: jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      payload: job.payload,
      createdAt: job.createdAt,
    })),
  };
}

/**
 * Heartbeat des Abspielers: Ist-Zustand der Zone und Statusmeldungen zu Jobs
 * (`jobs: [{ id, status, errorMessage? }]`). Gibt die Zahl der noch offenen
 * Jobs zurück.
 */
export async function recordPlayerReport(
  db: TenantDb,
  zone: { id: number; volume: number },
  body: Record<string, unknown>,
  now = new Date()
): Promise<number> {
  // Übernahme durch AirPlay/Bluetooth. `null` heißt: der Sender hat wieder
  // freigegeben. Fehlt das Feld ganz, stammt der Heartbeat von einem älteren
  // Abspieler – dann bleibt der Zustand unverändert, statt eine laufende
  // Übernahme wegzuräumen.
  const externalSource = body.externalSource as { kind?: unknown; sender?: unknown } | null | undefined;
  const external =
    externalSource === undefined
      ? undefined
      : (parseExternalKind(externalSource?.kind) ?? null);
  const externalSender =
    external === undefined
      ? undefined
      : external === null
        ? null
        : typeof externalSource?.sender === "string" && externalSource.sender.trim()
          ? externalSource.sender.trim().slice(0, 120)
          : null;

  await db.audioZone.update({
    where: { id: zone.id },
    data: {
      isPlaying: typeof body.isPlaying === "boolean" ? body.isPlaying : undefined,
      currentTitle:
        body.currentTitle === undefined
          ? undefined
          : typeof body.currentTitle === "string" && body.currentTitle.trim()
            ? body.currentTitle.trim().slice(0, 200)
            : null,
      reportedVolume:
        body.volume === undefined ? undefined : clampVolume(body.volume, zone.volume),
      externalActive: external,
      externalSender,
      lastStateAt: now,
    },
  });

  const reports = Array.isArray(body.jobs) ? body.jobs : [];
  for (const report of reports) {
    const jobId = Number(report?.id);
    if (!Number.isInteger(jobId)) continue;

    const status = report.status;
    if (!["PLAYING", "DONE", "FAILED"].includes(status)) continue;

    await db.audioJob.updateMany({
      where: { id: jobId, zoneId: zone.id },
      data: {
        status,
        ...(status === "PLAYING" ? { startedAt: now } : { finishedAt: now }),
        errorMessage:
          typeof report.errorMessage === "string" ? report.errorMessage.slice(0, 500) : null,
      },
    });
  }

  return db.audioJob.count({
    where: { zoneId: zone.id, status: "PENDING" },
  });
}
