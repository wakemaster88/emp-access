import { NextResponse } from "next/server";
import { detectLocalSubnet, scanForDoorbird } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let subnet: string | null = null;
  try {
    const body = await req.json();
    subnet = typeof body?.subnet === "string" ? body.subnet : null;
  } catch {
    /* leerer Body ist OK */
  }

  const sn = subnet ?? detectLocalSubnet();
  if (!sn) {
    return NextResponse.json({ error: "subnet konnte nicht erkannt werden" }, { status: 400 });
  }

  try {
    const found = await scanForDoorbird({ subnet: sn });
    return NextResponse.json({ ok: true, subnet: sn, found });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, subnet: sn },
      { status: 500 },
    );
  }
}
