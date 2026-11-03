import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { deleteAllowedVehicle, updateAllowedVehicle } from "@/lib/allowed-vehicle-service";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;
  const r = await updateAllowedVehicle(db, accountId!, Number(id), await request.json());
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;
  const r = await deleteAllowedVehicle(db, accountId!, Number(id));
  return NextResponse.json(r.body, { status: r.status });
}
