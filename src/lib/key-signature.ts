import type { TenantDb } from "@/lib/prisma";
import { KEY_LEVEL_LABELS, holderDisplayName, type KeyLevel } from "@/lib/keying";
import { handoverInclude, lockPathLabel } from "@/lib/keying-queries";
import type { KeySnapshot, PolicySnapshot } from "@/lib/key-policy-pdf";

/**
 * Snapshots fuer einen Signaturvorgang. Text und Schluesseldaten werden beim
 * Erzeugen des Links eingefroren, damit spaetere Aenderungen an Vorlage oder
 * Bestand ein unterschriebenes Dokument nicht mehr veraendern.
 */

export type SnapshotResult =
  | { ok: true; policySnapshot: PolicySnapshot; keySnapshot: KeySnapshot; policyTemplateId: number }
  | { ok: false; message: string };

type HandoverWithRelations = NonNullable<
  Awaited<ReturnType<TenantDb["keyHandover"]["findFirst"]>>
> & {
  holder: { firstName: string | null; lastName: string | null; company: string | null; email: string | null };
  items: {
    key: {
      keyNumber: string;
      label: string | null;
      level: string;
      locks: {
        lock: {
          lockNumber: string | null;
          door: {
            name: string;
            doorNumber: string | null;
            room: { name: string; building: string | null } | null;
          };
        };
      }[];
    };
  }[];
};

export async function buildSignatureSnapshots(
  db: TenantDb,
  accountId: number,
  handoverId: number,
  policyTemplateId: number | null | undefined,
): Promise<SnapshotResult> {
  const handover = (await db.keyHandover.findFirst({
    where: { id: handoverId, accountId },
    include: handoverInclude,
  })) as HandoverWithRelations | null;

  if (!handover) return { ok: false, message: "Protokoll nicht gefunden" };
  if (handover.items.length === 0) {
    return { ok: false, message: "Protokoll enthält keine Schlüssel" };
  }

  const templateId = policyTemplateId ?? handover.policyTemplateId;
  const template = templateId
    ? await db.keyPolicyTemplate.findFirst({ where: { id: templateId, accountId } })
    : await db.keyPolicyTemplate.findFirst({
        where: { accountId, isActive: true },
        orderBy: { version: "desc" },
      });

  if (!template) {
    return { ok: false, message: "Keine Belehrungsvorlage hinterlegt" };
  }

  const policySnapshot: PolicySnapshot = {
    templateName: template.name,
    version: template.version,
    bodyText: template.bodyText,
    liabilityText: template.liabilityText,
  };

  const keySnapshot: KeySnapshot = {
    holderName: holderDisplayName(handover.holder),
    holderCompany: handover.holder.company,
    holderEmail: handover.holder.email,
    handoverId: handover.id,
    issuedAt: handover.issuedAt.toISOString(),
    dueAt: handover.dueAt ? handover.dueAt.toISOString() : null,
    deposit: handover.deposit,
    issuedByName: handover.issuedByName,
    keys: handover.items.map((item) => ({
      keyNumber: item.key.keyNumber,
      label: item.key.label,
      levelLabel: KEY_LEVEL_LABELS[item.key.level as KeyLevel] ?? item.key.level,
      locks: item.key.locks.map((l) => lockPathLabel(l.lock)),
    })),
  };

  return { ok: true, policySnapshot, keySnapshot, policyTemplateId: template.id };
}

/** Client-IP hinter dem Vercel-Proxy. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip");
}
