/**
 * Inhalt einer Newsletter-Aussendung als Bausteine und deren Darstellung als
 * Mail (HTML und reiner Text). Ohne Node-Abhängigkeiten: Die Verwaltung
 * zeigt mit denselben Funktionen die Vorschau im Browser.
 *
 * Formatierung im Text: **fett**, [Linktext](https://…), Leerzeile = neuer Absatz.
 */

export type NewsletterBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "image"; url: string; alt?: string; link?: string }
  | { type: "button"; label: string; url: string }
  | { type: "divider" };

export type NewsletterBlockType = NewsletterBlock["type"];

export const BLOCK_TYPES: NewsletterBlockType[] = ["heading", "text", "image", "button", "divider"];

export const BLOCK_LABEL: Record<NewsletterBlockType, string> = {
  heading: "Überschrift",
  text: "Text",
  image: "Bild",
  button: "Taste",
  divider: "Trennlinie",
};

const MAX_BLOCKS = 40;
const MAX_TEXT = 5_000;
const MAX_SHORT = 200;
const MAX_URL = 2_000;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Nur https-Adressen (für Bilder und Tasten). */
export function isHttpsUrl(value: string): boolean {
  if (value.length > MAX_URL) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

/** Links im Text dürfen auch mailto: und tel: sein. */
export function isLinkUrl(value: string): boolean {
  if (isHttpsUrl(value)) return true;
  return /^mailto:[^\s<>"]{3,300}$/i.test(value) || /^tel:\+?[0-9 ()/-]{3,40}$/i.test(value);
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n?/g, "\n").trim();
  return t.length <= max ? t : null;
}

/**
 * Bausteine aus einer Anfrage prüfen. Leere Text-Bausteine fallen weg; ein
 * ungültiger Baustein liefert einen Fehler mit seiner Nummer.
 */
export function parseBlocks(input: unknown): { blocks: NewsletterBlock[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "Inhalt fehlt" };
  if (input.length > MAX_BLOCKS) return { error: `Höchstens ${MAX_BLOCKS} Bausteine` };
  const blocks: NewsletterBlock[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown> | null;
    const n = i + 1;
    if (!raw || typeof raw !== "object") return { error: `Baustein ${n} ist ungültig` };
    switch (raw.type) {
      case "heading": {
        const text = str(raw.text, MAX_SHORT);
        if (text === null) return { error: `Überschrift ${n}: höchstens ${MAX_SHORT} Zeichen` };
        if (text) blocks.push({ type: "heading", text });
        break;
      }
      case "text": {
        const text = str(raw.text, MAX_TEXT);
        if (text === null) return { error: `Text ${n}: höchstens ${MAX_TEXT} Zeichen` };
        if (text) blocks.push({ type: "text", text });
        break;
      }
      case "image": {
        const url = str(raw.url, MAX_URL) ?? "";
        if (!isHttpsUrl(url)) return { error: `Bild ${n}: Bitte eine https-Adresse angeben` };
        const alt = str(raw.alt ?? "", MAX_SHORT);
        if (alt === null) return { error: `Bild ${n}: Beschreibung zu lang` };
        const link = str(raw.link ?? "", MAX_URL) ?? "";
        if (link && !isLinkUrl(link)) return { error: `Bild ${n}: Link ist keine gültige Adresse` };
        blocks.push({ type: "image", url, ...(alt ? { alt } : {}), ...(link ? { link } : {}) });
        break;
      }
      case "button": {
        const label = str(raw.label, 60);
        if (!label) return { error: `Taste ${n}: Beschriftung fehlt (höchstens 60 Zeichen)` };
        const url = str(raw.url, MAX_URL) ?? "";
        if (!isLinkUrl(url)) return { error: `Taste ${n}: Bitte eine https-Adresse angeben` };
        blocks.push({ type: "button", label, url });
        break;
      }
      case "divider":
        blocks.push({ type: "divider" });
        break;
      default:
        return { error: `Baustein ${n}: unbekannte Art` };
    }
  }
  return { blocks };
}

const LINK_RE = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g;

/** **fett** innerhalb eines schon maskierten Texts. */
function boldHtml(escaped: string): string {
  return escaped.replace(/\*\*([^*\n]{1,500})\*\*/g, "<strong>$1</strong>");
}

/** Eine Zeile Fließtext mit **fett** und [Links](…) als HTML. */
export function inlineHtml(text: string, linkColor: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const idx = m.index ?? 0;
    out += boldHtml(escapeHtml(text.slice(last, idx)));
    const [, label, url] = m;
    if (isLinkUrl(url)) {
      out += `<a href="${escapeHtml(url)}" style="color:${linkColor};text-decoration:underline;">${boldHtml(escapeHtml(label))}</a>`;
    } else {
      out += boldHtml(escapeHtml(m[0]));
    }
    last = idx + m[0].length;
  }
  out += boldHtml(escapeHtml(text.slice(last)));
  return out;
}

/** Fließtext als reiner Text: Links als „Text (Adresse)“, ohne Sternchen. */
export function inlineText(text: string): string {
  return text
    .replace(LINK_RE, (_m, label: string, url: string) => (isLinkUrl(url) ? `${label} (${url})` : _m))
    .replace(/\*\*([^*\n]{1,500})\*\*/g, "$1");
}

export interface NewsletterBrand {
  accountName: string;
  /** Hauptfarbe (#RRGGBB) für Tasten und Links. Leer: Petrol der Website. */
  color?: string | null;
  /** Akzent (#RRGGBB) für die Linie unter dem Kopf und Links im Fuß. Leer: Gelb der Website. */
  accentColor?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  /** Pflichtangaben (Impressum), eine Angabe je Zeile. */
  legalFooter?: string | null;
}

export interface RenderContext {
  brand: NewsletterBrand;
  preheader?: string | null;
  /** Abmeldelink des Empfängers; ohne Link (Bestätigungsmail) fehlt die Zeile. */
  unsubscribeUrl?: string | null;
  /** Satz unter dem Inhalt, warum die Mail kommt. */
  reason?: string | null;
}

/*
 * Aussehen wie tuttenbrocksee.com: weißer Kopf mit Logo und gelber Linie,
 * Petrol für Tasten (Pille) und Links, Überschriften in Slate-900, Fuß dunkel.
 * Schrift Inter, wo sie installiert ist (keine Web-Schrift von Google: das
 * würde die IP jedes Lesers an Google geben), sonst die Systemschrift.
 */
export const NEWSLETTER_DEFAULT_COLOR = "#1a6d73";
export const NEWSLETTER_DEFAULT_ACCENT = "#fbbf24";
const INK = "#0f172a";
const TEXT_COLOR = "#334155";
const FOOT_TEXT = "#cbd5e1";
const PAGE_BG = "#f1f5f9";
const LINE = "#e2e8f0";
export const NEWSLETTER_FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT = NEWSLETTER_FONT;

export function isHexColor(c: unknown): c is string {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
}

function hexOr(c: string | null | undefined, fallback: string): string {
  return isHexColor(c) ? c : fallback;
}

/** Schrift auf einer Fläche: dunkel auf hellen Farben, sonst weiß. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Kontrast zu Weiß gegen Kontrast zu Slate-900 (Leuchtdichte 0,0089).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0589 ? "#ffffff" : INK;
}

/** Farben der Mail und der öffentlichen Seiten aus den Einstellungen. */
export function newsletterColors(brand: NewsletterBrand | null | undefined): { color: string; onColor: string; accent: string } {
  const color = hexOr(brand?.color, NEWSLETTER_DEFAULT_COLOR);
  return { color, onColor: textOn(color), accent: hexOr(brand?.accentColor, NEWSLETTER_DEFAULT_ACCENT) };
}

function paragraphs(text: string, color: string, style: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="${style}">${p.split("\n").map((line) => inlineHtml(line, color)).join("<br>")}</p>`)
    .join("");
}

function blockHtml(b: NewsletterBlock, c: { color: string; onColor: string }, h1: boolean): string {
  switch (b.type) {
    case "heading":
      return h1
        ? `<h1 class="nl-h1" style="margin:0 0 16px;font-family:${FONT};font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-0.3px;color:${INK};">${escapeHtml(b.text)}</h1>`
        : `<h2 style="margin:8px 0 12px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${INK};">${escapeHtml(b.text)}</h2>`;
    case "text":
      return paragraphs(b.text, c.color, `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.65;color:${TEXT_COLOR};`);
    case "image": {
      const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt ?? "")}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:16px;">`;
      return `<div style="margin:4px 0 20px;">${b.link ? `<a href="${escapeHtml(b.link)}">${img}</a>` : img}</div>`;
    }
    case "button":
      return (
        `<table role="presentation" class="nl-btn" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;border-collapse:separate;">` +
        `<tr><td align="center" style="border-radius:999px;background:${c.color};">` +
        `<a href="${escapeHtml(b.url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${c.onColor};text-decoration:none;border-radius:999px;">${escapeHtml(b.label)}</a>` +
        `</td></tr></table>`
      );
    case "divider":
      return `<hr style="margin:8px 0 24px;border:0;border-top:1px solid ${LINE};">`;
  }
}

function blockText(b: NewsletterBlock): string {
  switch (b.type) {
    case "heading":
      return b.text.toUpperCase();
    case "text":
      return inlineText(b.text);
    case "image":
      return b.link ? `${b.alt ? `${b.alt}: ` : ""}${b.link}` : "";
    case "button":
      return `${b.label}: ${b.url}`;
    case "divider":
      return "––––––––––";
  }
}

/** Logo (oder Name) für den Kopf der Mail. */
function headerLogo(brand: NewsletterBrand): string {
  const name = escapeHtml(brand.accountName);
  if (brand.logoUrl && isHttpsUrl(brand.logoUrl)) {
    return `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="36" style="display:block;height:36px;width:auto;max-width:260px;border:0;">`;
  }
  return `<div style="font-family:${FONT};font-size:18px;line-height:1.3;font-weight:700;color:${INK};">${name}</div>`;
}

/**
 * Die ganze Mail als HTML: 600 px breit, auf dem Handy (bis 620 px) randlos
 * mit schmalerem Innenabstand und Tasten über die ganze Breite. Ist der erste
 * Baustein ein Bild, steht es randlos unter dem Kopf wie das Titelbild der
 * Website; die erste Überschrift ist die große.
 */
export function renderNewsletterHtml(blocks: NewsletterBlock[], ctx: RenderContext): string {
  const c = newsletterColors(ctx.brand);
  const name = escapeHtml(ctx.brand.accountName);
  const hero = blocks[0]?.type === "image" ? blocks[0] : null;
  const body = hero ? blocks.slice(1) : blocks;
  const firstHeading = body.findIndex((b) => b.type === "heading");

  const legal = (ctx.brand.legalFooter ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(escapeHtml)
    .join("<br>");
  const website = ctx.brand.websiteUrl && isHttpsUrl(ctx.brand.websiteUrl)
    ? `<a href="${escapeHtml(ctx.brand.websiteUrl)}" style="color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(ctx.brand.websiteUrl.replace(/^https:\/\//, "").replace(/^www\./, "").replace(/\/$/, ""))}</a>`
    : "";
  const unsubscribe = ctx.unsubscribeUrl
    ? `<a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:${c.accent};text-decoration:underline;">Newsletter abbestellen</a>`
    : "";
  const footer = [
    `<span style="font-size:15px;font-weight:700;color:#ffffff;">${name}</span>${website ? `<br>${website}` : ""}`,
    ctx.reason ? escapeHtml(ctx.reason) : "",
    unsubscribe,
    legal,
  ].filter(Boolean);

  const heroHtml = hero
    ? (() => {
        const img = `<img src="${escapeHtml(hero.url)}" alt="${escapeHtml(hero.alt ?? "")}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">`;
        return `<tr><td style="background:#ffffff;padding:0;line-height:0;font-size:0;">${hero.link ? `<a href="${escapeHtml(hero.link)}">${img}</a>` : img}</td></tr>`;
      })()
    : "";
  // Füllzeichen nach der Vorschauzeile, damit das Postfach keinen Text aus der Mail anhängt.
  const preheader = ctx.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(ctx.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>`
    : "";

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${name}</title>
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%;text-size-adjust:100%}
table{border-collapse:collapse}
img{-ms-interpolation-mode:bicubic}
@media only screen and (max-width:620px){
.nl-outer{padding:0!important}
.nl-top,.nl-bottom{border-radius:0!important}
.nl-pad{padding-left:20px!important;padding-right:20px!important}
.nl-h1{font-size:26px!important}
.nl-btn{width:100%!important}
.nl-btn a{display:block!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:${FONT};color:${TEXT_COLOR};">
${preheader}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAGE_BG};"><tr><td align="center" class="nl-outer" style="padding:24px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
<tr><td class="nl-top nl-pad" style="background:#ffffff;border-radius:16px 16px 0 0;border-bottom:4px solid ${c.accent};padding:20px 32px;">${headerLogo(ctx.brand)}</td></tr>
${heroHtml}
<tr><td class="nl-pad" style="background:#ffffff;padding:32px 32px 12px;">
${body.map((b, i) => blockHtml(b, c, i === firstHeading)).join("\n")}
</td></tr>
<tr><td class="nl-bottom nl-pad" style="background:${INK};border-radius:0 0 16px 16px;padding:28px 32px 32px;font-family:${FONT};font-size:13px;line-height:1.6;color:${FOOT_TEXT};">${footer.join("<br><br>")}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Die ganze Mail als reiner Text. */
export function renderNewsletterText(blocks: NewsletterBlock[], ctx: RenderContext): string {
  const parts = blocks.map(blockText).filter(Boolean);
  const footer = [
    ctx.reason ?? "",
    ctx.unsubscribeUrl ? `Newsletter abbestellen: ${ctx.unsubscribeUrl}` : "",
    ctx.brand.websiteUrl ?? "",
    (ctx.brand.legalFooter ?? "").trim(),
  ].filter(Boolean);
  return `${parts.join("\n\n")}\n\n--\n${footer.join("\n\n")}\n`;
}

/** Inhalt der Bestätigungsmail (Double-Opt-in). */
export function confirmMailBlocks(accountName: string, confirmUrl: string): NewsletterBlock[] {
  return [
    { type: "heading", text: "Bitte bestätige deine Anmeldung" },
    {
      type: "text",
      text:
        `Jemand, hoffentlich du, hat diese Adresse für den Newsletter von ${accountName} angemeldet. ` +
        "Mit einem Klick auf die Taste bestätigst du die Anmeldung.",
    },
    { type: "button", label: "Anmeldung bestätigen", url: confirmUrl },
    {
      type: "text",
      text: "Warst du das nicht? Dann ignoriere diese Mail einfach. Ohne Bestätigung bekommst du nichts von uns.",
    },
  ];
}

/** Mail mit dem Abmeldelink, angefordert auf der Abmeldeseite ohne Link. */
export function unsubscribeMailBlocks(accountName: string, unsubscribeUrl: string): NewsletterBlock[] {
  return [
    { type: "heading", text: "Newsletter abbestellen" },
    {
      type: "text",
      text:
        `Jemand, hoffentlich du, möchte diese Adresse vom Newsletter von ${accountName} abmelden. ` +
        "Mit einem Klick auf die Taste und der Bestätigung auf der Seite bist du abgemeldet.",
    },
    { type: "button", label: "Newsletter abbestellen", url: unsubscribeUrl },
    { type: "text", text: "Warst du das nicht? Dann ignoriere diese Mail einfach. Es ändert sich nichts." },
  ];
}
