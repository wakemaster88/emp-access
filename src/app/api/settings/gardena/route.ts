import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { gardenaListValves } from "@/lib/gardena";

// GARDENA-Zugangsdaten liegen in ApiConfig (provider = GARDENA), mehrere pro
// Account moeglich (mehrere GARDENA-Konten):
//   name        = Label der Verbindung
//   token       = Application Key (client_id / X-Api-Key)
//   extraConfig = Application Secret (client_secret)

function maskKey(key: string | null): string {
  if (!key) return "";
  const k = key.trim();
  return k.length <= 6 ? k : `…${k.slice(-6)}`;
}

// Verbindungen listen ODER (mit ?configId=) Ventile einer gespeicherten
// Verbindung laden.
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const configIdParam = request.nextUrl.searchParams.get("configId");

  if (configIdParam) {
    const configId = Number(configIdParam);
    const config = await db.apiConfig.findFirst({
      where: { id: configId, accountId: accountId!, provider: "GARDENA" },
    });
    if (!config?.token || !config?.extraConfig) {
      return NextResponse.json({ error: "Verbindung nicht gefunden" }, { status: 404 });
    }
    // Import-Dialog: frisch laden, damit neu hinzugefuegte Geraete auftauchen.
    const res = await gardenaListValves(config.token, config.extraConfig, { fresh: true });
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error ?? "GARDENA Anfrage fehlgeschlagen" },
        { status: res.status === 401 || res.status === 403 ? 401 : 502 },
      );
    }
    return NextResponse.json({ ok: true, valves: res.valves });
  }

  const configs = await db.apiConfig.findMany({
    where: { accountId: accountId!, provider: "GARDENA" },
    orderBy: { createdAt: "asc" },
  });
  const gardenaDevices = await db.device.findMany({
    where: { accountId: accountId!, type: "GARDENA_VALVE" },
    select: { gardenaConfigId: true },
  });
  const countByConfig = new Map<number, number>();
  for (const d of gardenaDevices) {
    if (d.gardenaConfigId == null) continue;
    countByConfig.set(d.gardenaConfigId, (countByConfig.get(d.gardenaConfigId) ?? 0) + 1);
  }

  return NextResponse.json({
    connections: configs.map((c) => ({
      id: c.id,
      name: c.name ?? "GARDENA",
      keyMasked: maskKey(c.token),
      deviceCount: countByConfig.get(c.id) ?? 0,
    })),
  });
}

// Verbindung testen mit uebergebenen Zugangsdaten (Key + Secret).
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { applicationKey, applicationSecret } = body as {
    applicationKey?: string;
    applicationSecret?: string;
  };

  if (!applicationKey?.trim() || !applicationSecret?.trim()) {
    return NextResponse.json(
      { error: "Application Key und Application Secret erforderlich" },
      { status: 400 },
    );
  }

  const res = await gardenaListValves(applicationKey.trim(), applicationSecret.trim(), { fresh: true });
  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403
        ? "Ungültige Zugangsdaten – Application Key/Secret prüfen und sicherstellen, dass die GARDENA smart system API mit deiner Anwendung verbunden ist."
        : res.error ?? "Verbindung fehlgeschlagen";
    return NextResponse.json({ error: msg }, { status: res.status === 401 || res.status === 403 ? 401 : 502 });
  }

  return NextResponse.json({ ok: true, valves: res.valves });
}

// Verbindung anlegen (ohne id) oder aktualisieren (mit id).
export async function PUT(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { id, name, applicationKey, applicationSecret } = body as {
    id?: number;
    name?: string;
    applicationKey?: string;
    applicationSecret?: string;
  };

  const { db, accountId } = session;
  const label = name?.trim() || "GARDENA";

  // Update einer bestehenden Verbindung.
  if (id) {
    const existing = await db.apiConfig.findFirst({
      where: { id: Number(id), accountId: accountId!, provider: "GARDENA" },
    });
    if (!existing) return NextResponse.json({ error: "Verbindung nicht gefunden" }, { status: 404 });

    const updated = await db.apiConfig.update({
      where: { id: existing.id },
      data: {
        name: label,
        token: applicationKey?.trim() || existing.token,
        // Leeres Secret => bestehendes behalten.
        extraConfig: applicationSecret?.trim() || existing.extraConfig,
        lastUpdate: new Date(),
      },
    });
    return NextResponse.json({
      id: updated.id, name: updated.name ?? "GARDENA", keyMasked: maskKey(updated.token),
    });
  }

  // Neue Verbindung – Key + Secret erforderlich.
  if (!applicationKey?.trim() || !applicationSecret?.trim()) {
    return NextResponse.json(
      { error: "Application Key und Application Secret erforderlich" },
      { status: 400 },
    );
  }

  const created = await db.apiConfig.create({
    data: {
      accountId: accountId!,
      provider: "GARDENA",
      name: label,
      token: applicationKey.trim(),
      extraConfig: applicationSecret.trim(),
    },
  });
  return NextResponse.json(
    { id: created.id, name: created.name ?? "GARDENA", keyMasked: maskKey(created.token) },
    { status: 201 },
  );
}

// Einzelnes Ventil/Pumpe als Device importieren (Upsert ueber gardenaServiceId),
// zugeordnet zur angegebenen GARDENA-Verbindung (configId).
export async function PATCH(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { serviceId, name, configId } = body as {
    serviceId?: string;
    name?: string;
    configId?: number;
  };

  if (!serviceId || !name) {
    return NextResponse.json({ error: "serviceId und name erforderlich" }, { status: 400 });
  }

  const { db, accountId } = session;

  // configId (falls angegeben) muss eine GARDENA-Verbindung des Accounts sein.
  let gardenaConfigId: number | null = null;
  if (configId) {
    const cfg = await db.apiConfig.findFirst({
      where: { id: Number(configId), accountId: accountId!, provider: "GARDENA" },
      select: { id: true },
    });
    if (!cfg) return NextResponse.json({ error: "Verbindung nicht gefunden" }, { status: 404 });
    gardenaConfigId = cfg.id;
  }

  const existing = await db.device.findFirst({
    where: { accountId: accountId!, gardenaServiceId: serviceId },
  });

  let device;
  if (existing) {
    device = await db.device.update({
      where: { id: existing.id },
      data: { name, ...(gardenaConfigId ? { gardenaConfigId } : {}) },
    });
  } else {
    device = await db.device.create({
      data: {
        name,
        type: "GARDENA_VALVE",
        category: "SCHALTER",
        gardenaServiceId: serviceId,
        gardenaConfigId,
        isActive: true,
        accountId: accountId!,
      },
    });
  }

  return NextResponse.json(device, { status: existing ? 200 : 201 });
}

// Einzelne GARDENA-Verbindung trennen (?configId=). Ohne configId: alle.
export async function DELETE(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const configIdParam = request.nextUrl.searchParams.get("configId");

  if (configIdParam) {
    const configId = Number(configIdParam);
    await db.apiConfig.deleteMany({
      where: { id: configId, accountId: accountId!, provider: "GARDENA" },
    });
  } else {
    await db.apiConfig.deleteMany({ where: { accountId: accountId!, provider: "GARDENA" } });
  }
  return NextResponse.json({ ok: true });
}
