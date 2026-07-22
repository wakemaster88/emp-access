import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

/**
 * GET (Hub): aktive Whitelist-Kennzeichen fuer lokale Plate-OCR-Disambiguierung.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const rows = await db.allowedVehicle.findMany({
    where: { accountId: account.id, isActive: true },
    select: {
      id: true,
      name: true,
      plate: true,
      plateNormalized: true,
    },
    orderBy: { id: "asc" },
  });

  return NextResponse.json({ vehicles: rows });
}
