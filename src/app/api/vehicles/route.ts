import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { createAllowedVehicle, listAllowedVehicles } from "@/lib/allowed-vehicle-service";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  return NextResponse.json(await listAllowedVehicles(db, accountId!));
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const r = await createAllowedVehicle(db, accountId!, await request.json());
  return NextResponse.json(r.body, { status: r.status });
}
