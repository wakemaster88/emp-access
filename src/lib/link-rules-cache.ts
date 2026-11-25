/**
 * Regeln für Links und Monitore eines Accounts für die öffentlichen Routen
 * (Kiosk, Wandanzeigen), höchstens 60 s im Speicher der Function wie die
 * Einlass-Regeln (`access-rules-cache.ts`). Eine Änderung in den
 * Einstellungen wirkt spätestens nach 60 s; auf der Instanz, die gespeichert
 * hat, sofort.
 */
import { createTtlCache } from "./ttl-cache";
import { LINK_RULES_OFF, parseLinkRules, type LinkRules } from "./link-rules";

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

/**
 * Für die öffentlichen Routen: Schlägt das Lesen fehl, gelten alle Regeln als
 * aus. Die Anfrage läuft dann wie vor den Regeln weiter, statt zu scheitern
 * (die Routen brauchten diese Abfrage vorher nicht). Fehler werden nicht
 * zwischengespeichert; die nächste Anfrage liest neu.
 */
export async function loadLinkRulesOrOff(db: LinkRulesDb, accountId: number): Promise<LinkRules> {
  try {
    return await loadLinkRules(db, accountId);
  } catch (err) {
    console.error("[link-rules] Lesen fehlgeschlagen, Regeln gelten als aus:", err);
    return { ...LINK_RULES_OFF };
  }
}

/** Nach dem Speichern (gleiche Instanz sofort) und in Tests. */
export function clearLinkRulesCache() {
  cache.clear();
}
