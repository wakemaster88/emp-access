/**
 * Geräte-Schnittstelle der Zonen-Abspieler (Raspberry Pi, `emp_audio`).
 *
 * GET  – Zonenkonfiguration + offene Jobs abholen (werden auf SENT gesetzt).
 * POST – Heartbeat mit Ist-Zustand und Statusmeldungen zu erledigten Jobs.
 *
 * Auth läuft wie bei den Scanner-Pis über das Account-API-Token.
 */
import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { clampVolume, pairableSeconds, parseExternalKind } from "@/lib/audio";

const JOB_BATCH_SIZE = 20;

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const deviceId = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(deviceId)) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  const { db } = auth;
  const zone = await db.audioZone.findFirst({
    where: { deviceId, device: { type: "AUDIO_PLAYER" } },
    include: {
      playlist: {
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: { track: { select: { id: true, title: true, url: true } } },
          },
        },
      },
    },
  });

  if (!zone) {
    return NextResponse.json({ error: "Zone not found" }, { status: 404 });
  }

  const jobs = await db.audioJob.findMany({
    where: { zoneId: zone.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: JOB_BATCH_SIZE,
  });

  if (jobs.length > 0) {
    await db.audioJob.updateMany({
      where: { id: { in: jobs.map((j) => j.id) } },
      data: { status: "SENT", sentAt: new Date() },
    });
  }

  return NextResponse.json({
    zone: {
      id: zone.id,
      name: zone.name,
      isActive: zone.isActive,
      syncGroup: zone.syncGroup,
      volume: zone.volume,
      announcementVolume: zone.announcementVolume,
      duckVolume: zone.duckVolume,
      sourceKind: zone.sourceKind,
      streamUrl: zone.streamUrl,
      quietFrom: zone.quietFrom,
      quietTo: zone.quietTo,
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
      playlist: zone.playlist
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
        : null,
    },
    jobs: jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      payload: job.payload,
      createdAt: job.createdAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const deviceId = Number(body.deviceId);
  if (!Number.isInteger(deviceId)) {
    return NextResponse.json({ error: "deviceId erforderlich" }, { status: 400 });
  }

  const { db } = auth;
  const zone = await db.audioZone.findFirst({
    where: { deviceId, device: { type: "AUDIO_PLAYER" } },
    select: { id: true, accountId: true, volume: true },
  });
  if (!zone) return NextResponse.json({ error: "Zone not found" }, { status: 404 });

  const now = new Date();

  // Übernahme durch AirPlay/Bluetooth. `null` heißt: der Sender hat wieder
  // freigegeben. Fehlt das Feld ganz, stammt der Heartbeat von einem älteren
  // Abspieler – dann bleibt der Zustand unverändert, statt eine laufende
  // Übernahme wegzuräumen.
  const external =
    body.externalSource === undefined
      ? undefined
      : (parseExternalKind(body.externalSource?.kind) ?? null);
  const externalSender =
    external === undefined
      ? undefined
      : external === null
        ? null
        : typeof body.externalSource.sender === "string" && body.externalSource.sender.trim()
          ? body.externalSource.sender.trim().slice(0, 120)
          : null;

  await db.device.updateMany({
    where: { id: deviceId, type: "AUDIO_PLAYER" },
    data: {
      lastUpdate: now,
      ...(body.systemInfo && typeof body.systemInfo === "object"
        ? { systemInfo: body.systemInfo }
        : {}),
    },
  });

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

  // Statusmeldungen zu Jobs: [{ id, status, errorMessage? }]
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

  const pending = await db.audioJob.count({
    where: { zoneId: zone.id, status: "PENDING" },
  });

  return NextResponse.json({ ok: true, pendingJobs: pending });
}
