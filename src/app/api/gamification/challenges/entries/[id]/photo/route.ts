import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { entryImage } from "@/lib/challenge-voting";
import { photoContentType } from "@/lib/challenge-voting-rules";

/** GET: Foto einer Foto-Challenge für die Verwaltung (auch ausgeblendete). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 400 });
  const entry = await session.db.challengeEntry.findFirst({
    where: { id, accountId: session.accountId },
    select: { imageBlob: true, image: true },
  });
  const bytes = entry ? await entryImage(entry) : null;
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": photoContentType(bytes), "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
