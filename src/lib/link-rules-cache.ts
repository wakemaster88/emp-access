/**
 * Regeln für Links und Monitore eines Accounts für die öffentlichen Routen
 * (Kiosk, Wandanzeigen), höchstens 60 s im Speicher der Function wie die
 * Einlass-Regeln (`access-rules-cache.ts`). Eine Änderung in den
 * Einstellungen wirkt spätestens nach 60 s; auf der Instanz, die gespeichert
 * hat, sofort.
 */
import { createTtlCache } from "./ttl-cache";
import { LINK_RULE_KEYS, parseLinkRules, type LinkRules } from "./link-rules";

const RULES_TTL_MS = 60_000;

type LinkRulesDb = {
  account: {
    findUnique: (args: {
      where: { id: number };
      select: { accessRules: true };
    }) => Promise<{ accessRules: unknown } | null>;
  };
};

const cache = createTtlCache<LinkRules>(RULES_TTL_MS);

export function loadLinkRules(db: LinkRulesDb, accountId: number): Promise<LinkRules> {
  return cache.get(String(accountId), async () => {
    const account = await db.account.findUnique({
      where: { id: accountId },
      select: { accessRules: true },
    });
    return parseLinkRules(account?.accessRules);
  });
}

/** Alle Regeln eingeschaltet: der strengere Stand jeder Regel. */
export const LINK_RULES_STRICT: LinkRules = Object.fromEntries(
  LINK_RULE_KEYS.map((key) => [key, true]),
) as LinkRules;

/**
 * Für die öffentlichen Routen (Kiosk, Kiosk-Tür, Auslastung, Massen-Pause):
 * Schlägt das Lesen fehl, gilt für diese eine Anfrage jede Regel als
 * eingeschaltet, also der strengere Stand (nur zugeordnete Türen, keine
 * Namen, „Alle fortsetzen“ nur für die eigene Massen-Pause). Die Anfrage
 * scheitert nicht, öffnet aber auch nicht mehr als mit der Regel. Fehler
 * werden nicht zwischengespeichert; die nächste Anfrage liest neu.
 */
export async function loadLinkRulesOrStrict(db: LinkRulesDb, accountId: number): Promise<LinkRules> {
  try {
    return await loadLinkRules(db, accountId);
  } catch (err) {
    console.error("[link-rules] Lesen fehlgeschlagen, Regeln gelten für diese Anfrage als eingeschaltet:", err);
    return { ...LINK_RULES_STRICT };
  }
}

/** Nach dem Speichern (gleiche Instanz sofort) und in Tests. */
export function clearLinkRulesCache() {
  cache.clear();
}
