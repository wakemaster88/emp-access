import { timingSafeEqual } from "node:crypto";

export const META_STATE_COOKIE = "emp_meta_state";
export const META_STATE_PATH = "/api/social/meta";

/** Prüft `state` aus dem Rücksprung gegen das Cookie und den Mandanten. */
export function stateMatches(cookie: string | undefined, state: string | null, accountId: number): boolean {
  if (!cookie || !state) return false;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return false;
  const expected = cookie.slice(0, dot);
  if (cookie.slice(dot + 1) !== String(accountId)) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}
