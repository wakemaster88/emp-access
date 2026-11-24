import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findRiderAuthProfile, riderRelation } from "@/lib/rider-auth";
import { decodeImageDataUrl } from "@/lib/photo-url";

/**
 * GET: Profilbild einer Person für ihr Profil in der Kunden-App. Sehen darf es,
 * wer auch die Profilseite sehen darf: die Person selbst und ihre Familie
 * (Eltern, Partner). `?v=` (aus `updatedAt`) ist nur der Cache-Schlüssel.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const profile = await findRiderAuthProfile(token);
  if (!profile) return new NextResponse(null, { status: 404 });
  if ((await riderRelation(profile)) == null) return new NextResponse(null, { status: 401 });

  const row = await prisma.riderProfile.findFirst({
    where: { id: profile.id, accountId: profile.accountId },
    select: { photo: true },
  });
  const decoded = row?.photo ? decodeImageDataUrl(row.photo) : null;
  if (!decoded) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(decoded.bytes), {
    headers: {
      "Content-Type": decoded.contentType,
      // Ein neues Bild ändert `updatedAt` und damit die Adresse; die alte bleibt gleich.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
