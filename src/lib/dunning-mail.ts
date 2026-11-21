/**
 * Mails des Mahnlaufs (lib/dunning): Zahlungserinnerung (nur wenn anny sie
 * nicht verschicken konnte), 1. Mahnung, letzte Mahnung.
 *
 * Bewusst förmlich (Aaron, 21.11.2026: „offizieller Touch, Signatur
 * rechtskonform“): Sie-Form, Briefkopf, Übersicht der Forderung und darunter
 * die Pflichtangaben des Absenders aus den Mail-Einstellungen
 * (`EmailConfig.legalFooter`, eine Angabe je Zeile; § 35a GmbHG, § 37a HGB).
 * Keine Mahngebühr. Nur Tabellen und Inline-Stile, damit es in Outlook und
 * Gmail hält.
 */
import { escapeHtml } from "./email-templates";
import { formatDay } from "./payment-open";
import type { DunningStage } from "./dunning-state";

export interface DunningMailArgs {
  stage: Exclude<DunningStage, "collection">;
  accountName: string;
  firstName: string | null;
  /** Voller Name für die Anrede. */
  person: string;
  aboName: string | null;
  /** Formatierter offener Betrag, z. B. „24 €“. */
  amount: string | null;
  invoiceNumber: string | null;
  dueDate: string | null;
  /** Zahlungsfrist, YYYY-MM-DD (1. und letzte Mahnung). */
  deadline: string | null;
  /** Datum des Schreibens (Standard: jetzt). */
  date?: Date;
  brandColor?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  /** Pflichtangaben, eine je Zeile. */
  legalFooter?: string | null;
}

export interface DunningMail {
  subject: string;
  html: string;
  text: string;
}

export const DUNNING_SUBJECT: Record<DunningMailArgs["stage"], string> = {
  reminder: "Zahlungserinnerung zu Ihrem Abo",
  first: "1. Mahnung zu Ihrem Abo",
  final: "Letzte Mahnung zu Ihrem Abo",
};

const TITLE: Record<DunningMailArgs["stage"], string> = {
  reminder: "Zahlungserinnerung",
  first: "1. Mahnung",
  final: "Letzte Mahnung",
};

const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const BG = "#f1f5f6";
const ACCENT = "#fbbf24";
const DANGER = "#b42318";
const SANS = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function deadlineText(ymd: string | null): string | null {
  return ymd ? formatDay(`${ymd}T12:00:00Z`) : null;
}

function brand(color: string | null | undefined): string {
  const c = color?.trim();
  return c && /^#?[0-9a-f]{6}$/i.test(c) ? (c.startsWith("#") ? c : `#${c}`) : "#1a6d73";
}

/** Pflichtangaben: Zeilen ohne Leerzeilen. */
export function legalLines(footer: string | null | undefined): string[] {
  return (footer ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Absätze des Schreibens je Stufe (Sie-Form). */
export function dunningParagraphs(a: Pick<DunningMailArgs, "stage" | "aboName" | "deadline">): string[] {
  const abo = a.aboName?.trim() ? `Ihr Abo „${a.aboName.trim()}“` : "Ihr Abo";
  const deadline = deadlineText(a.deadline);
  const paras: string[] = [];
  if (a.stage === "reminder") {
    paras.push(
      `für ${abo} ist der unten genannte Betrag noch offen. Möglicherweise ist die Zahlung im Alltag untergegangen oder die Lastschrift konnte nicht eingezogen werden.`,
    );
    paras.push("Bitte begleichen Sie den Betrag in den nächsten Tagen. Bis zum Zahlungseingang ist Ihr Abo pausiert, danach ist es sofort wieder gültig.");
  } else if (a.stage === "first") {
    paras.push(`auf unsere Zahlungserinnerung zu ${abo.replace(/^Ihr /, "Ihrem ")} ist bisher leider keine Zahlung eingegangen.`);
    paras.push(
      `Wir bitten Sie, den unten genannten Betrag bis zum ${deadline ?? "Ablauf von 14 Tagen"} zu begleichen. Bis zum Zahlungseingang bleibt Ihr Abo pausiert.`,
    );
  } else {
    paras.push(`trotz Zahlungserinnerung und Mahnung ist der unten genannte Betrag für ${abo} weiterhin offen.`);
    paras.push(
      `Wir fordern Sie hiermit letztmalig auf, den Betrag bis spätestens ${deadline ?? "zum Ablauf von 7 Tagen"} zu begleichen. Geht bis dahin keine Zahlung ein, übergeben wir die Forderung ohne weitere Ankündigung an ein Inkassounternehmen. Die dadurch entstehenden Kosten gehen zu Ihren Lasten.`,
    );
  }
  paras.push("Bezahlen können Sie über den Zahlungslink in der Zahlungserinnerung von anny, in Ihrem anny-Kundenkonto oder bei uns an der Kasse.");
  paras.push("Sollten Sie die Zahlung in den letzten Tagen bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos. Bei Fragen antworten Sie einfach auf diese E-Mail.");
  return paras;
}

export function dunningMail(a: DunningMailArgs): DunningMail {
  const name = a.person?.trim() || a.firstName?.trim() || "";
  const hello = name ? `Guten Tag ${name},` : "Guten Tag,";
  const amount = a.amount ?? "–";
  const due = formatDay(a.dueDate);
  const deadline = deadlineText(a.deadline);
  const date = formatDay((a.date ?? new Date()).toISOString());
  const paras = dunningParagraphs(a);
  const legal = legalLines(a.legalFooter);
  const color = brand(a.brandColor);
  const title = TITLE[a.stage];
  const subject = DUNNING_SUBJECT[a.stage];

  const facts: Array<[string, string]> = [];
  if (a.aboName?.trim()) facts.push(["Leistung", a.aboName.trim()]);
  if (a.invoiceNumber) facts.push(["Rechnungsnummer", a.invoiceNumber]);
  if (due) facts.push(["Fällig seit", due]);
  if (deadline) facts.push([a.stage === "final" ? "Letzte Frist" : "Zahlbar bis", deadline]);

  const esc = escapeHtml;
  const factRows = facts
    .map(
      ([k, v]) =>
        `<tr><td style="padding:9px 16px;border-top:1px solid ${LINE};font-family:${SANS};font-size:14px;color:${MUTED};">${esc(k)}</td><td align="right" style="padding:9px 16px;border-top:1px solid ${LINE};font-family:${SANS};font-size:14px;color:${INK};font-weight:600;">${esc(v)}</td></tr>`,
    )
    .join("");
  const head = a.logoUrl
    ? `<img src="${esc(a.logoUrl)}" alt="${esc(a.accountName)}" height="36" style="display:block;border:0;max-height:36px;">`
    : `<span style="font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${color};">${esc(a.accountName)}</span>`;
  const badgeColor = a.stage === "final" ? DANGER : color;
  const legalHtml = legal.length
    ? legal.map((l) => esc(l)).join("<br>")
    : esc(a.accountName);
  const website = a.websiteUrl
    ? `<div style="margin-top:10px;"><a href="${esc(a.websiteUrl)}" style="color:${color};text-decoration:none;font-weight:600;">${esc(a.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></div>`
    : "";

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(`${title}: ${amount} offen${a.invoiceNumber ? `, Rechnung ${a.invoiceNumber}` : ""}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:8px;overflow:hidden;">
  <tr><td style="height:5px;line-height:5px;font-size:0;background:${color};">&nbsp;</td></tr>
  <tr><td style="padding:22px 32px 18px;border-bottom:1px solid ${LINE};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;">${head}</td>
      <td align="right" style="vertical-align:middle;font-family:${SANS};font-size:13px;color:${MUTED};">${esc(date ?? "")}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:30px 32px 8px;">
    <span style="display:inline-block;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;background:${badgeColor};border-radius:4px;padding:4px 9px;">${esc(title)}</span>
    <div style="margin-top:14px;font-family:${SANS};font-size:22px;line-height:1.3;font-weight:700;color:${INK};">${esc(subject)}</div>
  </td></tr>
  <tr><td style="padding:14px 32px 0;font-family:${SANS};font-size:15px;line-height:1.65;color:${BODY};">
    <p style="margin:0 0 14px;">${esc(hello)}</p>
    ${paras.slice(0, 2).map((p) => `<p style="margin:0 0 14px;">${esc(p)}</p>`).join("")}
  </td></tr>
  <tr><td style="padding:6px 32px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:6px;border-collapse:separate;">
      <tr><td style="padding:14px 16px;font-family:${SANS};font-size:14px;color:${INK};font-weight:600;background:#f8fafc;border-radius:6px 6px 0 0;">Offener Betrag</td><td align="right" style="padding:14px 16px;font-family:${SANS};font-size:22px;color:${a.stage === "final" ? DANGER : INK};font-weight:700;background:#f8fafc;border-radius:6px 6px 0 0;">${esc(amount)}</td></tr>
      ${factRows}
    </table>
  </td></tr>
  <tr><td style="padding:18px 32px 0;font-family:${SANS};font-size:15px;line-height:1.65;color:${BODY};">
    ${paras.slice(2).map((p) => `<p style="margin:0 0 14px;">${esc(p)}</p>`).join("")}
    <p style="margin:22px 0 0;">Mit freundlichen Grüßen</p>
    <p style="margin:4px 0 0;font-weight:700;color:${INK};">${esc(a.accountName)}</p>
  </td></tr>
  <tr><td style="padding:26px 32px 0;"><div style="height:2px;width:48px;background:${ACCENT};font-size:0;line-height:0;">&nbsp;</div></td></tr>
  <tr><td style="padding:14px 32px 26px;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">
    ${legalHtml}${website}
  </td></tr>
</table>
<div style="max-width:600px;padding:14px 12px 0;font-family:${SANS};font-size:11px;line-height:1.5;color:${MUTED};">Diese Nachricht wurde automatisch erstellt. Antworten erreichen uns trotzdem.</div>
</td></tr>
</table>
</body>
</html>`;

  const factText = [["Offener Betrag", amount] as [string, string], ...facts].map(([k, v]) => `${k}: ${v}`);
  const text = [
    subject.toUpperCase(),
    date ?? "",
    "",
    hello,
    "",
    ...paras.slice(0, 2).flatMap((p) => [p, ""]),
    ...factText,
    "",
    ...paras.slice(2).flatMap((p) => [p, ""]),
    "Mit freundlichen Grüßen",
    a.accountName,
    "",
    "--",
    ...(legal.length ? legal : [a.accountName]),
    ...(a.websiteUrl ? [a.websiteUrl] : []),
  ].join("\n");
  return { subject, html, text };
}
