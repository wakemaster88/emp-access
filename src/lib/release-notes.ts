/**
 * Neuerungen für den Update-Hinweis, aus den gemergten PRs des öffentlichen
 * Repos. Keine Pflege nötig: der PR-Titel ist der Eintrag. GitHub wird
 * höchstens alle 5 Minuten gefragt (Next-Datencache); schlägt das fehl, zeigt
 * der Hinweis einfach keine Liste.
 */
import { pickReleaseNotes, type MergedPull } from "./app-version";

const REPO = "wakemaster88/emp-access";
const PULLS_URL = `https://api.github.com/repos/${REPO}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=50`;

export async function releaseNotesSince(since: string, until: string): Promise<string[]> {
  if (!since || !Number.isFinite(Date.parse(since))) return [];
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "emp-access-update-hint" };
    // Optional: mit Token höheres Limit (Vercel-Env, nie im Repo).
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(PULLS_URL, { headers, next: { revalidate: 300 }, signal: AbortSignal.timeout(4_000) });
    if (!res.ok) return [];
    const pulls = (await res.json()) as MergedPull[];
    return Array.isArray(pulls) ? pickReleaseNotes(pulls, since, until) : [];
  } catch {
    return [];
  }
}
