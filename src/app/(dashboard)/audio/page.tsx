import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { AudioClient } from "@/components/audio/audio-client";
import {
  audioBackends,
  isPlayerOnline,
  listTtsVoices,
  pairableSeconds,
  parseZoneIds,
} from "@/lib/audio";

export const dynamic = "force-dynamic";

export default async function AudioPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [account, zones, tracks, playlists, announcements, schedules, jobs, audioDevices, ttsVoices] =
    await Promise.all([
      db.account.findUnique({ where: { id: accountId }, select: { timezone: true } }),
      db.audioZone.findMany({
        where: { accountId },
        include: {
          device: { select: { id: true, name: true, lastUpdate: true } },
          playlist: { select: { id: true, name: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      db.audioTrack.findMany({
        where: { accountId },
        orderBy: [{ kind: "asc" }, { title: "asc" }],
      }),
      db.audioPlaylist.findMany({
        where: { accountId },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: { track: { select: { id: true, durationSec: true } } },
          },
        },
        orderBy: { name: "asc" },
      }),
      db.audioAnnouncement.findMany({
        where: { accountId },
        orderBy: [{ isTemplate: "desc" }, { name: "asc" }],
      }),
      db.audioSchedule.findMany({
        where: { accountId },
        include: {
          announcement: { select: { id: true, name: true } },
          playlist: { select: { id: true, name: true } },
        },
        orderBy: { timeOfDay: "asc" },
      }),
      db.audioJob.findMany({
        where: { accountId },
        include: {
          zone: { select: { name: true } },
          announcement: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.device.findMany({
        where: { accountId, type: "AUDIO_PLAYER" },
        select: {
          id: true,
          name: true,
          systemInfo: true,
          audioZone: { select: { id: true } },
        },
        orderBy: { name: "asc" },
      }),
      listTtsVoices(),
    ]);

  return (
    <>
      <Header title="Audio" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <AudioClient
          zones={zones.map((z) => ({
            id: z.id,
            name: z.name,
            deviceId: z.deviceId,
            deviceName: z.device?.name ?? null,
            deviceOnline: isPlayerOnline(z.device?.lastUpdate),
            isActive: z.isActive,
            syncGroup: z.syncGroup,
            volume: z.volume,
            announcementVolume: z.announcementVolume,
            duckVolume: z.duckVolume,
            sourceKind: z.sourceKind,
            defaultSource: z.defaultSource,
            playlistId: z.playlistId,
            playlistName: z.playlist?.name ?? null,
            streamUrl: z.streamUrl,
            quietFrom: z.quietFrom,
            quietTo: z.quietTo,
            airplayEnabled: z.airplayEnabled,
            bluetoothEnabled: z.bluetoothEnabled,
            externalName: z.externalName,
            isPlaying: z.isPlaying,
            currentTitle: z.currentTitle,
            externalActive: z.externalActive,
            externalSender: z.externalSender,
            pairableFor: pairableSeconds(z.pairableUntil),
            lastStateAt: z.lastStateAt?.toISOString() ?? null,
          }))}
          tracks={tracks.map((t) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            kind: t.kind,
            url: t.url,
            durationSec: t.durationSec,
            sizeBytes: t.sizeBytes,
            createdAt: t.createdAt.toISOString(),
          }))}
          playlists={playlists.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            shuffle: p.shuffle,
            crossfadeSec: p.crossfadeSec,
            trackIds: p.items.map((i) => i.trackId),
            totalSec: p.items.reduce((sum, i) => sum + (i.track.durationSec ?? 0), 0),
          }))}
          announcements={announcements.map((a) => ({
            id: a.id,
            name: a.name,
            source: a.source,
            text: a.text,
            voice: a.voice,
            trackId: a.trackId,
            chime: a.chime,
            repeatCount: a.repeatCount,
            priority: a.priority,
            zoneIds: parseZoneIds(a.zoneIds),
            isTemplate: a.isTemplate,
            lastPlayedAt: a.lastPlayedAt?.toISOString() ?? null,
          }))}
          schedules={schedules.map((s) => ({
            id: s.id,
            name: s.name,
            isActive: s.isActive,
            action: s.action,
            daysOfWeek: s.daysOfWeek,
            timeOfDay: s.timeOfDay,
            zoneIds: parseZoneIds(s.zoneIds),
            announcementId: s.announcementId,
            announcementName: s.announcement?.name ?? null,
            playlistId: s.playlistId,
            playlistName: s.playlist?.name ?? null,
            volume: s.volume,
            lastRunAt: s.lastRunAt?.toISOString() ?? null,
          }))}
          jobs={jobs.map((j) => ({
            id: j.id,
            zoneName: j.zone.name,
            kind: j.kind,
            status: j.status,
            triggerKind: j.triggerKind,
            announcementName: j.announcement?.name ?? null,
            errorMessage: j.errorMessage,
            createdAt: j.createdAt.toISOString(),
          }))}
          audioDevices={audioDevices.map((d) => ({
            id: d.id,
            name: d.name,
            taken: !!d.audioZone,
            backends: audioBackends(d.systemInfo),
          }))}
          ttsVoices={ttsVoices}
          timeZone={account?.timezone || "Europe/Berlin"}
        />
      </div>
    </>
  );
}
