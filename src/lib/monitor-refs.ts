import type { TenantDb } from "./prisma";
import { cleanIds, foreignRefError } from "./tenant-refs";

/**
 * ID-Listen eines Monitor-Links (MonitorConfig.deviceIds/areaIds/
 * controlDeviceIds) aus einer Anfrage.
 *
 * Gelesen wird wie in `parseMonitorIdList`: Zahlen und Ziffern-Strings,
 * nur positive Werte; doppelte IDs fallen weg, die Reihenfolge bleibt
 * (`deviceIds[0]` ist beim Monitor-Check-in das Scan-Geraet). Kein Array:
 * `undefined` (Feld nicht gesetzt).
 */
export function monitorIdList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return cleanIds(value.map(Number).filter((n) => Number.isFinite(n) && n > 0));
}

export type MonitorIdLists = {
  deviceIds: number[];
  areaIds: number[];
  controlDeviceIds: number[];
};

/** IDs je Liste aus `next`, die in derselben Liste von `before` noch nicht stehen. */
export function addedMonitorIds(next: MonitorIdLists, before?: MonitorIdLists): MonitorIdLists {
  if (!before) return next;
  const fresh = (ids: number[], old: number[]) => ids.filter((id) => !old.includes(id));
  return {
    deviceIds: fresh(next.deviceIds, before.deviceIds),
    areaIds: fresh(next.areaIds, before.areaIds),
    controlDeviceIds: fresh(next.controlDeviceIds, before.controlDeviceIds),
  };
}

/** Monitor-Typ, bei dem `deviceIds` Bereiche statt Geraete enthaelt. */
export const AREA_DEVICE_IDS_TYPE = "RESOURCE_MONITOR";

/**
 * Prueft die ID-Listen eines Monitors gegen den Mandanten. Liefert eine
 * Fehlermeldung oder die zu speichernden Listen.
 *
 * - `deviceIds` enthaelt beim Ressourcen-Monitor Bereiche, sonst Geraete;
 *   geprueft wird gegen die Art, die zum Ziel-Typ (`type`) passt.
 * - Ohne Typwechsel werden nur neu eingetragene IDs geprueft (`before` =
 *   gespeicherter Stand), damit ein Monitor mit inzwischen geloeschten
 *   Geraeten oder Bereichen weiter gespeichert werden kann.
 * - Bei einem Typwechsel (`typeChanged`) wird die ganze `deviceIds`-Liste
 *   geprueft. Schon gespeicherte IDs, die nicht zum neuen Typ passen, fallen
 *   still weg.
 * - Der Dialog behaelt die Auswahl beim Wechsel des Typs. Eine neue ID in
 *   `deviceIds`, die zur anderen Art des Mandanten gehoert (Bereich statt
 *   Geraet oder umgekehrt), faellt deshalb ebenfalls still weg; eine neue ID,
 *   die zu keiner der beiden passt, ergibt einen Fehler.
 * - `areaIds` sind Bereiche, `controlDeviceIds` Geraete.
 */
export async function checkMonitorRefs(
  db: TenantDb,
  accountId: number | null | undefined,
  type: string,
  next: MonitorIdLists,
  before?: MonitorIdLists,
  typeChanged = false,
): Promise<{ error: string } | { lists: MonitorIdLists }> {
  const added = addedMonitorIds(next, before);
  const fixed = await foreignRefError(db, accountId, {
    accessAreaIds: added.areaIds,
    deviceIds: added.controlDeviceIds,
  });
  if (fixed) return { error: fixed };

  const fresh = new Set(added.deviceIds);
  const check = typeChanged ? next.deviceIds : added.deviceIds;
  if (check.length === 0) return { lists: next };

  const scope = accountId != null ? { accountId } : {};
  const areasFirst = type === AREA_DEVICE_IDS_TYPE;
  const findDevices = (ids: number[]) =>
    ids.length === 0
      ? Promise.resolve([])
      : db.device.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } });
  const findAreas = (ids: number[]) =>
    ids.length === 0
      ? Promise.resolve([])
      : db.accessArea.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } });

  const own = new Set((await (areasFirst ? findAreas(check) : findDevices(check))).map((row) => row.id));
  const notOwn = check.filter((id) => !own.has(id) && fresh.has(id));
  const otherKind = new Set(
    (await (areasFirst ? findDevices(notOwn) : findAreas(notOwn))).map((row) => row.id),
  );
  const missing = notOwn.filter((id) => !otherKind.has(id));
  if (missing.length > 0) {
    return {
      error: areasFirst
        ? `Bereich nicht gefunden (ID ${missing.join(", ")}).`
        : `Gerät nicht gefunden (ID ${missing.join(", ")}).`,
    };
  }

  const checked = new Set(check);
  return {
    lists: { ...next, deviceIds: next.deviceIds.filter((id) => !checked.has(id) || own.has(id)) },
  };
}
