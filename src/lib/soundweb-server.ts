/**
 * Serverseite des Soundweb-Moduls: Eingaben prüfen, Hub-Tasks anlegen und
 * Datensätze für Seite und Statusabfrage in eine Form bringen.
 *
 * Der Weg eines Befehls: Route → `HubTask` (SOUNDWEB_SET) → Hub schickt die
 * DI-Nachricht → Ergebnis im Task → Route schreibt den bestätigten Wert in
 * `SoundwebControl.value`. Änderungen an Geräten oder Reglern stoßen einen
 * SOUNDWEB_SYNC an, damit der Hub die Konfiguration sofort nachzieht statt
 * erst beim nächsten Fünf-Minuten-Takt.
 */
import type { Prisma, SoundwebControlKind } from "@prisma/client";
import type { TenantDb } from "@/lib/prisma";
import {
  SOUNDWEB_DEFAULT_PORT,
  parseHiqnetAddress,
  parseSelectOptions,
  parseStateVariable,
  soundwebOnline,
  type SoundwebSelectOption,
} from "@/lib/soundweb";

export const SOUNDWEB_KINDS: SoundwebControlKind[] = ["GAIN", "MUTE", "PERCENT", "SELECT", "PRESET"];

/** Hostname oder IPv4/IPv6 – kein Schema, kein Pfad. */
const HOST_PATTERN = /^[a-zA-Z0-9.:_-]{1,200}$/;

export type DeviceInput = {
  name: string;
  host: string;
  port: number;
  node: number;
  isActive: boolean;
  sortOrder: number;
};

export function parseDeviceInput(
  body: Record<string, unknown>,
  current?: Partial<DeviceInput>
): DeviceInput | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : current?.name ?? "";
  if (!name) return { error: "Name erforderlich" };
  if (name.length > 80) return { error: "Name zu lang (max. 80 Zeichen)" };

  const host = typeof body.host === "string" ? body.host.trim() : current?.host ?? "";
  if (!host) return { error: "IP-Adresse oder Hostname erforderlich" };
  if (!HOST_PATTERN.test(host)) return { error: "Host darf nur Buchstaben, Ziffern, Punkte und Bindestriche enthalten" };

  let port = current?.port ?? SOUNDWEB_DEFAULT_PORT;
  if (body.port !== undefined && body.port !== "" && body.port !== null) {
    port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Port muss zwischen 1 und 65535 liegen" };
  }

  let node = current?.node;
  if (body.node !== undefined && body.node !== null && body.node !== "") {
    const parsed = typeof body.node === "string" ? parseStateVariable(body.node) : body.node;
    node = typeof parsed === "number" ? parsed : Number.NaN;
  }
  if (node === undefined || !Number.isInteger(node) || node < 0 || node > 0xffff) {
    return { error: "HiQnet-Node muss zwischen 0 und 65535 liegen (z. B. 1 oder 0x0001)" };
  }

  const isActive = typeof body.isActive === "boolean" ? body.isActive : current?.isActive ?? true;
  const sortOrderRaw = body.sortOrder !== undefined ? Number(body.sortOrder) : current?.sortOrder ?? 0;
  const sortOrder = Number.isInteger(sortOrderRaw) ? sortOrderRaw : 0;

  return { name, host, port, node, isActive, sortOrder };
}

export type ControlInput = {
  name: string;
  group: string | null;
  kind: SoundwebControlKind;
  node: number | null;
  virtualDevice: number;
  objectId: number;
  stateVariable: number;
  minDb: number;
  maxDb: number;
  options: SoundwebSelectOption[] | null;
  presetId: number | null;
  sortOrder: number;
};

/**
 * Regler aus dem Dialog prüfen. Die Adresse kommt als Text, wie Audio Architect
 * sie zeigt; die SV getrennt (oder in der Adresse enthalten). Presets brauchen
 * keine Adresse, dafür eine Preset-ID.
 */
export function parseControlInput(
  body: Record<string, unknown>,
  current?: Partial<ControlInput>
): ControlInput | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : current?.name ?? "";
  if (!name) return { error: "Name erforderlich" };
  if (name.length > 80) return { error: "Name zu lang (max. 80 Zeichen)" };

  let group: string | null = current?.group ?? null;
  if (body.group !== undefined) {
    const g = typeof body.group === "string" ? body.group.trim() : "";
    group = g ? g.slice(0, 60) : null;
  }

  const kindRaw = typeof body.kind === "string" ? body.kind : current?.kind;
  if (!kindRaw || !SOUNDWEB_KINDS.includes(kindRaw as SoundwebControlKind)) {
    return { error: "Art des Reglers fehlt" };
  }
  const kind = kindRaw as SoundwebControlKind;

  const sortOrderRaw = body.sortOrder !== undefined ? Number(body.sortOrder) : current?.sortOrder ?? 0;
  const sortOrder = Number.isInteger(sortOrderRaw) ? sortOrderRaw : 0;

  let node = current?.node ?? null;
  let virtualDevice = current?.virtualDevice ?? 3;
  let objectId = current?.objectId ?? 0;
  let stateVariable = current?.stateVariable ?? 0;
  let presetId = current?.presetId ?? null;

  if (kind === "PRESET") {
    const raw = body.presetId ?? presetId;
    const n = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
    if (!Number.isInteger(n) || n < 0) return { error: "Preset-ID fehlt (Zahl in eckigen Klammern im Design-Baum)" };
    presetId = n;
  } else {
    if (typeof body.address === "string" && body.address.trim()) {
      const parsed = parseHiqnetAddress(body.address);
      if ("error" in parsed) return parsed;
      node = parsed.node;
      virtualDevice = parsed.virtualDevice;
      objectId = parsed.objectId;
      if (parsed.stateVariable !== null) stateVariable = parsed.stateVariable;
    } else if (!current || body.address === "") {
      return { error: "HiQnet-Adresse fehlt" };
    }
    if (body.stateVariable !== undefined && body.stateVariable !== "" && body.stateVariable !== null) {
      const sv = parseStateVariable(body.stateVariable as string | number);
      if (typeof sv !== "number") return sv;
      stateVariable = sv;
    }
    if (virtualDevice < 0 || virtualDevice > 0xff) return { error: "Virtual Device muss zwischen 0 und 255 liegen" };
    if (objectId < 0 || objectId > 0xffffff) return { error: "Objektadresse muss zwischen 0 und 0xFFFFFF liegen" };
    if (node !== null && (node < 0 || node > 0xffff)) return { error: "Node muss zwischen 0 und 65535 liegen" };
  }

  let minDb = current?.minDb ?? -80;
  let maxDb = current?.maxDb ?? 10;
  if (kind === "GAIN") {
    if (body.minDb !== undefined && body.minDb !== "") minDb = Number(body.minDb);
    if (body.maxDb !== undefined && body.maxDb !== "") maxDb = Number(body.maxDb);
    if (!Number.isFinite(minDb) || !Number.isFinite(maxDb)) return { error: "dB-Bereich ist keine Zahl" };
    if (minDb < -100 || maxDb > 30) return { error: "dB-Bereich: mindestens -100, höchstens +30" };
    if (minDb >= maxDb) return { error: "Der untere dB-Wert muss unter dem oberen liegen" };
  }

  let options: SoundwebSelectOption[] | null = current?.options ?? null;
  if (kind === "SELECT") {
    if (body.options !== undefined) {
      options = typeof body.options === "string" ? parseOptionLines(body.options) : parseSelectOptions(body.options);
    }
    if (!options || options.length === 0) {
      return { error: "Auswahl braucht mindestens einen Wert (eine Zeile je Eintrag: Wert=Bezeichnung)" };
    }
    if (options.length > 64) return { error: "Höchstens 64 Auswahlwerte" };
  } else {
    options = null;
  }

  return { name, group, kind, node, virtualDevice, objectId, stateVariable, minDb, maxDb, options, presetId, sortOrder };
}

/** "0=CD\n1=Mikrofon" → Optionen; Zeilen ohne "=" nehmen die Zeilennummer als Wert. */
export function parseOptionLines(text: string): SoundwebSelectOption[] {
  const out: SoundwebSelectOption[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, index) => {
    const eq = line.indexOf("=");
    if (eq === -1) {
      out.push({ value: index, label: line.slice(0, 60) });
      return;
    }
    const value = Number(line.slice(0, eq).trim());
    const label = line.slice(eq + 1).trim().slice(0, 60);
    if (!Number.isInteger(value)) return;
    out.push({ value, label: label || String(value) });
  });
  return out;
}

/** Optionen als JSON-Wert für Prisma – die Schnittstelle hat keine Index-Signatur. */
export function optionsToJson(options: SoundwebSelectOption[]): Prisma.InputJsonArray {
  return options.map((o) => ({ value: o.value, label: o.label }));
}

export function optionsToLines(options: unknown): string {
  return parseSelectOptions(options)
    .map((o) => `${o.value}=${o.label}`)
    .join("\n");
}

/**
 * Hub anstoßen, die Soundweb-Konfiguration neu zu holen. Liegt schon ein
 * offener Sync-Task, reicht der – der Hub lädt ohnehin den aktuellen Stand.
 */
export async function queueSoundwebSync(db: TenantDb, accountId: number): Promise<void> {
  const pending = await db.hubTask.findFirst({
    where: { accountId, type: "SOUNDWEB_SYNC", status: "PENDING" },
    select: { id: true },
  });
  if (pending) return;
  await db.hubTask.create({ data: { type: "SOUNDWEB_SYNC", accountId } });
}

/** Wie lange der Hub sich nicht gemeldet haben darf, um noch als online zu gelten. */
const HUB_ONLINE_WITHIN_MS = 5 * 60_000;

export async function hubOnline(db: TenantDb, accountId: number): Promise<boolean> {
  const hub = await db.hubAgent.findFirst({
    where: { accountId, lastSeenAt: { gte: new Date(Date.now() - HUB_ONLINE_WITHIN_MS) } },
    select: { id: true },
  });
  return !!hub;
}

export const soundwebDeviceInclude = {
  controls: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
} satisfies Prisma.SoundwebDeviceInclude;

type DeviceWithControls = Prisma.SoundwebDeviceGetPayload<{ include: typeof soundwebDeviceInclude }>;

/** Form der Daten für Seite und Client (Datumswerte als ISO-Text). */
export function serializeSoundwebDevice(device: DeviceWithControls) {
  return {
    id: device.id,
    name: device.name,
    host: device.host,
    port: device.port,
    node: device.node,
    isActive: device.isActive,
    sortOrder: device.sortOrder,
    connected: device.connected,
    online: soundwebOnline(device),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    lastError: device.lastError,
    hubName: device.hubName,
    controls: device.controls.map((c) => ({
      id: c.id,
      deviceId: c.deviceId,
      name: c.name,
      group: c.group,
      kind: c.kind,
      node: c.node,
      virtualDevice: c.virtualDevice,
      objectId: c.objectId,
      stateVariable: c.stateVariable,
      minDb: c.minDb,
      maxDb: c.maxDb,
      options: parseSelectOptions(c.options),
      presetId: c.presetId,
      sortOrder: c.sortOrder,
      value: c.value,
      valueAt: c.valueAt?.toISOString() ?? null,
    })),
  };
}

export type SoundwebDeviceDto = ReturnType<typeof serializeSoundwebDevice>;
