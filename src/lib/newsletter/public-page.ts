import { escapeHtml, isHttpsUrl, type NewsletterBrand } from "./blocks";

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
  brand?: NewsletterBrand | null;
  status?: number;
}

const DEFAULT_COLOR = "#1a6d73";

export function publicPageHtml(p: PublicPage): string {
  const color = p.brand?.color && /^#[0-9a-f]{6}$/i.test(p.brand.color) ? p.brand.color : DEFAULT_COLOR;
  const name = escapeHtml(p.brand?.accountName ?? "Newsletter");
  const website =
    p.brand?.websiteUrl && isHttpsUrl(p.brand.websiteUrl)
      ? `<p class="foot"><a href="${escapeHtml(p.brand.websiteUrl)}">Zur Website</a></p>`
      : "";
  const form = p.form
    ? `<form method="post"><input type="hidden" name="t" value="${escapeHtml(p.form.token)}"><button type="submit">${escapeHtml(p.form.label)}</button></form>`
    : "";
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(p.title)} · ${name}</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:#f3f4f6;color:#16181b;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{width:100%;max-width:440px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:16px;overflow:hidden}
header{background:${color};color:#fff;padding:16px 24px;font-weight:700}
section{padding:24px}
h1{margin:0 0 12px;font-size:22px;line-height:1.3}
p{margin:0 0 12px;color:#3c4043}
button{width:100%;margin-top:8px;padding:13px 16px;border:0;border-radius:10px;background:${color};color:#fff;font:inherit;font-weight:700;cursor:pointer}
button:focus-visible{outline:3px solid #fbbf24;outline-offset:2px}
.foot{margin-top:16px;font-size:14px}
.foot a{color:${color}}
@media (prefers-color-scheme:dark){body{background:#0f1114;color:#eceff1}main{background:#1a1d21;border-color:rgba(255,255,255,.08)}p{color:#c4c7cb}.foot a{color:#8fd3d8}}
</style>
</head><body><main><header>${name}</header><section>
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
