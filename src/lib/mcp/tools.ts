/**
 * Werkzeuge der MCP-Schnittstelle (/api/mcp).
 *
 * Zwei Quellen:
 *  - Cloud: liest direkt aus der Datenbank (Tickets, Zutritte, Geräte,
 *    Vereinsbuchungen, Fahrzeuge, Fundsachen, Hub-Meldungen) und schaltet
 *    Geräte über denselben Weg wie die Oberfläche.
 *  - Hub: Werkzeuge des Hub-Assistenten (hub/src/agent/tools.ts), als
 *    Hub-Task AGENT_TOOL weitergereicht. Der Hub prüft die Freigabeliste
 *    selbst noch einmal (hub/src/agent/mcp-bridge.ts).
 *
 * Bewusst NICHT vorhanden: Änderungen an Router, Switches, VLANs, DHCP, WLAN
 * oder Firewall, Tickets anlegen/löschen, Regeln oder Einstellungen ändern.
 */
import type { TenantDb } from "@/lib/prisma";
import { waitForHubTask } from "@/lib/hub-task-wait";
import { isValidDeviceAction, isActionAllowedForDevice, triggerDeviceAction, deviceSendsRemoteCommand } from "@/lib/device-open";
import { availableDeviceActions, isAudioDevice } from "@/lib/device-controls";
import { audioInputFromDeviceAction, controlAudioDevice } from "@/lib/audio-integration";
import { runDeviceSwitchedRules } from "@/lib/room-rules";
import { deviceSwitchLevel } from "./device-level";
import { describeDay, isOperatingAt, openingForDay } from "@/lib/operating-hours";
import { scheduleSpecInclude, toScheduleSpec } from "@/lib/operating-queries";
import { ruleInclude } from "@/lib/room-rule-queries";
import { DEFAULT_TIMEZONE, addDaysToYmd, tzYmd } from "@/lib/tz-time";
import { McpToolError, type McpLevel, type McpTool } from "./protocol";

export interface McpCtx {
  db: TenantDb;
  accountId: number;
  tokenName: string;
}

type Tool = McpTool<McpCtx>;
type Args = Record<string, unknown>;

// ---------- kleine Eingabe-Helfer ----------

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const int = (description: string, min?: number, max?: number) => ({
  type: "integer",
  description,
  ...(min != null ? { minimum: min } : {}),
  ...(max != null ? { maximum: max } : {}),
});
const bool = (description: string) => ({ type: "boolean", description });

export function argInt(args: Args, key: string, def: number, min: number, max: number): number {
  const v = args[key];
  if (v == null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new McpToolError(`${key} muss eine Zahl sein`);
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function argStr(args: Args, key: string, opts: { required?: boolean; max?: number } = {}): string | undefined {
  const v = args[key];
  if (v == null || v === "") {
    if (opts.required) throw new McpToolError(`${key} fehlt`);
    return undefined;
  }
  const s = String(v).trim();
  if (opts.required && !s) throw new McpToolError(`${key} fehlt`);
  return s.slice(0, opts.max ?? 200);
}

function argEnum<T extends string>(args: Args, key: string, values: readonly T[]): T | undefined {
  const s = argStr(args, key);
  if (s == null) return undefined;
  const hit = values.find((v) => v.toLowerCase() === s.toLowerCase());
  if (!hit) throw new McpToolError(`${key} muss eins von ${values.join(", ")} sein`);
  return hit;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const berlin = (d: Date | null | undefined) =>
  d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : null;

// ---------- Hub-Weiterleitung ----------

const HUB_ONLINE_MS = 3 * 60_000;
const HUB_WAIT_MS = 25_000;

async function hubOnline(ctx: McpCtx): Promise<void> {
  const hub = await ctx.db.hubAgent.findFirst({
    where: { accountId: ctx.accountId },
    orderBy: { lastSeenAt: "desc" },
    select: { name: true, lastSeenAt: true },
  });
  if (!hub) throw new McpToolError("Kein Hub eingerichtet – diese Abfrage läuft nur über den Hub vor Ort.");
  if (!hub.lastSeenAt || Date.now() - hub.lastSeenAt.getTime() > HUB_ONLINE_MS) {
    throw new McpToolError(`Der Hub „${hub.name}“ ist offline (zuletzt gesehen ${berlin(hub.lastSeenAt) ?? "nie"}).`);
  }
}

/**
 * Hub-Task anlegen und auf das Ergebnis warten. Kommt keine Antwort, wird der
 * Task abgebrochen, und `expiresAt` hält den Hub davon ab, ihn später doch
 * noch auszuführen (z. B. ein Tor Minuten nach der Frage zu öffnen).
 */
async function runHubTask(ctx: McpCtx, type: string, payload: Record<string, unknown>): Promise<unknown> {
  await hubOnline(ctx);
  const task = await ctx.db.hubTask.create({
    data: {
      accountId: ctx.accountId,
      type,
      payload: { ...payload, source: "mcp", expiresAt: new Date(Date.now() + HUB_WAIT_MS).toISOString() } as object,
    },
    select: { id: true },
  });
  const outcome = await waitForHubTask(ctx.db, task.id, HUB_WAIT_MS);
  if (outcome.status === "DONE") return outcome.result;
  if (outcome.status === "FAILED") throw new McpToolError(outcome.error);
  await ctx.db.hubTask
    .updateMany({
      where: { id: task.id, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "FAILED", error: "MCP: keine Antwort, abgebrochen", finishedAt: new Date() },
    })
    .catch(() => undefined);
  throw new McpToolError("Der Hub hat nicht rechtzeitig geantwortet. Bitte gleich noch einmal versuchen.");
}

/** Werkzeug des Hub-Assistenten weiterreichen. */
function hubTool(def: {
  name: string;
  title: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  level?: McpLevel;
  levelFor?: Tool["levelFor"];
}): Tool {
  const level = def.level ?? "read";
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema ?? obj(),
    level,
    levelFor: def.levelFor,
    run: async (args, ctx) => {
      const need = (def.levelFor ? await def.levelFor(args, ctx) : null) ?? level;
      return runHubTask(ctx, "AGENT_TOOL", { tool: def.name, args, level: need });
    },
  };
}

// ---------- Kamera finden ----------

async function findCamera(ctx: McpCtx, ref: string) {
  const id = Number(ref);
  const cams = await ctx.db.camera.findMany({
    where: { accountId: ctx.accountId },
    select: { id: true, name: true, kind: true, enabled: true },
    orderBy: { name: "asc" },
  });
  const cam =
    (Number.isInteger(id) ? cams.find((c) => c.id === id) : undefined) ??
    cams.find((c) => c.name.toLowerCase() === ref.toLowerCase()) ??
    (() => {
      const hits = cams.filter((c) => c.name.toLowerCase().includes(ref.toLowerCase()));
      return hits.length === 1 ? hits[0] : undefined;
    })();
  if (!cam) {
    throw new McpToolError(`Kamera „${ref}“ nicht gefunden. Vorhanden: ${cams.map((c) => `${c.id} ${c.name}`).join(", ")}`);
  }
  return cam;
}

async function findDevice(ctx: McpCtx, ref: string) {
  const id = Number(ref);
  const select = { id: true, name: true, type: true, category: true, isActive: true } as const;
  if (Number.isInteger(id)) {
    const d = await ctx.db.device.findFirst({ where: { id, accountId: ctx.accountId }, select });
    if (d) return d;
  }
  const hits = await ctx.db.device.findMany({
    where: { accountId: ctx.accountId, name: { contains: ref, mode: "insensitive" } },
    select,
    take: 10,
  });
  const exact = hits.find((d) => d.name.toLowerCase() === ref.toLowerCase());
  if (exact) return exact;
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new McpToolError(`Mehrdeutig: ${hits.map((d) => `${d.id} ${d.name}`).join(", ")}. Bitte die ID angeben.`);
  }
  throw new McpToolError(`Gerät „${ref}“ nicht gefunden – erst list_devices aufrufen.`);
}

const MCP_DEVICE_ACTIONS = ["open", "deactivate", "close", "stop"] as const;
const TICKET_STATUS = ["VALID", "REDEEMED", "INVALID", "PROTECTED", "PAUSED", "CANCELED"] as const;
const SCAN_RESULTS = ["GRANTED", "DENIED", "PROTECTED"] as const;

// ---------- Cloud-Werkzeuge ----------

const cloudTools: Tool[] = [
  {
    name: "search_tickets",
    title: "Tickets suchen",
    description:
      "Tickets nach Name, E-Mail, QR-/Barcode, RFID oder Ticket-ID suchen. Liefert Status, Gültigkeit, Bereich, ersten Scan und Notiz.",
    inputSchema: obj(
      {
        query: str("Suchbegriff (mind. 2 Zeichen) oder Ticket-ID"),
        status: str("Optional: nur dieser Status", { enum: TICKET_STATUS }),
        limit: int("Anzahl, Vorgabe 20", 1, 50),
      },
      ["query"],
    ),
    level: "read",
    run: async (args, ctx) => {
      const q = argStr(args, "query", { required: true, max: 100 })!;
      if (q.length < 2) throw new McpToolError("query braucht mindestens 2 Zeichen");
      const status = argEnum(args, "status", TICKET_STATUS);
      const take = argInt(args, "limit", 20, 1, 50);
      const id = Number(q);
      const contains = { contains: q, mode: "insensitive" as const };
      const tickets = await ctx.db.ticket.findMany({
        where: {
          accountId: ctx.accountId,
          ...(status ? { status } : {}),
          OR: [
            ...(Number.isInteger(id) ? [{ id }] : []),
            { name: contains },
            { firstName: contains },
            { lastName: contains },
            { email: contains },
            { qrCode: q },
            { barcode: q },
            { rfidCode: q },
            { ticketTypeName: contains },
          ],
        },
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          status: true,
          validityType: true,
          startDate: true,
          endDate: true,
          slotStart: true,
          slotEnd: true,
          firstScanAt: true,
          ticketTypeName: true,
          source: true,
          notes: true,
          accessArea: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take,
      });
      return {
        count: tickets.length,
        tickets: tickets.map((t) => ({
          id: t.id,
          name: t.name,
          person: [t.firstName, t.lastName].filter(Boolean).join(" ") || null,
          status: t.status,
          type: t.ticketTypeName,
          validity: t.validityType,
          from: iso(t.startDate),
          to: iso(t.endDate),
          slot: t.slotStart ? `${t.slotStart}–${t.slotEnd ?? ""}` : null,
          area: t.accessArea?.name ?? null,
          firstScanAt: iso(t.firstScanAt),
          source: t.source,
          notes: t.notes,
        })),
      };
    },
  },
  {
    name: "recent_scans",
    title: "Letzte Zutritte",
    description:
      "Scans an Drehkreuzen, Türen und Scannern der letzten Minuten: Ergebnis (GRANTED/DENIED/PROTECTED), Gerät, Ticket, Zeit. Dazu Summen je Ergebnis und Gerät.",
    inputSchema: obj({
      minutes: int("Zeitraum in Minuten, Vorgabe 60 (max. 1440)", 1, 1440),
      result: str("Optional: nur dieses Ergebnis", { enum: SCAN_RESULTS }),
      device: int("Optional: nur diese Geräte-ID"),
      limit: int("Anzahl Einzelscans, Vorgabe 50", 1, 200),
    }),
    level: "read",
    run: async (args, ctx) => {
      const minutes = argInt(args, "minutes", 60, 1, 1440);
      const result = argEnum(args, "result", SCAN_RESULTS);
      const deviceId = args.device != null ? argInt(args, "device", 0, 0, 2 ** 31 - 1) : undefined;
      const take = argInt(args, "limit", 50, 1, 200);
      const since = new Date(Date.now() - minutes * 60_000);
      const where = {
        accountId: ctx.accountId,
        scanTime: { gte: since },
        ...(result ? { result } : {}),
        ...(deviceId != null ? { deviceId } : {}),
      };
      const [scans, groups, devices] = await Promise.all([
        ctx.db.scan.findMany({
          where,
          select: {
            id: true,
            scanTime: true,
            result: true,
            code: true,
            note: true,
            deviceId: true,
            ticket: { select: { id: true, name: true, status: true } },
          },
          orderBy: { scanTime: "desc" },
          take,
        }),
        ctx.db.scan.groupBy({ by: ["deviceId", "result"], where, _count: { _all: true } }),
        ctx.db.device.findMany({ where: { accountId: ctx.accountId }, select: { id: true, name: true } }),
      ]);
      const devName = new Map(devices.map((d) => [d.id, d.name]));
      const byResult: Record<string, number> = {};
      const byDevice: Record<string, Record<string, number>> = {};
      for (const g of groups) {
        const n = g._count._all;
        byResult[g.result] = (byResult[g.result] ?? 0) + n;
        const dn = g.deviceId != null ? devName.get(g.deviceId) ?? `Gerät ${g.deviceId}` : "ohne Gerät";
        byDevice[dn] = { ...(byDevice[dn] ?? {}), [g.result]: n };
      }
      return {
        since: since.toISOString(),
        total: Object.values(byResult).reduce((a, b) => a + b, 0),
        byResult,
        byDevice,
        scans: scans.map((s) => ({
          at: s.scanTime.toISOString(),
          result: s.result,
          device: s.deviceId != null ? devName.get(s.deviceId) ?? s.deviceId : null,
          ticket: s.ticket ? { id: s.ticket.id, name: s.ticket.name, status: s.ticket.status } : null,
          code: s.ticket ? undefined : s.code,
          note: s.note,
        })),
      };
    },
  },
  {
    name: "list_devices",
    title: "Geräte",
    description:
      "Alle Geräte (Drehkreuze, Türen, Shelly-Schalter, Licht, Markisen, Rolltore, Schlösser, Audio, Bewässerung, Mäher) mit ID, Typ, Kategorie, aktiv, letztem Kontakt, möglichen Aktionen und der Token-Stufe, die zum Schalten nötig ist.",
    inputSchema: obj({
      query: str("Optional: Namensfilter"),
      category: str("Optional: Kategorie", {
        enum: ["DREHKREUZ", "TUER", "SENSOR", "SCHALTER", "BELEUCHTUNG", "AUDIO", "MARKISE", "ROLLTOR", "TASTER"],
      }),
    }),
    level: "read",
    run: async (args, ctx) => {
      const q = argStr(args, "query", { max: 80 });
      const category = argStr(args, "category");
      const devices = await ctx.db.device.findMany({
        where: {
          accountId: ctx.accountId,
          ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
          ...(category ? { category: category as never } : {}),
        },
        select: { id: true, name: true, type: true, category: true, isActive: true, lastUpdate: true, task: true },
        orderBy: { name: "asc" },
      });
      return {
        count: devices.length,
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          category: d.category,
          active: d.isActive,
          lastContact: iso(d.lastUpdate),
          actions: availableDeviceActions(d).filter((a) => (MCP_DEVICE_ACTIONS as readonly string[]).includes(a)),
          switchLevel: deviceSwitchLevel(d),
        })),
      };
    },
  },
  {
    name: "hub_alerts",
    title: "Hub-Meldungen",
    description:
      "Verbindungszustand des Hubs vor Ort (zuletzt gesehen, Version) und offene Meldungen (Kamera offline, Switch-Fehler, Platte voll …), optional auch kürzlich behobene.",
    inputSchema: obj({ includeResolved: bool("Auch in den letzten 24 h behobene Meldungen zeigen") }),
    level: "read",
    run: async (args, ctx) => {
      const resolved = args.includeResolved === true;
      const [hubs, alerts] = await Promise.all([
        ctx.db.hubAgent.findMany({
          where: { accountId: ctx.accountId },
          select: { name: true, version: true, lastSeenAt: true },
        }),
        ctx.db.hubAlert.findMany({
          where: {
            accountId: ctx.accountId,
            OR: [{ resolvedAt: null }, ...(resolved ? [{ resolvedAt: { gte: new Date(Date.now() - 86_400_000) } }] : [])],
          },
          select: { title: true, detail: true, severity: true, source: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true },
          orderBy: { lastSeenAt: "desc" },
          take: 100,
        }),
      ]);
      return {
        hubs: hubs.map((h) => ({
          name: h.name,
          version: h.version,
          lastSeenAt: iso(h.lastSeenAt),
          online: !!h.lastSeenAt && Date.now() - h.lastSeenAt.getTime() < HUB_ONLINE_MS,
        })),
        alerts: alerts.map((a) => ({
          title: a.title,
          detail: a.detail,
          severity: a.severity,
          source: a.source,
          since: iso(a.firstSeenAt),
          lastSeen: iso(a.lastSeenAt),
          resolvedAt: iso(a.resolvedAt),
        })),
      };
    },
  },
  {
    name: "verein_bookings",
    title: "Vereinsbuchungen",
    description:
      "Slot-Buchungen und offene Wunschzeit-Anfragen der Vereine ab einem Tag (Vorgabe heute) für einige Tage: Verein, Angebot, Datum, Uhrzeit, Status, Preis.",
    inputSchema: obj({
      from: str("Startdatum YYYY-MM-DD, Vorgabe heute"),
      days: int("Anzahl Tage, Vorgabe 7 (max. 62)", 1, 62),
      status: str("Optional: nur dieser Status", { enum: ["BOOKED", "REQUESTED", "CANCELED", "REJECTED"] }),
    }),
    level: "read",
    run: async (args, ctx) => {
      const from = argStr(args, "from") ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new McpToolError("from muss YYYY-MM-DD sein");
      const days = argInt(args, "days", 7, 1, 62);
      const to = new Date(Date.parse(`${from}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const status = argEnum(args, "status", ["BOOKED", "REQUESTED", "CANCELED", "REJECTED"] as const);
      const rows = await ctx.db.vereinSlotBooking.findMany({
        where: { accountId: ctx.accountId, date: { gte: from, lt: to }, ...(status ? { status } : {}) },
        select: {
          id: true,
          date: true,
          slotStart: true,
          slotEnd: true,
          serviceName: true,
          status: true,
          priceCents: true,
          bookedBy: true,
          note: true,
          verein: { select: { name: true } },
        },
        orderBy: [{ date: "asc" }, { slotStart: "asc" }],
        take: 300,
      });
      return {
        from,
        to,
        count: rows.length,
        bookings: rows.map((b) => ({
          id: b.id,
          verein: b.verein.name,
          service: b.serviceName,
          date: b.date,
          time: `${b.slotStart}–${b.slotEnd}`,
          status: b.status,
          priceEur: b.priceCents / 100,
          bookedBy: b.bookedBy,
          note: b.note,
        })),
      };
    },
  },
  {
    name: "vehicle_sightings",
    title: "Fahrzeug-Sichtungen",
    description:
      "Erkannte Kennzeichen an den Kameras der letzten Stunden: Kennzeichen, Kamera, erlaubt (Liste) ja/nein, Tor ausgelöst, Lieferdienst.",
    inputSchema: obj({
      hours: int("Zeitraum in Stunden, Vorgabe 24 (max. 168)", 1, 168),
      plate: str("Optional: Kennzeichen oder Teil davon"),
      limit: int("Anzahl, Vorgabe 50", 1, 200),
    }),
    level: "read",
    run: async (args, ctx) => {
      const hours = argInt(args, "hours", 24, 1, 168);
      const plate = argStr(args, "plate", { max: 20 })?.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
      const take = argInt(args, "limit", 50, 1, 200);
      const [rows, cams] = await Promise.all([
        ctx.db.vehicleSighting.findMany({
          where: {
            accountId: ctx.accountId,
            seenAt: { gte: new Date(Date.now() - hours * 3_600_000) },
            ...(plate ? { plateNormalized: { contains: plate } } : {}),
          },
          select: {
            seenAt: true,
            plate: true,
            cameraId: true,
            matched: true,
            shellyTriggered: true,
            deliveryBrand: true,
            deliveryOpened: true,
            source: true,
            allowedVehicle: { select: { name: true } },
          },
          orderBy: { seenAt: "desc" },
          take,
        }),
        ctx.db.camera.findMany({ where: { accountId: ctx.accountId }, select: { id: true, name: true } }),
      ]);
      const camName = new Map(cams.map((c) => [c.id, c.name]));
      return {
        count: rows.length,
        sightings: rows.map((v) => ({
          at: v.seenAt.toISOString(),
          plate: v.plate,
          camera: v.cameraId != null ? camName.get(v.cameraId) ?? v.cameraId : null,
          allowed: v.matched,
          allowedAs: v.allowedVehicle?.name ?? null,
          gateTriggered: v.shellyTriggered,
          delivery: v.deliveryBrand ? { brand: v.deliveryBrand, opened: v.deliveryOpened } : null,
          source: v.source,
        })),
      };
    },
  },
  {
    name: "lost_items",
    title: "Fundsachen",
    description: "Fundsachen und Verlustmeldungen suchen (Beschreibung, Datum, abgeholt).",
    inputSchema: obj({
      query: str("Optional: Suchbegriff in der Beschreibung"),
      kind: str("FOUND = Fundsache, LOST_REPORT = Verlustmeldung", { enum: ["FOUND", "LOST_REPORT"] }),
      openOnly: bool("Nur nicht abgeholte/erledigte, Vorgabe true"),
    }),
    level: "read",
    run: async (args, ctx) => {
      const q = argStr(args, "query", { max: 80 });
      const kind = argEnum(args, "kind", ["FOUND", "LOST_REPORT"] as const);
      const openOnly = args.openOnly !== false;
      const rows = await ctx.db.lostItem.findMany({
        where: {
          accountId: ctx.accountId,
          ...(kind ? { kind } : {}),
          ...(openOnly ? { pickedUp: false } : {}),
          ...(q ? { description: { contains: q, mode: "insensitive" as const } } : {}),
        },
        select: { id: true, kind: true, description: true, foundDate: true, pickedUp: true, pickedUpAt: true, reporterName: true },
        orderBy: { foundDate: "desc" },
        take: 50,
      });
      return {
        count: rows.length,
        items: rows.map((i) => ({ ...i, foundDate: iso(i.foundDate), pickedUpAt: iso(i.pickedUpAt) })),
      };
    },
  },
  {
    name: "camera_snapshot",
    title: "Kamerabild",
    description:
      "Aktuelles Standbild einer Kamera oder DoorBird über den Hub aufnehmen und als Bild zurückgeben. Kamera per ID oder Name (siehe list_cameras).",
    inputSchema: obj({ camera: str("Kamera-ID oder Name") }, ["camera"]),
    level: "read",
    run: async (args, ctx) => {
      const cam = await findCamera(ctx, argStr(args, "camera", { required: true })!);
      const before = Date.now();
      await runHubTask(ctx, "CAMERA_SNAPSHOT", { cameraId: cam.id, maxPx: 1600 });
      const row = await ctx.db.camera.findFirst({
        where: { id: cam.id, accountId: ctx.accountId },
        select: { snapshot: true, snapshotAt: true },
      });
      if (!row?.snapshot) throw new McpToolError("Der Hub hat kein Bild geliefert.");
      const fresh = row.snapshotAt && row.snapshotAt.getTime() >= before - 5_000;
      return {
        content: [
          {
            type: "text",
            text: `${cam.name} – ${berlin(row.snapshotAt)}${fresh ? "" : " (älteres Bild, neues kam nicht an)"}`,
          },
          { type: "image", data: Buffer.from(row.snapshot).toString("base64"), mimeType: "image/jpeg" },
        ],
      };
    },
  },
  {
    name: "switch_device",
    title: "Gerät schalten",
    description:
      "Gerät schalten wie in der Oberfläche: open = ein/öffnen/Start (bei Tür/Taster ein Impuls), deactivate = aus, close/stop = Markise/Rolltor zu bzw. anhalten. Licht, Markisen, Steckdosen, Audio und Bewässerung brauchen Stufe operate; Türen, Tore, Schlösser, Drehkreuze und Taster brauchen Stufe access. Vorher mit list_devices die ID holen und im Zweifel den Nutzer fragen.",
    inputSchema: obj(
      {
        device: str("Geräte-ID oder exakter Name"),
        action: str("open | deactivate | close | stop", { enum: MCP_DEVICE_ACTIONS }),
        minutes: int("Nur Bewässerungsventile: Laufzeit in Minuten", 1, 240),
      },
      ["device", "action"],
    ),
    level: "operate",
    levelFor: async (args, ctx) => deviceSwitchLevel(await findDevice(ctx, argStr(args, "device", { required: true })!)),
    run: async (args, ctx) => {
      const action = argEnum(args, "action", MCP_DEVICE_ACTIONS);
      if (!action || !isValidDeviceAction(action)) throw new McpToolError("action fehlt");
      const ref = await findDevice(ctx, argStr(args, "device", { required: true })!);
      const device = await ctx.db.device.findFirst({ where: { id: ref.id, accountId: ctx.accountId } });
      if (!device) throw new McpToolError("Gerät nicht gefunden");
      if (!device.isActive) throw new McpToolError(`${device.name} ist deaktiviert.`);
      if (!isActionAllowedForDevice(action, device)) {
        throw new McpToolError(`Aktion ${action} ist für ${device.name} nicht vorgesehen (möglich: ${availableDeviceActions(device).join(", ")}).`);
      }
      if (isAudioDevice(device)) {
        const input = audioInputFromDeviceAction(action);
        if (!input) throw new McpToolError("Aktion ist für dieses Gerät nicht vorgesehen");
        const r = await controlAudioDevice(ctx.db, ctx.accountId, device, input);
        if (!r.ok) throw new McpToolError(r.error);
        return { ok: true, device: device.name, action };
      }
      const minutes = args.minutes != null ? argInt(args, "minutes", 0, 1, 240) : undefined;
      const r = await triggerDeviceAction(ctx.db, device, ctx.accountId, action, {
        seconds: minutes ? minutes * 60 : undefined,
      });
      if (!r.error) {
        void runDeviceSwitchedRules(ctx.accountId, device.id, action).catch((err) => {
          console.error("[mcp] room rules failed:", err);
        });
      }
      if (r.error) throw new McpToolError(`${device.name}: ${r.error}`);
      return {
        ok: true,
        device: device.name,
        action,
        sent: deviceSendsRemoteCommand(device.type) ? r.sent : undefined,
        note: deviceSendsRemoteCommand(device.type) ? undefined : "Das Gerät holt den Befehl selbst ab (wenige Sekunden).",
      };
    },
  },
];

// ---------- Backend-Werkzeuge (nur lesen) ----------

async function accountTz(ctx: McpCtx): Promise<string> {
  const acc = await ctx.db.account.findUnique({ where: { id: ctx.accountId }, select: { timezone: true } });
  return acc?.timezone || DEFAULT_TIMEZONE;
}

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
/** Bitmaske der Wochentage (Bit 0 = Mo) als "Mo, Di, Fr" bzw. "täglich". */
export function describeWeekdays(mask: number): string {
  if ((mask & 127) === 127) return "täglich";
  const days = WEEKDAY_SHORT.filter((_, i) => mask & (1 << i));
  return days.length ? days.join(", ") : "nie";
}

const backendTools: Tool[] = [
  {
    name: "opening_hours",
    title: "Betriebszeiten",
    description:
      "Betriebszeiten-Profile: jetzt geöffnet ja/nein, Öffnungszeiten heute und für die nächsten Tage (Saisons und Ausnahmetage sind eingerechnet).",
    inputSchema: obj({ days: int("Wie viele Tage ab heute, Vorgabe 7", 1, 31) }),
    level: "read",
    run: async (args, ctx) => {
      const days = argInt(args, "days", 7, 1, 31);
      const tz = await accountTz(ctx);
      const now = new Date();
      const today = tzYmd(now, tz);
      const rows = await ctx.db.operatingSchedule.findMany({
        where: { accountId: ctx.accountId },
        include: scheduleSpecInclude,
        orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      });
      return {
        timezone: tz,
        today,
        schedules: rows.map((r) => {
          const spec = toScheduleSpec(r);
          return {
            id: r.id,
            name: r.name,
            isDefault: r.isDefault,
            openNow: isOperatingAt(spec, now, tz),
            days: Array.from({ length: days }, (_, i) => {
              const ymd = addDaysToYmd(today, i);
              const day = openingForDay(spec, ymd);
              return { date: ymd, hours: describeDay(day), source: day.source, label: day.label };
            }),
          };
        }),
      };
    },
  },
  {
    name: "room_rules",
    title: "Raumregeln",
    description:
      "Automationsregeln der Räume: Auslöser (Uhrzeit, Öffnen/Schließen, Sonne, Bewegung, Gerät, Zutritt …), Bedingungen, Aktionen, aktiv ja/nein und letzter Lauf. Nur lesen.",
    inputSchema: obj({
      room: str("Optional: nur Regeln dieses Raums (Name, Teilwort)"),
      activeOnly: bool("Nur aktive Regeln, Vorgabe false"),
    }),
    level: "read",
    run: async (args, ctx) => {
      const room = argStr(args, "room", { max: 80 });
      const rows = await ctx.db.roomRule.findMany({
        where: {
          accountId: ctx.accountId,
          ...(args.activeOnly === true ? { isActive: true } : {}),
          ...(room ? { room: { name: { contains: room, mode: "insensitive" as const } } } : {}),
        },
        include: ruleInclude,
        orderBy: [{ roomId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        take: 200,
      });
      return {
        count: rows.length,
        rules: rows.map((r) => ({
          id: r.id,
          name: r.name,
          room: r.room?.name ?? null,
          active: r.isActive,
          trigger: r.trigger,
          days: describeWeekdays(r.daysOfWeek),
          time: r.timeOfDay,
          offsetMinutes: r.offsetMinutes || undefined,
          camera: r.camera?.name,
          eventType: r.eventType ?? undefined,
          triggerDevice: r.triggerDevice ? { name: r.triggerDevice.name, action: r.triggerAction } : undefined,
          area: r.area?.name,
          idleMinutes: r.idleMinutes ?? undefined,
          condition: {
            operating: r.operating,
            schedule: r.operatingSchedule?.name,
            window: r.windowStart && r.windowEnd ? `${r.windowStart}–${r.windowEnd}` : undefined,
            onlyWhenDark: r.onlyWhenDark || undefined,
          },
          actions: r.actions.map((a) => ({
            kind: a.kind,
            device: a.device?.name,
            action: a.deviceAction ?? undefined,
            timerSeconds: a.timerSeconds ?? undefined,
            audioZone: a.audioZone?.name,
            announcement: a.audioAnnouncement?.name,
            playlist: a.audioPlaylist?.name,
            camera: a.targetCamera?.name,
            channel: a.channel ?? undefined,
          })),
          lastRunAt: iso(r.lastRunAt),
        })),
      };
    },
  },
  {
    name: "rule_runs",
    title: "Regel-Läufe",
    description: "Protokoll der ausgeführten Raumregeln: wann, welcher Auslöser, erfolgreich oder mit welchem Fehler.",
    inputSchema: obj({
      hours: int("Zeitraum in Stunden, Vorgabe 24", 1, 24 * 14),
      failedOnly: bool("Nur fehlgeschlagene Läufe"),
      rule: str("Optional: Regelname (Teilwort)"),
    }),
    level: "read",
    run: async (args, ctx) => {
      const hours = argInt(args, "hours", 24, 1, 24 * 14);
      const rule = argStr(args, "rule", { max: 80 });
      const rows = await ctx.db.roomRuleRun.findMany({
        where: {
          accountId: ctx.accountId,
          triggeredAt: { gte: new Date(Date.now() - hours * 3_600_000) },
          ...(args.failedOnly === true ? { success: false } : {}),
          ...(rule ? { ruleName: { contains: rule, mode: "insensitive" as const } } : {}),
        },
        select: { ruleName: true, triggeredAt: true, triggerKind: true, success: true, errorMessage: true, durationMs: true },
        orderBy: { triggeredAt: "desc" },
        take: 100,
      });
      return {
        count: rows.length,
        failed: rows.filter((r) => !r.success).length,
        runs: rows.map((r) => ({ ...r, triggeredAt: iso(r.triggeredAt), errorMessage: r.errorMessage ?? undefined })),
      };
    },
  },
  {
    name: "irrigation",
    title: "Bewässerung",
    description:
      "Bewässerungspläne (Ventil, Tage, Startzeit, Dauer, Regen-Aussetzen) und die Läufe der letzten Tage mit geschätzten Litern.",
    inputSchema: obj({ days: int("Läufe der letzten Tage, Vorgabe 7", 1, 60) }),
    level: "read",
    run: async (args, ctx) => {
      const days = argInt(args, "days", 7, 1, 60);
      const [schedules, runs] = await Promise.all([
        ctx.db.irrigationSchedule.findMany({
          where: { accountId: ctx.accountId },
          select: {
            id: true, daysOfWeek: true, startTime: true, durationMinutes: true, isActive: true,
            skipOnRain: true, smartRain: true, moistureThresholdPct: true, lastRunAt: true,
            device: { select: { id: true, name: true } },
          },
          orderBy: { startTime: "asc" },
        }),
        ctx.db.irrigationRun.findMany({
          where: { accountId: ctx.accountId, startedAt: { gte: new Date(Date.now() - days * 86_400_000) } },
          select: { startedAt: true, durationMinutes: true, source: true, litersEstimate: true, device: { select: { name: true } } },
          orderBy: { startedAt: "desc" },
          take: 200,
        }),
      ]);
      const liters = runs.reduce((sum, r) => sum + (r.litersEstimate ?? 0), 0);
      return {
        schedules: schedules.map((s) => ({
          id: s.id,
          valve: s.device.name,
          active: s.isActive,
          days: describeWeekdays(s.daysOfWeek),
          start: s.startTime,
          minutes: s.durationMinutes,
          skipOnRain: s.skipOnRain,
          smartRain: s.smartRain,
          moistureThresholdPct: s.moistureThresholdPct ?? undefined,
          lastRunAt: iso(s.lastRunAt),
        })),
        runs: {
          days,
          count: runs.length,
          litersEstimate: Math.round(liters),
          items: runs.map((r) => ({
            valve: r.device.name,
            startedAt: iso(r.startedAt),
            minutes: r.durationMinutes,
            source: r.source,
            liters: r.litersEstimate != null ? Math.round(r.litersEstimate) : null,
          })),
        },
      };
    },
  },
  {
    name: "keys_issued",
    title: "Ausgegebene Schlüssel",
    description:
      "Offene Schlüsselübergaben: wer (Name, Firma) hat welche Schlüssel, seit wann, bis wann, überfällig ja/nein. Ohne Telefon und E-Mail.",
    inputSchema: obj({
      query: str("Optional: Name, Firma oder Schlüsselnummer"),
      overdueOnly: bool("Nur überfällige"),
    }),
    level: "read",
    run: async (args, ctx) => {
      const q = argStr(args, "query", { max: 80 });
      const now = new Date();
      const contains = q ? { contains: q, mode: "insensitive" as const } : undefined;
      const rows = await ctx.db.keyHandover.findMany({
        where: {
          accountId: ctx.accountId,
          items: { some: { itemStatus: "ISSUED" } },
          ...(args.overdueOnly === true ? { dueAt: { lt: now } } : {}),
          ...(contains
            ? {
                OR: [
                  { holder: { firstName: contains } },
                  { holder: { lastName: contains } },
                  { holder: { company: contains } },
                  { items: { some: { key: { keyNumber: contains } } } },
                ],
              }
            : {}),
        },
        select: {
          id: true, issuedAt: true, dueAt: true, deposit: true, status: true,
          holder: { select: { firstName: true, lastName: true, company: true } },
          items: {
            where: { itemStatus: "ISSUED" },
            select: { key: { select: { keyNumber: true, label: true } } },
          },
        },
        orderBy: { issuedAt: "desc" },
        take: 100,
      });
      return {
        count: rows.length,
        handovers: rows.map((h) => ({
          id: h.id,
          holder: [h.holder.firstName, h.holder.lastName].filter(Boolean).join(" ") || null,
          company: h.holder.company,
          keys: h.items.map((i) => (i.key.label ? `${i.key.keyNumber} (${i.key.label})` : i.key.keyNumber)),
          issuedAt: iso(h.issuedAt),
          dueAt: iso(h.dueAt),
          overdue: h.dueAt != null && h.dueAt < now,
          deposit: h.deposit,
        })),
      };
    },
  },
  {
    name: "lockers",
    title: "Schränke und Vermietung",
    description: "Schränke/Spinde mit Vermietung im gewählten Jahr: Mieter, Schlüssel ausgegeben/zurück, freie Schränke.",
    inputSchema: obj({
      year: int("Jahr, Vorgabe aktuelles Jahr", 2000, 2100),
      freeOnly: bool("Nur freie Schränke"),
    }),
    level: "read",
    run: async (args, ctx) => {
      const year = argInt(args, "year", new Date().getFullYear(), 2000, 2100);
      const rows = await ctx.db.locker.findMany({
        where: { accountId: ctx.accountId },
        select: {
          id: true, name: true, number: true, location: true, lockType: true, keyCount: true,
          rentals: {
            where: { year },
            select: { renterName: true, keysIssued: true, keysReturned: true, issuedAt: true, returnedAt: true },
          },
        },
        orderBy: [{ location: "asc" }, { number: "asc" }],
        take: 500,
      });
      const lockers = rows
        .map((l) => {
          const r = l.rentals[0];
          return {
            id: l.id,
            name: l.name,
            number: l.number,
            location: l.location,
            lockType: l.lockType,
            rented: !!r,
            renter: r?.renterName ?? null,
            keys: r ? { issued: r.keysIssued, returned: r.keysReturned, of: l.keyCount } : undefined,
          };
        })
        .filter((l) => (args.freeOnly === true ? !l.rented : true));
      return {
        year,
        total: rows.length,
        rented: rows.filter((l) => l.rentals.length > 0).length,
        lockers,
      };
    },
  },
  {
    name: "camera_events",
    title: "Kamera-Ereignisse",
    description: "Ereignisse der Kameras (Bewegung, Person, Fahrzeug …) mit Beginn und Ende, optional für eine Kamera.",
    inputSchema: obj({
      camera: str("Optional: Kamera-ID oder Name"),
      type: str("Optional: Ereignistyp, z. B. motion, person, vehicle"),
      hours: int("Zeitraum in Stunden, Vorgabe 6", 1, 72),
    }),
    level: "read",
    run: async (args, ctx) => {
      const hours = argInt(args, "hours", 6, 1, 72);
      const ref = argStr(args, "camera", { max: 80 });
      const type = argStr(args, "type", { max: 40 });
      const cam = ref ? await findCamera(ctx, ref) : null;
      const rows = await ctx.db.cameraEvent.findMany({
        where: {
          accountId: ctx.accountId,
          startedAt: { gte: new Date(Date.now() - hours * 3_600_000) },
          ...(cam ? { cameraId: cam.id } : {}),
          ...(type ? { type: { equals: type, mode: "insensitive" as const } } : {}),
        },
        select: { type: true, startedAt: true, endedAt: true, camera: { select: { name: true } } },
        orderBy: { startedAt: "desc" },
        take: 200,
      });
      const byType: Record<string, number> = {};
      for (const e of rows) byType[e.type] = (byType[e.type] ?? 0) + 1;
      return {
        hours,
        count: rows.length,
        byType,
        events: rows.map((e) => ({ camera: e.camera.name, type: e.type, startedAt: iso(e.startedAt), endedAt: iso(e.endedAt) })),
      };
    },
  },
];

// ---------- Werkzeuge des Hub-Assistenten ----------

const hubTools: Tool[] = [
  hubTool({
    name: "hub_status",
    title: "Lage des Hubs",
    description:
      "Gesamtlage des Hubs vor Ort: Cloud-Verbindung, Systemlast, Kameras (erreichbar/nicht), DoorBird, Gesichts-/Kennzeichenerkennung, Park-Tracker, Soundweb, Regeln, Mitarbeiter im Dienst, lokales Sprachmodell.",
  }),
  hubTool({
    name: "who_is_working",
    title: "Wer arbeitet gerade",
    description:
      "Eingestempelte Mitarbeiter aus emp-control mit Bereich, Einstempelzeit, Pause und geplantem Schichtende, dazu heutige Schichten, deren Leute noch nicht eingestempelt sind.",
  }),
  hubTool({
    name: "occupancy",
    title: "Belegung und Wartezeiten",
    description:
      "Wie voll ist es? Personen auf den Kamerabildern an Übungslift, Seilbahn A/B, Gastro und Drehkreuz, Stufe (leer/ruhig/gut besucht/voll), geschätzte Wartezeit, Drehkreuz-Eintritte (15 min, Stunde, heute) und Tagesspitzen. Wartezeit ist geschätzt.",
    inputSchema: obj({ fresh: bool("Sofort neu messen statt der letzten Messung (dauert einige Sekunden)") }),
  }),
  hubTool({
    name: "day_preview",
    title: "Tagesvorschau",
    description:
      "Was ist heute/morgen los: gebuchte Gäste (ANNY) je Angebot, Termine, Stoßzeiten, Gruppen, Verleihmaterial, Wetter und die Schichten aus emp-control.",
    inputSchema: obj({ day: str("heute oder morgen", { enum: ["heute", "morgen"] }) }),
  }),
  hubTool({
    name: "list_cameras",
    title: "Kameras",
    description: "Alle Kameras mit ID, Name, Erreichbarkeit, aktiven Erkennungen und letztem Ereignis.",
  }),
  hubTool({
    name: "list_events",
    title: "Hub-Ereignisse",
    description: "Letzte Ereignisse auf dem Hub: Kameras, Personen, Fahrzeuge, DoorBird, Netzwerk, System, Tasks.",
    inputSchema: obj({
      kind: str("Filter", { enum: ["camera", "person", "vehicle", "doorbird", "network", "system", "task"] }),
      limit: int("Anzahl, Vorgabe 30", 1, 200),
    }),
  }),
  hubTool({
    name: "list_rooms",
    title: "Räume",
    description:
      "Räume mit Geräten (ID, Name, Typ, Kategorie), Live-Zustand (an/aus, Leistung), Betriebszeit offen/zu, Klima und Regeln.",
    inputSchema: obj({ room: str("Optional: nur dieser Raum (Name)") }),
  }),
  hubTool({
    name: "climate",
    title: "Temperatur und Feuchte",
    description: "Temperatur- und Feuchtefühler mit letztem Messwert.",
  }),
  hubTool({
    name: "network_overview",
    title: "Netzwerk-Übersicht",
    description:
      "Netzwerk-Inventar des letzten Scans (Anzahl je VLAN, unbekannte Geräte) und VLAN-Prüfung der Switches. Nur lesen – Netzwerkänderungen sind über diese Schnittstelle nicht möglich.",
    inputSchema: obj({ vlan: str("Optional: nur dieses VLAN (Name oder ID) im Detail") }),
  }),
  hubTool({
    name: "early_warnings",
    title: "Vorwarnungen",
    description:
      "Früherkennung aus den Verläufen der letzten 7 Tage: gehäufte Aussetzer, Neustarts, Switch-Port-Fehler, Shelly-Temperaturen, Platten-Prognose, abgelaufene Anmeldungen und aktive Vorwarnungen.",
  }),
  hubTool({
    name: "weather_forecast",
    title: "Wetter",
    description: "Wetterbericht für die Anlage: jetzt, heute, morgen, übermorgen, optional stündlich.",
    inputSchema: obj({ hours: int("Optional: so viele Stunden stündlich ab jetzt (max. 48)", 1, 48) }),
  }),
  hubTool({
    name: "energy_plan",
    title: "Energie- und Tagesplanung",
    description:
      "Wetter, anstehende Mäh-Aufgaben mit Wetter-Urteil, Bewässerung, Heizungen, Geräte außerhalb der Betriebszeit, Frost-Hinweis.",
  }),
  hubTool({
    name: "mower_status",
    title: "Mähroboter",
    description: "Zustand der Mammotion-Mäher (Akku, Tätigkeit, Fehler, Aufgaben).",
  }),
  hubTool({
    name: "read_log",
    title: "Hub-Log",
    description: "Hub-Log lesen: letzte Zeilen, optional mit Suchbegriff. file: hub (Vorgabe), error, improve.",
    inputSchema: obj({
      file: str("hub | error | improve", { enum: ["hub", "error", "improve"] }),
      grep: str("Suchbegriff, z. B. Kameraname oder 'fehl'"),
      lines: int("Anzahl Zeilen, Vorgabe 60", 1, 300),
    }),
  }),
  hubTool({
    name: "improve_report",
    title: "Verbesserungslog des Hubs",
    description:
      "Zähler und Hinweise (hints) des Hubs seit dem Start sowie die letzten Diagnose-Ereignisse. Grundlage für Verbesserungsvorschläge.",
  }),
  hubTool({
    name: "mower_action",
    title: "Mäher steuern",
    description:
      "Mäher steuern: start_task (mit task = Aufgaben-ID oder -Name aus mower_status), pause, resume, stop, dock.",
    inputSchema: obj(
      {
        mower: str("Gerätename des Mähers aus mower_status"),
        action: str("start_task | pause | resume | stop | dock", { enum: ["start_task", "pause", "resume", "stop", "dock"] }),
        task: str("Nur bei start_task: Aufgaben-ID oder Name"),
      },
      ["mower", "action"],
    ),
    level: "operate",
  }),
  hubTool({
    name: "camera_control",
    title: "Kamera steuern",
    description:
      "Kamera steuern: spotlight (Licht), ir (Nachtsicht), ptz_preset (auf gespeicherte Position fahren) mit Stufe operate; siren (Sirene) nur mit Stufe access.",
    inputSchema: obj(
      {
        camera: str("Kamera-ID oder exakter Name"),
        what: str("spotlight | siren | ir | ptz_preset", { enum: ["spotlight", "siren", "ir", "ptz_preset"] }),
        on: bool("an/aus (spotlight, siren, ir)"),
        preset: int("Preset-Nummer (ptz_preset)", 0, 64),
      },
      ["camera", "what"],
    ),
    level: "operate",
    levelFor: async (args) => (String(args.what) === "siren" ? "access" : null),
  }),
  hubTool({
    name: "open_gate",
    title: "Tor öffnen (DoorBird)",
    description: "Tor/Tür an einer DoorBird öffnen (ein Impuls). Nur mit Stufe access und nur nach ausdrücklicher Bitte des Nutzers.",
    inputSchema: obj({ camera: str("DoorBird-ID oder exakter Name") }, ["camera"]),
    level: "access",
  }),
];

export const MCP_TOOLS: Tool[] = [...cloudTools, ...backendTools, ...hubTools];

/** Namen der Hub-Werkzeuge mit Stufe – muss zur Freigabeliste in hub/src/agent/mcp-bridge.ts passen. */
export const MCP_HUB_TOOL_LEVELS: Record<string, McpLevel> = Object.fromEntries(
  hubTools.map((t) => [t.name, t.level]),
);

export const MCP_INSTRUCTIONS = [
  "EMP-Access: Zutritts- und Anlagensteuerung (Tickets, Drehkreuze, Räume, Kameras, Hub vor Ort).",
  "Antworte auf Deutsch. Zeiten sind UTC (ISO); dem Nutzer in Europe/Berlin nennen.",
  "Für einen Lageüberblick zuerst hub_status und hub_alerts. Werkzeuge mit Hub-Bezug brauchen einige Sekunden.",
  "Backend lesen: opening_hours, room_rules, rule_runs, irrigation, keys_issued, lockers, camera_events.",
  "Vor dem Schalten (switch_device, camera_control, mower_action, open_gate) das Gerät eindeutig bestimmen und nur auf ausdrücklichen Wunsch handeln.",
  "Netzwerkänderungen (Router, Switches, VLANs, WLAN, Firewall) sind hier nicht möglich und werden nur vorgeschlagen.",
].join("\n");
