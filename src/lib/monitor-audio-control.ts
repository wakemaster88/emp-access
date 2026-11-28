/**
 * Taste „Audio“ am Check-in-Monitor: Zustand der Zone, die dieser Monitor
 * abspielt, und ihre Steuerung über den Link des Monitors – Start/Stopp,
 * Lautstärke und „Musik stumm“.
 *
 * Stumm heißt: Die Musik läuft lautlos weiter (Titel, Folgen, Automatik
 * bleiben, wie sie sind), Durchsagen klingen wie immer. Es gilt längstens bis
 * Mitternacht (`musicMuteUntil`). Nur der Monitor als Abspieler setzt es um –
 * der Pi kennt das Feld nicht, deshalb gibt es Stumm nur für Zonen mit Monitor.
 */
import type { Prisma } from "@prisma/client";
import type { TenantDb } from "@/lib/prisma";
import { isMusicMuted, musicMuteUntil, zonePlayerOnline } from "@/lib/audio";
import { controlAudioZone, type AudioControlResult } from "@/lib/audio-integration";
import type { MonitorAudioControlView, MonitorControlAction } from "@/lib/monitor-audio";

/** Herkunft im Audio-Verlauf (`AudioJob.triggerKind`). */
export const MONITOR_CONTROL_TRIGGER = "MONITOR";

export const monitorControlZoneSelect = {
  id: true,
  name: true,
  isActive: true,
  isPlaying: true,
  currentTitle: true,
  volume: true,
  musicMutedUntil: true,
  lastStateAt: true,
  monitorId: true,
  defaultSource: true,
  streamId: true,
  streamUrl: true,
  playlistId: true,
  followZoneId: true,
  stream: { select: { name: true } },
  playlist: { select: { name: true } },
  followZone: { select: { name: true } },
} satisfies Prisma.AudioZoneSelect;

export type MonitorControlZone = Prisma.AudioZoneGetPayload<{ select: typeof monitorControlZoneSelect }>;

export function monitorControlView(zone: MonitorControlZone, now = new Date()): MonitorAudioControlView {
  const following = zone.followZoneId ? (zone.followZone?.name ?? "einer anderen Zone") : null;
  const sourceName =
    zone.defaultSource === "STREAM"
      ? (zone.stream?.name ?? "Webradio")
      : zone.defaultSource === "PLAYLIST"
        ? (zone.playlist?.name ?? "Playlist")
        : null;
  const startBlocked = !zone.isActive
    ? "Zone ist deaktiviert"
    : !following && !sourceName
      ? "Keine Quelle eingestellt (Audio › Zonen)"
      : null;
  return {
    name: zone.name,
    isActive: zone.isActive,
    isPlaying: zone.isPlaying,
    online: zonePlayerOnline(zone),
    currentTitle: zone.currentTitle,
    volume: zone.volume,
    mutedUntil: isMusicMuted(zone.musicMutedUntil, now) ? zone.musicMutedUntil!.toISOString() : null,
    following,
    sourceName,
    startBlocked,
  };
}

/** Musik der Zone stumm schalten (bis Mitternacht) oder wieder hörbar machen. */
export async function setZoneMusicMuted(
  db: TenantDb,
  zoneId: number,
  muted: boolean,
  now = new Date()
): Promise<Date | null> {
  let until: Date | null = null;
  if (muted) {
    const zone = await db.audioZone.findFirst({
      where: { id: zoneId },
      select: { account: { select: { timezone: true } } },
    });
    until = musicMuteUntil(now, zone?.account.timezone ?? "Europe/Berlin");
  }
  await db.audioZone.update({ where: { id: zoneId }, data: { musicMutedUntil: until } });
  return until;
}

/** Ein Befehl der Taste „Audio“ an die Zone dieses Monitors. */
export async function runMonitorControl(
  db: TenantDb,
  accountId: number,
  zone: MonitorControlZone,
  input: MonitorControlAction
): Promise<AudioControlResult> {
  if (input.action === "MUTE" || input.action === "UNMUTE") {
    await setZoneMusicMuted(db, zone.id, input.action === "MUTE");
    return { ok: true };
  }
  if (input.action === "PLAY") {
    const blocked = monitorControlView(zone).startBlocked;
    if (blocked) return { ok: false, error: blocked, status: 409 };
  }
  return controlAudioZone(db, accountId, zone, {
    action: input.action,
    volume: input.action === "VOLUME" ? input.volume : undefined,
    triggerKind: MONITOR_CONTROL_TRIGGER,
  });
}
