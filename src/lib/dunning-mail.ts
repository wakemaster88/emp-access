/**
 * Mails des Mahnlaufs (lib/dunning): Zahlungserinnerung (nur wenn anny sie
 * nicht verschicken konnte), 1. Mahnung, letzte Mahnung. Schlicht und hell wie
 * die anderen Verwaltungs-Mails (`wrapEmailHtml`), ohne Mahngebühr.
 */
import { escapeHtml, wrapEmailHtml } from "./email-templates";
import { formatDay } from "./payment-open";
import type { DunningStage } from "./dunning-state";

export interface DunningMailArgs {
  stage: Exclude<DunningStage, "collection">;
  accountName: string;
  firstName: string | null;
  person: string;
  aboName: string | null;
  /** Formatierter offener Betrag, z. B. „24 €“. */
  amount: string | null;
  invoiceNumber: string | null;
  dueDate: string | null;
  /** Zahlungsfrist, YYYY-MM-DD (1. und letzte Mahnung). */
  deadline: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

export interface DunningMail {
  subject: string;
  html: string;
  text: string;
}

export const DUNNING_SUBJECT: Record<DunningMailArgs["stage"], string> = {
  reminder: "Zahlungserinnerung zu deinem Abo",
  first: "1. Mahnung zu deinem Abo",
  final: "Letzte Mahnung zu deinem Abo",
};

function deadlineText(ymd: string | null): string | null {
  return ymd ? formatDay(`${ymd}T12:00:00Z`) : null;
}

export function dunningMail(a: DunningMailArgs): DunningMail {
  const hello = a.firstName?.trim() ? `Hallo ${a.firstName.trim()},` : "Hallo,";
  const abo = a.aboName?.trim() ? `„${a.aboName.trim()}“` : "";
  const invoice = a.invoiceNumber ? ` (Rechnung ${a.invoiceNumber})` : "";
  const amount = a.amount ?? "ein Betrag";
  const due = formatDay(a.dueDate);
  const deadline = deadlineText(a.deadline);

  const facts =
    `für dein Abo ${abo}${abo ? " " : ""}ist ${amount}${invoice} offen` + (due ? `, fällig seit ${due}.` : ".");

  const paras: string[] = [];
  if (a.stage === "reminder") {
    paras.push(`${facts} Vielleicht ist das einfach untergegangen, oder die Lastschrift hat nicht geklappt.`);
    paras.push("Bitte bezahle den Betrag in den nächsten Tagen. Bis die Zahlung da ist, ist dein Abo pausiert, danach gilt es sofort wieder.");
  } else if (a.stage === "first") {
    paras.push(`${facts} Auf unsere Zahlungserinnerung ist leider noch keine Zahlung eingegangen.`);
    paras.push(`Bitte bezahle den Betrag bis ${deadline ?? "in 14 Tagen"}. Bis dahin bleibt dein Abo pausiert, nach der Zahlung gilt es sofort wieder.`);
  } else {
    paras.push(`${facts} Trotz Erinnerung und Mahnung ist noch keine Zahlung eingegangen.`);
    paras.push(
      `Bitte bezahle den Betrag spätestens bis ${deadline ?? "in 7 Tagen"}. Geht bis dahin keine Zahlung ein, geben wir die Forderung an ein Inkassounternehmen ab. Dabei entstehen dir zusätzliche Kosten.`,
    );
  }
  paras.push("Bezahlen kannst du über den Link in der Zahlungserinnerung von anny, in deinem anny-Kundenkonto oder bei uns an der Kasse.");
  paras.push("Hast du in den letzten Tagen schon bezahlt, ist diese Mail damit erledigt. Bei Fragen antworte einfach auf diese Mail.");

  const subject = DUNNING_SUBJECT[a.stage];
  const inner =
    `<p style="margin:0 0 16px;">${escapeHtml(hello)}</p>` +
    paras.map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`).join("") +
    `<p style="margin:24px 0 0;">Viele Grüße<br>${escapeHtml(a.accountName)}</p>`;
  const html = wrapEmailHtml({
    innerHtml: inner,
    brandColor: a.brandColor,
    logoUrl: a.logoUrl,
    websiteUrl: a.websiteUrl,
    accountName: a.accountName,
    preheader: `${amount} offen${a.aboName ? ` für ${a.aboName}` : ""}`,
  });
  const text = [hello, "", ...paras.flatMap((p) => [p, ""]), "Viele Grüße", a.accountName].join("\n");
  return { subject, html, text };
}
