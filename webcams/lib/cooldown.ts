/**
 * In-memory Cooldown-Tracking pro (key). Reicht für lokale Single-Instance.
 */
const lastTriggered = new Map<string, number>();

export function getRemainingMs(key: string, cooldownMs: number): number {
  const last = lastTriggered.get(key);
  if (!last) return 0;
  const elapsed = Date.now() - last;
  return Math.max(0, cooldownMs - elapsed);
}

export function trigger(key: string) {
  lastTriggered.set(key, Date.now());
}

export function reset(key: string) {
  lastTriggered.delete(key);
}
