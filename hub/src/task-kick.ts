/**
 * Sofortiger Task-Abruf nach einem Kamera-Ereignis.
 *
 * Normal holt der Hub Tasks im Takt (HUB_TASK_INTERVAL, 5 s). Löst ein
 * Ereignis in der Cloud eine Regel aus (z. B. Klingel → Kamera auf Preset),
 * meldet die Antwort von /api/hub/camera-events `rulesTriggered > 0`, und der
 * Hub holt die neuen Tasks sofort statt bis zu 5 s später.
 */
let handler: (() => void) | null = null;

export function onTaskKick(fn: () => void): void {
  handler = fn;
}

export function kickTaskPoll(): void {
  handler?.();
}

/** Antwort von /api/hub/camera-events auswerten; liest den Body. */
export async function kickIfRulesTriggered(res: Response): Promise<void> {
  if (!res.ok) return;
  const body = (await res.json().catch(() => null)) as { rulesTriggered?: number } | null;
  if ((body?.rulesTriggered ?? 0) > 0) kickTaskPoll();
}
