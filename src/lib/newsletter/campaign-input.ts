import { parseBlocks, type NewsletterBlock } from "./blocks";

/** Betreff, Vorschauzeile und Bausteine einer Aussendung aus einer Anfrage. */
export function parseCampaignInput(
  body: Record<string, unknown> | null,
): { subject: string; preheader: string | null; blocks: NewsletterBlock[] } | { error: string } {
  if (!body) return { error: "Ungültige Anfrage" };
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return { error: "Betreff fehlt" };
  if (subject.length > 150) return { error: "Betreff: höchstens 150 Zeichen" };
  const preheader = typeof body.preheader === "string" ? body.preheader.trim() : "";
  if (preheader.length > 200) return { error: "Vorschauzeile: höchstens 200 Zeichen" };
  const parsed = parseBlocks(body.blocks ?? []);
  if ("error" in parsed) return parsed;
  return { subject, preheader: preheader || null, blocks: parsed.blocks };
}
