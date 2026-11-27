import { NEWSLETTER_FONT, escapeHtml, isHttpsUrl, newsletterColors, type NewsletterBrand } from "./blocks";

/**
 * Öffentliche Seiten „Anmeldung bestätigen“ und „Abmelden“ als schlichtes
 * HTML ohne Skripte und ohne Dateien von dieser App. So funktionieren sie
 * auch, wenn die Website sie unter ihrer eigenen Adresse weiterleitet
 * (tuttenbrocksee.com/newsletter/… → /nl/…).
 */

export interface PublicPage {
  title: string;
  /** Absätze als reiner Text. */
  lines: string[];
  /** Taste, die das Formular an dieselbe Adresse schickt. */
  form?: { token: string; label: string };
  /** Feld für die E-Mail-Adresse mit Taste; schickt `email` (und `a`) an dieselbe Adresse. */
  emailForm?: { label: string; accountId?: number | null };
  brand?: NewsletterBrand | null;
  status?: number;
}

/** Kopf wie in der Mail: Logo (oder Name) auf Weiß mit Akzentlinie. */
function pageHeader(brand: NewsletterBrand | null | undefined, name: string): string {
  const logo = brand?.logoUrl && isHttpsUrl(brand.logoUrl)
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="32">`
    : `<span class="name">${name}</span>`;
  const href = brand?.websiteUrl && isHttpsUrl(brand.websiteUrl) ? escapeHtml(brand.websiteUrl) : "";
  return `<header>${href ? `<a href="${href}">${logo}</a>` : logo}</header>`;
}

export function publicPageHtml(p: PublicPage): string {
  const { color, onColor, accent } = newsletterColors(p.brand);
  const name = escapeHtml(p.brand?.accountName ?? "Newsletter");
  const website =
    p.brand?.websiteUrl && isHttpsUrl(p.brand.websiteUrl)
      ? `<p class="foot"><a href="${escapeHtml(p.brand.websiteUrl)}">Zur Website</a></p>`
      : "";
  const form = p.form
    ? `<form method="post"><input type="hidden" name="t" value="${escapeHtml(p.form.token)}"><button type="submit">${escapeHtml(p.form.label)}</button></form>`
    : p.emailForm
      ? `<form method="post">${p.emailForm.accountId ? `<input type="hidden" name="a" value="${p.emailForm.accountId}">` : ""}` +
        `<label for="email">E-Mail-Adresse</label>` +
        `<input id="email" type="email" name="email" required maxlength="180" autocomplete="email" inputmode="email" spellcheck="false">` +
        `<button type="submit">${escapeHtml(p.emailForm.label)}</button></form>`
      : "";
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(p.title)} · ${name}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:#f1f5f9;color:#334155;font:16px/1.6 ${NEWSLETTER_FONT}}
main{width:100%;max-width:460px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.06),0 8px 24px rgba(15,23,42,.06)}
header{padding:18px 24px;border-bottom:4px solid ${accent}}
header a{display:inline-block}
header img{display:block;height:32px;width:auto;max-width:100%}
header .name{font-weight:700;font-size:18px;color:#0f172a}
section{padding:28px 24px 24px}
h1{margin:0 0 12px;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-.3px;color:#0f172a}
p{margin:0 0 12px}
button{width:100%;margin-top:12px;padding:14px 20px;border:0;border-radius:999px;background:${color};color:${onColor};font:inherit;font-weight:600;cursor:pointer}
button:hover{filter:brightness(.92)}
button:focus-visible{outline:3px solid ${accent};outline-offset:2px}
label{display:block;margin:8px 0 6px;font-size:14px;font-weight:600;color:#0f172a}
input[type=email]{width:100%;padding:12px 16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;font:inherit}
input[type=email]:focus-visible{outline:3px solid ${color};outline-offset:1px;border-color:${color}}
.foot{margin:20px 0 0;font-size:14px}
.foot a{color:${color};font-weight:600}
@media (max-width:480px){body{align-items:flex-start;padding:0}main{border-radius:0;box-shadow:none;min-height:100vh}section{padding:24px 20px}header{padding:16px 20px}}
</style>
</head><body><main>${pageHeader(p.brand, name)}<section>
<h1>${escapeHtml(p.title)}</h1>
${p.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
${form}
${website}
</section></main></body></html>`;
}

export function publicPageResponse(p: PublicPage): Response {
  return new Response(publicPageHtml(p), {
    status: p.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

export const INVALID_LINK_PAGE: PublicPage = {
  title: "Link ungültig",
  lines: ["Dieser Link ist ungültig oder abgelaufen. Bitte nutze den Link aus der neuesten Mail oder melde dich auf der Website neu an."],
  status: 404,
};
