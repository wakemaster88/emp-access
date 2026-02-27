import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { piStatusSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const piId = request.nextUrl.searchParams.get("id");
  if (!piId) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  const { db } = auth;
  const device = await db.device.findFirst({
    where: { id: Number(piId), type: "RASPBERRY_PI" },
  });

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  return NextResponse.json({
    pis_id: device.id,
    pis_name: device.name,
    pis_type: device.type,
    pis_in: device.accessIn,
    pis_out: device.accessOut,
    pis_active: device.isActive ? 1 : 0,
    pis_task: device.task,
    pis_again: device.allowReentry ? 1 : 0,
    pis_firmware: device.firmware,
  });
}

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const parsed = piStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { db } = auth;
  const results = [];

  for (const update of parsed.data) {
    // Task nur vom Dashboard setzen; beim Pi nur lastUpdate/systemInfo aktualisieren.
    // Ausnahme: Task 1 (Einmal öffnen) zurücksetzen, wenn Pi bestätigt (pis_task: 0).
    const data: Record<string, unknown> = {
      lastUpdate: new Date(update.pis_update * 1000),
    };
    if (update.system_info) {
      data.systemInfo = update.system_info;
    }
    const current = await db.device.findFirst({
      where: { id: update.pis_id, type: "RASPBERRY_PI" },
      select: { task: true },
    });
    if (current?.task === 1 && update.pis_task === 0) {
      data.task = 0;
    }
    const device = await db.device.updateMany({
      where: { id: update.pis_id, type: "RASPBERRY_PI" },
      data,
    });
    results.push({ pis_id: update.pis_id, updated: device.count > 0 });
  }

  return NextResponse.json({ results });
}
