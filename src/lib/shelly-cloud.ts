/**
 * Shelly-Cloud-Status über einen einzigen all_status-Abruf.
 *
 * Shelly Cloud erlaubt nur ~1 Request pro Sekunde pro Auth-Key. Einzelne
 * POST /device/status-Aufrufe je Gerät laufen bei vielen Geräten deshalb
 * sofort in HTTP 429 (TOO_MANY_REQUESTS) und alle Geräte erscheinen offline.
 *
 * Dieser Helper holt stattdessen den Status ALLER Geräte des Accounts mit
 * einem einzigen POST /device/all_status und cached das Ergebnis kurz pro
 * warmer Function-Instanz, damit parallele Anfragen (Geräteliste + einzelne
 * Status-Badges) denselben Abruf teilen.
 */

export type ShellyDeviceStatusMap = Record<string, unknown>;

export interface ShellyAllStatusEntry {
  online: boolean;
  status: ShellyDeviceStatusMap;
}

export interface ShellySwitchState {
  output: boolean | null;
  power?: number;
}

const CACHE_TTL_MS = 20_000;

interface CacheEntry {
  expiresAt: number;
  promise: Promise<Map<string, ShellyAllStatusEntry> | null>;
}

const cache = new Map<string, CacheEntry>();

export function normalizeShellyServer(baseUrl: string): string {
  return `https://${baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

export interface ShellyCloudReply {
  /// HTTP-Status der Antwort; 0 = die Anfrage kam nicht zustande.
  status: number;
  isok: boolean;
  errors?: Record<string, unknown>;
  data?: unknown;
}

/**
 * Wartezeiten vor den weiteren Versuchen, wenn die Cloud das Ratenlimit meldet.
 *
 * Gemessen an der echten Cloud: Ein Statusabruf und ein direkt folgender
 * Schaltbefehl gehen zusammen durch, ein zweiter Schaltbefehl kurz danach wird
 * abgewiesen. Nach etwa einer Sekunde ist wieder frei – nach einem
 * vorangegangenen Statusabruf aber erst spaeter. Zwei Versuche mit rund zwei
 * Sekunden Abstand deckten in den Messungen alle Faelle ab.
 */
const RATE_LIMIT_RETRY_MS = [2000, 2500];

/**
 * Die Cloud lehnt zu schnelle Aufrufe mit HTTP 401 und
 * `errors: { max_req: "Request limit reached!" }` ab – nicht mit 429, wie man
 * erwarten wuerde. Ohne diese Unterscheidung sieht eine Ratenbegrenzung wie ein
 * falscher Auth-Key aus.
 */
function isRateLimited(reply: ShellyCloudReply): boolean {
  return reply.errors !== undefined && "max_req" in reply.errors;
}

/**
 * POST an die Shelly Cloud mit einem Wiederholungsversuch bei
 * Ratenbegrenzung.
 *
 * Pro Auth-Key erlaubt die Cloud nur etwa einen Aufruf pro Sekunde – und dieses
 * Budget teilen sich Statusabrufe und Schaltbefehle. Zwei schnell
 * aufeinanderfolgende Bedienschritte, etwa "Zu" und gleich danach "Stopp",
 * liefen deshalb ins Leere, ohne dass an der Verbindung etwas fehlte.
 */
export async function shellyCloudPost(
  baseUrl: string,
  path: string,
  params: URLSearchParams,
  timeoutMs = 5000,
): Promise<ShellyCloudReply> {
  const url = `${normalizeShellyServer(baseUrl)}${path}`;

  const attempt = async (): Promise<ShellyCloudReply> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(timeoutMs),
    });
    try {
      const body = (await res.json()) as {
        isok?: boolean;
        errors?: Record<string, unknown>;
        data?: unknown;
      };
      return {
        status: res.status,
        isok: body.isok === true,
        errors: body.errors,
        data: body.data,
      };
    } catch {
      // Antwort ohne JSON-Koerper – dann zaehlt allein der HTTP-Status.
      return { status: res.status, isok: false };
    }
  };

  try {
    let reply = await attempt();
    for (const waitMs of RATE_LIMIT_RETRY_MS) {
      if (reply.isok || !isRateLimited(reply)) return reply;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      reply = await attempt();
    }
    return reply;
  } catch {
    return { status: 0, isok: false };
  }
}

async function fetchAllStatuses(
  server: string,
  authKey: string,
): Promise<Map<string, ShellyAllStatusEntry> | null> {
  try {
    // show_info liefert _dev_info.online fuer jedes Geraet mit.
    const reply = await shellyCloudPost(
      server,
      "/device/all_status",
      new URLSearchParams({ auth_key: authKey, show_info: "true" }),
      8000,
    );
    if (!reply.isok) return null;

    const data = reply.data as {
      devices_status?: Record<
        string,
        ShellyDeviceStatusMap & { _dev_info?: { online?: boolean } }
      >;
    } | undefined;

    const map = new Map<string, ShellyAllStatusEntry>();
    for (const [id, status] of Object.entries(data?.devices_status ?? {})) {
      const entry: ShellyAllStatusEntry = {
        online: status._dev_info?.online ?? false,
        status,
      };
      map.set(id, entry);
      // MAC-basierte IDs koennen in der DB anders gecased sein; BLE-/Lock-IDs
      // ("XB…", "XL…") sind case-sensitiv und bleiben unter dem Original-Key.
      map.set(id.toLowerCase(), entry);
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Status-Map (deviceId → Status) aller Cloud-Geräte. Ergebnis wird pro
 * Auth-Key kurz gecached; parallele Aufrufer teilen sich denselben Request.
 */
export function shellyCloudAllStatuses(
  baseUrl: string,
  authKey: string,
): Promise<Map<string, ShellyAllStatusEntry> | null> {
  const server = normalizeShellyServer(baseUrl);
  const key = `${server}:${authKey}`;
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetchAllStatuses(server, authKey.trim()).then((result) => {
    // Fehlschlaege nicht fuer die volle TTL cachen.
    if (result === null) cache.delete(key);
    return result;
  });
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, promise });
  return promise;
}

/**
 * Schaltzustand eines Kanals aus einem Geraete-Status extrahieren:
 * Gen2 (`switch:N`) bevorzugt, sonst Gen1 (`relays`/`meters`).
 */
export function shellySwitchState(
  status: ShellyDeviceStatusMap,
  switchIdx: number,
  /// Antriebe brauchen exakt den angefragten Kanal – bei ihnen unterscheidet
  /// sich "Auf" von "Zu" nur durch den Index. Der Ausweich-Griff auf einen
  /// beliebigen anderen Kanal wuerde dort die falsche Richtung melden.
  strict = false,
): ShellySwitchState {
  type SwitchEntry = { output?: boolean; apower?: number };

  let sw = status[`switch:${switchIdx}`] as SwitchEntry | undefined;
  if (sw === undefined && !strict) {
    for (let i = 0; i <= 4; i++) {
      const entry = status[`switch:${i}`] as SwitchEntry | undefined;
      if (entry !== undefined) { sw = entry; break; }
    }
  }
  if (sw !== undefined) return { output: sw.output ?? null, power: sw.apower };

  const relays = status.relays as { ison?: boolean }[] | undefined;
  const meters = status.meters as { power?: number }[] | undefined;
  const relay = strict ? relays?.[switchIdx] : (relays?.[switchIdx] ?? relays?.[0]);
  if (relay !== undefined) {
    return {
      output: relay.ison ?? null,
      power: strict
        ? meters?.[switchIdx]?.power
        : (meters?.[switchIdx]?.power ?? meters?.[0]?.power),
    };
  }

  return { output: null };
}

/**
 * Index der Cover-Komponente, wenn der Shelly den Antrieb selbst als Rollladen
 * fuehrt – sonst `null`.
 *
 * Das Geraeteprofil entscheidet darueber, wie ein Antrieb ueberhaupt
 * ansprechbar ist: Gen2/Gen3 im Cover-Profil stellen `cover:N` bereit und gar
 * keine `switch:N`-Komponente, Relaisbefehle laufen dort ins Leere. Gen1
 * (Shelly 2/2.5 im Roller-Modus) meldet stattdessen ein `rollers`-Array.
 */
export function shellyCoverComponentId(status: ShellyDeviceStatusMap): number | null {
  // Kleinster Index, damit die Auswahl bei mehreren Antrieben nicht von der
  // Schluesselreihenfolge der JSON-Antwort abhaengt.
  let lowest: number | null = null;
  for (const key of Object.keys(status)) {
    if (!key.startsWith("cover:")) continue;
    const id = Number(key.slice("cover:".length));
    if (Number.isInteger(id) && (lowest === null || id < lowest)) lowest = id;
  }
  if (lowest !== null) return lowest;

  const rollers = status.rollers;
  return Array.isArray(rollers) && rollers.length > 0 ? 0 : null;
}

/** Fahrzustand, den ein Shelly im Cover-Profil meldet. */
export type ShellyCoverStateName =
  | "opening"
  | "closing"
  | "open"
  | "closed"
  | "stopped"
  | "calibrating";

export interface ShellyCoverReading {
  state: ShellyCoverStateName | null;
  /**
   * Fahrposition in Prozent (100 = offen). `null`, wenn der Antrieb nicht
   * kalibriert ist – ohne Kalibrierung kennt der Shelly seine Lage nicht
   * (`pos_control: false`) und meldet keine Position.
   */
  position: number | null;
  power?: number;
}

const COVER_STATES = new Set<string>([
  "opening", "closing", "open", "closed", "stopped", "calibrating",
]);

/**
 * Gen1 benutzt fuer denselben Sachverhalt ein anderes Vokabular: "open" und
 * "close" heissen dort *faehrt gerade*, nicht *steht offen*. Ohne diese
 * Umschluesselung wuerde ein fahrender Gen1-Antrieb als "offen" gemeldet.
 */
const GEN1_ROLLER_STATES: Record<string, ShellyCoverStateName> = {
  open: "opening",
  close: "closing",
  stop: "stopped",
};

function asCoverState(raw: unknown): ShellyCoverStateName | null {
  return typeof raw === "string" && COVER_STATES.has(raw)
    ? (raw as ShellyCoverStateName)
    : null;
}

/**
 * Zustand und Position eines Antriebs im Cover-Profil aus einem Geraetestatus
 * lesen. Anders als bei zwei getrennten Relais muss die Fahrtrichtung hier
 * nicht erraten werden – der Shelly meldet sie samt Endlage selbst.
 */
export function shellyCoverReading(
  status: ShellyDeviceStatusMap,
  coverId: number,
): ShellyCoverReading {
  const cover = status[`cover:${coverId}`] as
    | { state?: unknown; current_pos?: number | null; apower?: number }
    | undefined;
  if (cover !== undefined) {
    return {
      state: asCoverState(cover.state),
      position: cover.current_pos ?? null,
      power: cover.apower,
    };
  }

  const roller = (status.rollers as
    | Array<{ state?: string; current_pos?: number }>
    | undefined)?.[coverId];
  if (roller !== undefined) {
    return {
      state: roller.state ? (GEN1_ROLLER_STATES[roller.state] ?? null) : null,
      position: roller.current_pos ?? null,
      power: (status.meters as Array<{ power?: number }> | undefined)?.[coverId]?.power,
    };
  }

  return { state: null, position: null };
}

/**
 * Vollstaendigen Status eines Geraets ueber die lokale IP holen: Gen2 liefert
 * alle Komponenten mit `Shelly.GetStatus`, Gen1 mit `/status`. Ein Abruf statt
 * einer Anfrage je Kanal – wichtig fuer Antriebe, die zwei Relais haben.
 */
export async function shellyLocalStatusMap(
  ip: string,
  timeoutMs = 3000,
): Promise<ShellyDeviceStatusMap | null> {
  try {
    const res = await fetch(`http://${ip}/rpc/Shelly.GetStatus`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return (await res.json()) as ShellyDeviceStatusMap;
  } catch { /* Gen1 versuchen */ }

  try {
    const res = await fetch(`http://${ip}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return (await res.json()) as ShellyDeviceStatusMap;
  } catch { /* nicht erreichbar */ }

  return null;
}

/** Cloud-Suffix (`abc_1` → 1) auf 0-basierten Switch-Index mappen. */
export function shellySwitchIndex(shellyId: string | null | undefined): number {
  const suffix = shellyId?.includes("_") ? Number(shellyId.split("_").pop()) : 0;
  const safe = Number.isNaN(suffix) ? 0 : suffix;
  return safe > 0 ? safe - 1 : 0;
}

/** Basis-Geraete-ID ohne Kanal-Suffix (`abc_1` → `abc`). */
export function shellyBaseId(shellyId: string | null | undefined): string | null {
  if (!shellyId) return null;
  return shellyId.split("_")[0] ?? shellyId;
}
