/**
 * Versand vieler Pushes in Blöcken: je Block gehen bis zu `PUSH_BLOCK`
 * Empfänger gleichzeitig raus, die Blöcke nacheinander. Reine Hilfsfunktionen
 * ohne Datenbank, für `rider-announce.ts` und Tests.
 */

/** Empfänger (Kunden) je Block, die gleichzeitig beliefert werden. */
export const PUSH_BLOCK = 25;

/**
 * Ungünstigste Dauer eines Blocks: jeder Push läuft in das Zeitlimit des
 * Push-Dienstes (5 s, siehe `web-push.ts`), dazu etwas Puffer.
 */
export const PUSH_BLOCK_WORST_MS = 5_500;

/** Teilt eine Liste in Blöcke der Größe `size` (letzter Block kürzer). */
export function chunk<T>(items: T[], size = PUSH_BLOCK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Ungünstigste Versanddauer für so viele Empfänger. */
export function worstPushMs(recipients: number): number {
  return Math.ceil(recipients / PUSH_BLOCK) * PUSH_BLOCK_WORST_MS;
}

/**
 * Darf eine Meldung an `recipients` Empfänger jetzt starten? Ja, wenn der
 * ungünstigste Fall noch vor `deadlineMs` fertig ist. Sonst wartet sie auf den
 * nächsten Lauf des Crons, der mehr Zeit hat. Passt sie auch dort nie
 * hinein (`budgetMs` eines frischen Cron-Laufs), startet der Cron sie
 * trotzdem (`oversized`), sonst ginge sie nie raus.
 */
export function pushFitsBudget(
  recipients: number,
  nowMs: number,
  deadlineMs: number,
  oversized: { budgetMs: number } | null = null,
): boolean {
  const worst = worstPushMs(recipients);
  if (nowMs + worst <= deadlineMs) return true;
  return oversized != null && worst > oversized.budgetMs;
}
