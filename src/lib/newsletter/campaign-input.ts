import { parseBlocks, type NewsletterBlock } from "./blocks";
import { parseGroupIds } from "./rules";
import type { TenantDb } from "@/lib/prisma";

/** Betreff, Vorschauzeile, Bausteine und Empfänger-Gruppen einer Aussendung aus einer Anfrage. */
export function parseCampaignInput(
  body: Record<string, unknown> | null,
): { subject: string; preheader: string | null; blocks: NewsletterBlock[]; groupIds: number[] } | { error: string } {
  if (!body) return { error: "Ungültige Anfrage" };
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return { error: "Betreff fehlt" };
  if (subject.length > 150) return { error: "Betreff: höchstens 150 Zeichen" };
  const preheader = typeof body.preheader === "string" ? body.preheader.trim() : "";
  if (preheader.length > 200) return { error: "Vorschauzeile: höchstens 200 Zeichen" };
  const parsed = parseBlocks(body.blocks ?? []);
  if ("error" in parsed) return parsed;
  const groupIds = parseGroupIds(body.groupIds);
  if (!groupIds) return { error: "Ungültige Empfänger-Gruppen" };
  return { subject, preheader: preheader || null, blocks: parsed.blocks, groupIds };
}

/** Nur Gruppen dieses Mandanten behalten. */
export async function knownGroupIds(
  db: TenantDb,
  accountId: number,
  ids: number[],
): Promise<number[]> {
  if (ids.length === 0) return [];
  const found = await db.newsletterGroup.findMany({ where: { accountId, id: { in: ids } }, select: { id: true } });
  const ok = new Set(found.map((g) => g.id));
  return ids.filter((id) => ok.has(id));
}
