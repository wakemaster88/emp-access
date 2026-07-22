import { NextResponse } from "next/server";
import { readEvents } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? "200"));
  const events = await readEvents(limit);
  return NextResponse.json({ events });
}
