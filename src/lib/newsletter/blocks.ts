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
  /** #RRGGBB */
  color?: string | null;
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

const DEFAULT_COLOR = "#1a6d73";
const TEXT_COLOR = "#16181b";
const MUTED_COLOR = "#5f6368";

function brandColor(c: string | null | undefined): string {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_COLOR;
}

function blockHtml(b: NewsletterBlock, color: string): string {
  switch (b.type) {
    case "heading":
      return `<h2 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:${TEXT_COLOR};">${escapeHtml(b.text)}</h2>`;
    case "text":
      return b.text
        .split(/\n{2,}/)
        .map(
          (p) =>
            `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${TEXT_COLOR};">${p
              .split("\n")
              .map((line) => inlineHtml(line, color))
              .join("<br>")}</p>`,
        )
        .join("");
    case "image": {
      const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt ?? "")}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:12px;">`;
      return `<div style="margin:0 0 18px;">${b.link ? `<a href="${escapeHtml(b.link)}">${img}</a>` : img}</div>`;
    }
    case "button":
      return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 20px;"><tr><td style="border-radius:10px;background:${color};"><a href="${escapeHtml(b.url)}" style="display:inline-block;padding:13px 24px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(b.label)}</a></td></tr></table>`;
    case "divider":
      return `<hr style="margin:6px 0 22px;border:0;border-top:1px solid #e3e5e8;">`;
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

/** Die ganze Mail als HTML. */
export function renderNewsletterHtml(blocks: NewsletterBlock[], ctx: RenderContext): string {
  const color = brandColor(ctx.brand.color);
  const name = escapeHtml(ctx.brand.accountName);
  const logo = ctx.brand.logoUrl && isHttpsUrl(ctx.brand.logoUrl)
    ? `<img src="${escapeHtml(ctx.brand.logoUrl)}" alt="${name}" height="44" style="display:block;height:44px;width:auto;border:0;">`
    : `<div style="font-size:18px;font-weight:700;color:#ffffff;">${name}</div>`;
  const legal = (ctx.brand.legalFooter ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(escapeHtml)
    .join("<br>");
  const website = ctx.brand.websiteUrl && isHttpsUrl(ctx.brand.websiteUrl)
    ? `<a href="${escapeHtml(ctx.brand.websiteUrl)}" style="color:${MUTED_COLOR};">${escapeHtml(ctx.brand.websiteUrl.replace(/^https:\/\//, "").replace(/\/$/, ""))}</a>`
    : "";
  const footer = [
    ctx.reason ? escapeHtml(ctx.reason) : "",
    ctx.unsubscribeUrl
      ? `<a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:${MUTED_COLOR};text-decoration:underline;">Newsletter abbestellen</a>`
      : "",
    website,
    legal,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${name}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT_COLOR};">
${ctx.preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(ctx.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
<tr><td style="background:${color};border-radius:16px 16px 0 0;padding:20px 32px;">${logo}</td></tr>
<tr><td style="background:#ffffff;padding:32px 32px 16px;">
${blocks.map((b) => blockHtml(b, color)).join("\n")}
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 16px 16px;padding:0 32px 28px;"><div style="border-top:1px solid #e3e5e8;padding-top:18px;font-size:12px;line-height:1.6;color:${MUTED_COLOR};">${footer.join("<br><br>")}</div></td></tr>
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
