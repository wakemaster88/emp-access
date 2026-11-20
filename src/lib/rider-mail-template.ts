/**
 * Anmelde-Mail der Kunden-App im Look der App: dunkler Grund, Kopf in Petrol,
 * kursive Versalschrift, gelber Akzent (CI tuttenbrocksee.com, wie
 * `src/app/app/rider.css`). Bewusst ohne `wrapEmailHtml`, weil die Verwaltungs-
 * Mails hell und schlicht sind. Nur Tabellen und Inline-Stile, damit es auch in
 * Outlook und Gmail hält.
 */
import { escapeHtml } from "./email-templates";

const BG = "#0b1214";
const CARD = "#121a1c";
const LINE = "#24373a";
const BRAND = "#1a6d73";
const BRAND_DARK = "#155a60";
const ACCENT = "#fbbf24";
const SOFT = "#c5d2d3";
const MUTED = "#a0b3b5";
const LINK = "#7fd6db";

const SANS = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue Condensed', Impact, Arial, sans-serif";

export interface RiderLinkMail {
  subject: string;
  html: string;
  text: string;
}

interface MailLayout {
  /** <title> und Betreff */
  title: string;
  preheader: string;
  accountName: string;
  origin: string;
  /** Zwei Zeilen in Versalien, die zweite gelb. */
  headline: [string, string];
  /** Einleitung als HTML (Werte vorher escapen). */
  introHtml: string;
  chips: string[];
  button: string;
  url: string;
  noteHtml: string;
  footerHtml: string;
}

/** Gemeinsamer Rahmen der App-Mails. */
function riderMailHtml(l: MailLayout): string {
  const url = escapeHtml(l.url);
  const name = escapeHtml(l.accountName);
  const icon = escapeHtml(`${l.origin}/app-icons/ride-pass-192.png`);
  const chips = l.chips
    .map(
      (c) =>
        `<td style="padding:0 6px 0 0;"><span style="display:inline-block;font-family:${SANS};font-size:12px;font-weight:600;color:#a9e6ea;background:#12383b;border-radius:999px;padding:4px 11px;">${escapeHtml(c)}</span></td>`,
    )
    .join("");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(l.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:${CARD};border:1px solid ${LINE};border-radius:10px;overflow:hidden;">
  <tr><td style="background:${BRAND};background-image:linear-gradient(135deg,${BRAND} 0%,${BRAND_DARK} 100%);padding:28px 24px 26px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;padding-right:12px;"><img src="${icon}" width="40" height="40" alt="" style="display:block;border:0;border-radius:9px;"></td>
      <td style="vertical-align:middle;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffffff;">${name}</td>
    </tr></table>
    <div style="margin-top:22px;font-family:${DISPLAY};font-style:italic;font-weight:800;font-size:46px;line-height:0.95;text-transform:uppercase;color:#ffffff;">${escapeHtml(l.headline[0])}<br><span style="color:${ACCENT};">${escapeHtml(l.headline[1])}</span></div>
  </td></tr>
  <tr><td style="height:6px;line-height:6px;font-size:0;background:${ACCENT};">&nbsp;</td></tr>
  <tr><td style="padding:26px 24px 8px;font-family:${SANS};font-size:16px;line-height:1.5;color:${SOFT};">
    ${l.introHtml}
  </td></tr>
  <tr><td style="padding:10px 24px 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${chips}</tr></table></td></tr>
  <tr><td style="padding:22px 24px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="background:${BRAND};border-radius:6px;border-left:6px solid ${ACCENT};">
        <a href="${url}" style="display:block;padding:15px 18px;font-family:${DISPLAY};font-style:italic;font-weight:800;font-size:22px;letter-spacing:0.02em;text-transform:uppercase;color:#ffffff;text-decoration:none;">${escapeHtml(l.button)} &rarr;</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:14px 24px 24px;font-family:${SANS};font-size:13.5px;line-height:1.5;color:${MUTED};">
    ${l.noteHtml}
  </td></tr>
  <tr><td style="padding:16px 24px 22px;border-top:1px solid ${LINE};font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};">
    ${l.footerHtml}<br>
    Klappt die Taste nicht? Diesen Link öffnen:<br><a href="${url}" style="color:${LINK};word-break:break-all;">${url}</a>
  </td></tr>
</table>
<div style="padding:14px 0 0;font-family:${SANS};font-size:11px;color:#5f7477;">${name}</div>
</td></tr>
</table>
</body>
</html>`;
}

/** Mail mit dem Anmelde-Link. `origin` dient für das App-Icon. */
export function riderLinkMail(args: { url: string; accountName: string; origin: string; hours: number }): RiderLinkMail {
  const note = `Der Link gilt ${args.hours} Stunden. Beim ersten Öffnen wählst du dein Abo aus und richtest einen Passkey oder ein Passwort ein. Noch kein Abo? Dann geht es auch ohne.`;
  const footer = "Du hast nichts angefordert? Dann musst du nichts tun, ohne Klick passiert nichts.";
  const html = riderMailHtml({
    title: "Dein Link zur App",
    preheader: "Ein Klick und du bist in deiner App.",
    accountName: args.accountName,
    origin: args.origin,
    headline: ["Deine", "Saison"],
    introHtml: "Hier ist dein Link zur App. Ein Klick, und du siehst dein Abo, deine Besuchstage, Starts und Gutscheine.",
    chips: ["Abo", "Besuche", "Gutscheine"],
    button: "App öffnen",
    url: args.url,
    noteHtml: note,
    footerHtml: footer,
  });

  const text = [
    "Deine Saison",
    "",
    `Hier ist dein Link zur App von ${args.accountName}. Ein Klick, und du siehst dein Abo, deine Besuchstage, Starts und Gutscheine.`,
    "",
    args.url,
    "",
    note,
    "",
    footer,
  ].join("\n");

  return { subject: "Dein Link zur App", html, text };
}

/**
 * Bestätigung für ein Kind mit eigener Adresse: eine Erwachsene möchte die
 * Abos dieser Adresse in ihre Familie holen (lib/rider-family-link).
 */
export function familyChildMail(args: { url: string; accountName: string; origin: string; inviterName: string; days: number }): RiderLinkMail {
  const who = escapeHtml(args.inviterName);
  const note = `Der Link gilt ${args.days} Tage. Gezählt wird weiter für jede Person einzeln, und ${who} kann das Abo jederzeit wieder aus der Familie nehmen.`;
  const footer = "Du kennst das nicht oder willst es nicht? Dann musst du nichts tun, ohne Klick passiert nichts.";
  const subject = "Familie in der App bestätigen";
  const html = riderMailHtml({
    title: subject,
    preheader: `${args.inviterName} möchte dein Abo in die Familie holen.`,
    accountName: args.accountName,
    origin: args.origin,
    headline: ["Deine", "Familie"],
    introHtml: `${who} möchte dein Abo in der App zur Familie holen. Dann sieht ${who} dein Abo, deine Besuchstage und Gutscheine und kümmert sich darum. Bitte bestätige das mit einem Klick.`,
    chips: ["Abo", "Besuche", "Gutscheine"],
    button: "Bestätigen",
    url: args.url,
    noteHtml: note,
    footerHtml: footer,
  });
  const text = [
    "Deine Familie",
    "",
    `${args.inviterName} möchte dein Abo in der App von ${args.accountName} zur Familie holen. Dann sieht ${args.inviterName} dein Abo, deine Besuchstage und Gutscheine und kümmert sich darum. Bitte bestätige das über diesen Link:`,
    "",
    args.url,
    "",
    `Der Link gilt ${args.days} Tage. Gezählt wird weiter für jede Person einzeln, und ${args.inviterName} kann das Abo jederzeit wieder aus der Familie nehmen.`,
    "",
    footer,
  ].join("\n");
  return { subject, html, text };
}

/** Passwort vergessen: Link zum Festlegen eines neuen Passworts oder Passkeys (lib/rider-reset). */
export function riderResetMail(args: { url: string; accountName: string; origin: string; minutes: number }): RiderLinkMail {
  const subject = "Neues Passwort für die App";
  const note = `Der Link gilt ${args.minutes} Minuten und nur einmal. Danach bist du angemeldet. Auf anderen Geräten meldest du dich mit dem neuen Passwort oder Passkey neu an.`;
  const footer = "Du hast nichts angefordert? Dann musst du nichts tun, dein bisheriges Passwort bleibt.";
  const html = riderMailHtml({
    title: subject,
    preheader: "Leg ein neues Passwort oder einen Passkey fest.",
    accountName: args.accountName,
    origin: args.origin,
    headline: ["Neues", "Passwort"],
    introHtml: "Du hast ein neues Passwort für deine App angefordert. Tipp auf die Taste und leg ein neues Passwort fest, oder richte gleich einen Passkey ein: Dann meldest du dich mit Face ID oder Fingerabdruck an.",
    chips: ["Passwort", "Passkey"],
    button: "Neu festlegen",
    url: args.url,
    noteHtml: note,
    footerHtml: footer,
  });
  const text = [
    "Neues Passwort",
    "",
    `Du hast ein neues Passwort für deine App von ${args.accountName} angefordert. Über diesen Link legst du ein neues Passwort oder einen Passkey fest:`,
    "",
    args.url,
    "",
    note,
    "",
    footer,
  ].join("\n");
  return { subject, html, text };
}

/**
 * Einladung zur App nach einem neu gebuchten Abo (lib/rider-invite). Geht
 * einmal an die Adresse des Kundenkontos, der Link meldet an wie der
 * Anmelde-Link.
 */
export function riderInviteMail(args: {
  url: string;
  accountName: string;
  origin: string;
  days: number;
  firstName: string | null;
  aboName: string | null;
}): RiderLinkMail {
  const subject = "Dein Abo ist in der App";
  const hello = args.firstName ? `Hallo ${args.firstName}, danke` : "Danke";
  const abo = args.aboName ? `dein ${args.aboName}` : "dein Abo";
  const intro = `${hello} für ${abo}! Mit der App hast du es immer dabei: Laufzeit, Besuchstage, Starts, Awards und Gutscheine.`;
  const note = `Der Link gilt ${args.days} Tage. Beim ersten Öffnen richtest du einen Passkey oder ein Passwort ein, danach findest du die App jederzeit unter ${args.origin.replace(/^https?:\/\//, "")}/app. Fahren mehrere aus deiner Familie, wählst du kurz, wer du bist.`;
  const footer = `Diese Mail kommt einmal, weil du bei ${args.accountName} ein Abo gebucht hast. Ohne Klick passiert nichts.`;
  const html = riderMailHtml({
    title: subject,
    preheader: "Dein Abo, deine Besuche und Gutscheine in einer App.",
    accountName: args.accountName,
    origin: args.origin,
    headline: ["Willkommen", "an Bord"],
    introHtml: escapeHtml(intro),
    chips: ["Abo", "Besuche", "Awards"],
    button: "App öffnen",
    url: args.url,
    noteHtml: escapeHtml(note),
    footerHtml: escapeHtml(footer),
  });
  const text = [
    "Willkommen an Bord",
    "",
    intro,
    "",
    "Hier geht es in die App:",
    args.url,
    "",
    note,
    "",
    footer,
  ].join("\n");
  return { subject, html, text };
}
