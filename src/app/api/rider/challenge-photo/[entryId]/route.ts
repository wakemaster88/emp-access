import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionRider } from "@/lib/rider-auth";
import { entryImage, entryThumb } from "@/lib/challenge-voting";
import { challengePhotosShown, photoContentType } from "@/lib/challenge-voting-rules";
import { publicRateLimit } from "@/lib/rate-limit";
import { berlinYmd } from "@/lib/berlin-day";
import { dbDateToYmd } from "@/lib/gamification";

/** Anfragegrenze je Profil; der Browser behält jedes Foto einen Tag im Cache. */
const PHOTO_LIMIT = { limit: 120, windowMs: 60_000 } as const;

/**
 * GET: Foto einer Foto-Challenge für angemeldete Kunden desselben Kontos,
 * solange die App die Challenge zeigt (eingeschaltet, laufend oder kürzlich
 * beendet, siehe `challengePhotosShown`). Danach und bei ausgeblendeten Fotos
 * nur für die Person selbst (bzw. ihre Familie).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
  const id = Number((await params).entryId);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 400 });
  const viewer = await sessionRider();
  if (!viewer) return new NextResponse(null, { status: 401 });
  const limited = publicRateLimit(`p${viewer.id}`, "rider-challenge-photo", PHOTO_LIMIT);
  if (limited) return limited;

  const entry = await prisma.challengeEntry.findFirst({
    where: { id, accountId: viewer.accountId },
    select: {
      imageBlob: true, image: true, thumbBlob: true, thumb: true, hidden: true, profileId: true,
      profile: { select: { familyId: true } },
      challenge: { select: { active: true, endDate: true } },
    },
  });
  if (!entry) return new NextResponse(null, { status: 404 });
  const own = entry.profileId === viewer.id || (viewer.familyId != null && entry.profile.familyId === viewer.familyId);
  if (entry.hidden && !own) return new NextResponse(null, { status: 404 });
  const shown = challengePhotosShown(
    { active: entry.challenge.active, endYmd: dbDateToYmd(entry.challenge.endDate) },
    berlinYmd(new Date()),
  );
  if (!shown && !own) return new NextResponse(null, { status: 404 });

  // `?klein`: Vorschaubild fürs Raster, sonst das Foto in voller Größe.
  const small = request.nextUrl.searchParams.has("klein");
  const bytes = small ? await entryThumb(entry) : await entryImage(entry);
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": photoContentType(bytes),
      // Ein neues Foto bekommt eine neue ID, die alte Adresse ändert sich also nie.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
