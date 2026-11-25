/**
 * Einlass-Regeln eines Accounts für den Scan-Weg, höchstens 60 s im Speicher
 * der Function (wie die ApiConfig in wakesys.ts/binarytec.ts). Der Pi-Scan
 * fragt sie damit nicht bei jedem Scan neu ab; eine Änderung in den
 * Einstellungen wirkt spätestens nach 60 s.
 *
 * Die freigegebenen Bereiche (`AccessArea.allowUnassignedTickets`) werden nur
 * gelesen, solange die Regel „Tickets ohne Bereich …“ an ist.
 *
 * Ob ein Bereich einen aktiven Ausgangs-Leser hat (Regel „Wiedereintritt …“),
 * steht je (Account, Bereich) ebenfalls 60 s im Speicher: ein neuer oder
 * entfernter Leser wirkt spätestens nach 60 s.
 */
import { createTtlCache } from "./ttl-cache";
import { parseAccessRules, type AccessRules } from "./access-rules";

const RULES_TTL_MS = 60_000;

export interface LoadedAccessRules {
  rules: AccessRules;
  /** Bereiche, an denen Tickets ohne Bereich weiter gelten. */
  openAreaIds: number[];
}

type AccessRulesDb = {
  account: {
    findUnique: (args: {
      where: { id: number };
      select: { accessRules: true };
    }) => Promise<{ accessRules: unknown } | null>;
  };
  accessArea: {
    findMany: (args: {
      where: { accountId: number; allowUnassignedTickets: true };
      select: { id: true };
    }) => Promise<Array<{ id: number }>>;
  };
};

const cache = createTtlCache<LoadedAccessRules>(RULES_TTL_MS);
const exitReaderCache = createTtlCache<boolean>(RULES_TTL_MS);

type ExitReaderDb = {
  device: {
    findFirst: (args: {
      where: {
        accountId: number;
        type: "RASPBERRY_PI";
        isActive: true;
        accessOut: number;
        OR: [{ accessIn: null }, { accessIn: { not: number } }];
      };
      select: { id: true };
    }) => Promise<{ id: number } | null>;
  };
};

/**
 * Hat der Bereich mindestens einen aktiven Scanner-Pi mit diesem Bereich als
 * Ausgang (`accessOut`)? Ein Leser mit demselben Bereich als Ein- und Ausgang
 * zählt nicht: `decidePassback` wertet seine Scans als Eintritt. Ein Fehler
 * wird nicht gespeichert und an den Aufrufer weitergegeben
 * (`evaluatePassback` lehnt dann nicht ab).
 */
export function loadAreaHasExitReader(db: ExitReaderDb, accountId: number, areaId: number): Promise<boolean> {
  return exitReaderCache.get(`${accountId}:${areaId}`, async () => {
    const reader = await db.device.findFirst({
      where: {
        accountId,
        type: "RASPBERRY_PI",
        isActive: true,
        accessOut: areaId,
        OR: [{ accessIn: null }, { accessIn: { not: areaId } }],
      },
      select: { id: true },
    });
    return reader != null;
  });
}

export function loadAccessRules(db: AccessRulesDb, accountId: number): Promise<LoadedAccessRules> {
  return cache.get(String(accountId), async () => {
    const account = await db.account.findUnique({
      where: { id: accountId },
      select: { accessRules: true },
    });
    const rules = parseAccessRules(account?.accessRules);
    const openAreaIds = rules.ticketNeedsArea
      ? (
          await db.accessArea.findMany({
            where: { accountId, allowUnassignedTickets: true },
            select: { id: true },
          })
        ).map((a) => a.id)
      : [];
    return { rules, openAreaIds };
  });
}

/** Nach dem Speichern (gleiche Instanz sofort) und in Tests. */
export function clearAccessRulesCache() {
  cache.clear();
  exitReaderCache.clear();
}
