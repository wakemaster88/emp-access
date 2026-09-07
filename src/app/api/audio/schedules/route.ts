import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { clampVolume, parseDaysOfWeek, parseZoneIds } from "@/lib/audio";
import { parseScheduleTiming, scheduleResponseInclude } from "@/lib/audio-schedule-input";

const ACTIONS = ["ANNOUNCE", "PLAY", "STOP", "VOLUME"] as const;
type Action = (typeof ACTIONS)[number];

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const schedules = await db.audioSchedule.findMany({
    where: { accountId: accountId! },
    include: scheduleResponseInclude,
    orderBy: [{ trigger: "asc" }, { timeOfDay: "asc" }, { offsetMinutes: "asc" }],
  });
  return NextResponse.json(schedules);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = await request.json();

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name erforderlich" }, { status: 400 });

  // Zeitpunkt: feste Uhrzeit oder Betriebsbeginn/-ende mit Versatz.
  const timing = await parseScheduleTiming(db, accountId!, body, null);
  if ("error" in timing) return NextResponse.json({ error: timing.error }, { status: 400 });

  if (!ACTIONS.includes(body.action as Action)) {
    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  }
  const action = body.action as Action;

  let announcementId: number | null = null;
  if (action === "ANNOUNCE") {
    const candidate = Number(body.announcementId);
    const announcement = await db.audioAnnouncement.findFirst({
      where: { id: candidate, accountId: accountId! },
      select: { id: true },
    });
    if (!announcement) {
      return NextResponse.json({ error: "Durchsage nicht gefunden" }, { status: 404 });
    }
    announcementId = candidate;
  }

  let playlistId: number | null = null;
  if (action === "PLAY") {
    const candidate = Number(body.playlistId);
    const playlist = await db.audioPlaylist.findFirst({
      where: { id: candidate, accountId: accountId! },
      select: { id: true },
    });
    if (!playlist) {
      return NextResponse.json({ error: "Playlist nicht gefunden" }, { status: 404 });
    }
    playlistId = candidate;
  }

  const requestedZones = parseZoneIds(body.zoneIds);
  let zoneIds: number[] = [];
  if (requestedZones.length > 0) {
    const owned = await db.audioZone.findMany({
      where: { id: { in: requestedZones }, accountId: accountId! },
      select: { id: true },
    });
    zoneIds = owned.map((z) => z.id);
  }

  const schedule = await db.audioSchedule.create({
    data: {
      accountId: accountId!,
      name,
      action,
      isActive: body.isActive ?? true,
      daysOfWeek: parseDaysOfWeek(body.daysOfWeek),
      ...timing,
      zoneIds,
      announcementId,
      playlistId,
      volume: action === "VOLUME" ? clampVolume(body.volume, 50) : null,
    },
    include: scheduleResponseInclude,
  });

  return NextResponse.json(schedule, { status: 201 });
}
