/**
 * Mail-Templates und Variablen-Rendering.
 *
 * Variablen werden im Format `{{name}}` ersetzt – fehlt eine Variable, wird
 * der Platzhalter durch einen leeren String ersetzt (kein Throw, sondern
 * tolerantes Best-Effort-Rendering).
 */

export interface TemplateVariables {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  ticketTypeName?: string | null;
  subscriptionName?: string | null;
  serviceName?: string | null;
  accountName?: string | null;
  endDate?: string | null;
  startDate?: string | null;
  daysUntilExpiry?: string | null;
  daysSinceVisit?: string | null;
  voucherCode?: string | null;
  voucherUrl?: string | null;
  voucherDiscountPercent?: string | null;
  voucherExpiresAt?: string | null;
  renewUrl?: string | null;
  websiteUrl?: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
}

/**
 * Liefert plausible Beispiel-Variablen für Vorschau-/Test-Mails. Die Werte
 * werden trigger-spezifisch (Abo vs. Tagesgast) leicht angepasst, damit das
 * Ergebnis nahe an einer echten Mail ist.
 */
export function buildSampleTemplateVariables(args: {
  trigger?: "SUBSCRIPTION_EXPIRING" | "SUBSCRIPTION_EXPIRED" | "DAY_VISIT_FOLLOWUP" | "TICKET_WELCOME";
  daysOffset?: number;
  createVoucher?: boolean;
  voucherDiscountPercent?: number | null;
  voucherValidDays?: number | null;
  renewUrl?: string | null;
  accountName?: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}): TemplateVariables {
  const trig = args.trigger ?? "SUBSCRIPTION_EXPIRING";
  const offset = args.daysOffset ?? 7;
  const today = new Date();
  const fmt = (d: Date) =>
    d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  const futureDate = new Date(today.getTime() + offset * 86_400_000);
  const pastDate = new Date(today.getTime() - offset * 86_400_000);
  const voucherExpires = args.voucherValidDays
    ? new Date(today.getTime() + args.voucherValidDays * 86_400_000)
    : new Date(today.getTime() + 60 * 86_400_000);

  return {
    firstName: "Max",
    lastName: "Mustermann",
    fullName: "Max Mustermann",
    ticketTypeName: trig === "DAY_VISIT_FOLLOWUP" ? "Tagesticket" : "Premium-Abo",
    subscriptionName: "Premium-Abo",
    serviceName: trig === "DAY_VISIT_FOLLOWUP" ? "Tagesgast" : null,
    accountName: args.accountName || "EMP Access",
    endDate: trig === "SUBSCRIPTION_EXPIRING" ? fmt(futureDate) : trig === "SUBSCRIPTION_EXPIRED" ? fmt(pastDate) : fmt(futureDate),
    startDate: fmt(new Date(today.getTime() - 365 * 86_400_000)),
    daysUntilExpiry: trig === "SUBSCRIPTION_EXPIRING" ? String(offset) : "0",
    daysSinceVisit: trig === "DAY_VISIT_FOLLOWUP" ? String(offset) : "0",
    voucherCode: args.createVoucher ? "EMP-A1B2C3D4" : null,
    voucherUrl: args.createVoucher ? "https://emp-access/voucher/EMP-A1B2C3D4" : null,
    voucherDiscountPercent:
      args.createVoucher && args.voucherDiscountPercent != null
        ? String(args.voucherDiscountPercent)
        : args.createVoucher
          ? "10"
          : null,
    voucherExpiresAt: args.createVoucher ? fmt(voucherExpires) : null,
    renewUrl: args.renewUrl || (trig === "SUBSCRIPTION_EXPIRING" ? "https://example.com/abo-verlaengern" : null),
    websiteUrl: args.websiteUrl ?? null,
    brandColor: args.brandColor ?? null,
    logoUrl: args.logoUrl ?? null,
  };
}

export function renderTemplate(template: string, vars: TemplateVariables): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const v = (vars as Record<string, string | null | undefined>)[key];
    return v == null ? "" : String(v);
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wickelt den vom Tenant erstellten HTML-Body in einen Premium-Mail-Wrapper. */
export function wrapEmailHtml(args: {
  innerHtml: string;
  brandColor?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  accountName?: string | null;
  preheader?: string | null;
}): string {
  const brand = args.brandColor || "#0891b2";
  const acc = escapeHtml(args.accountName || "EMP Access");
  const preheader = args.preheader ? escapeHtml(args.preheader) : "";
  const websiteHost = args.websiteUrl ? args.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const logo = args.logoUrl
    ? `<img src="${escapeHtml(args.logoUrl)}" alt="${acc}" style="max-height:42px;display:block;margin:0 auto;" />`
    : `<div style="color:#ffffff;font-weight:700;font-size:18px;letter-spacing:0.02em;">${acc}</div>`;

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${acc}</title>
</head>
<body style="margin:0;padding:32px 16px;background:linear-gradient(180deg,#ecfeff 0%,#f1f5f9 280px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;max-width:600px;">
  <tr><td style="background:linear-gradient(135deg,${brand} 0%,${shade(brand, -18)} 100%);border-radius:18px 18px 0 0;padding:28px 28px 26px;text-align:center;">
    ${logo}
  </td></tr>
  <tr><td style="background:#ffffff;padding:36px 32px 28px;font-size:15.5px;line-height:1.65;color:#0f172a;">
    ${args.innerHtml}
  </td></tr>
  <tr><td style="background:#0f172a;border-radius:0 0 18px 18px;padding:22px 28px;color:#cbd5e1;text-align:center;font-size:12.5px;line-height:1.6;">
    ${websiteHost ? `<a href="${escapeHtml(args.websiteUrl!)}" style="color:#ffffff;text-decoration:none;font-weight:600;letter-spacing:0.02em;">${escapeHtml(websiteHost)}</a><div style="height:8px;line-height:8px;">&nbsp;</div>` : ""}
    <span style="color:#64748b;">Du erhältst diese Mail automatisch von ${acc}.</span>
  </td></tr>
  <tr><td style="height:24px;line-height:24px;">&nbsp;</td></tr>
</table>
</body></html>`;
}

/** Verdunkelt/hellt einen #RRGGBB-Hex-Wert prozentual auf (–100 bis +100). */
function shade(hex: string, percent: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent) / 100;
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Vorlagen für den Schnell-Setup-Dialog. */
export interface PresetTemplate {
  id: string;
  label: string;
  description: string;
  defaults: {
    name: string;
    trigger: "SUBSCRIPTION_EXPIRING" | "SUBSCRIPTION_EXPIRED" | "DAY_VISIT_FOLLOWUP" | "TICKET_WELCOME";
    daysOffset: number;
    cooldownDays: number;
    subject: string;
    bodyHtml: string;
    createVoucher: boolean;
    voucherDiscountPercent?: number;
    voucherValidDays?: number;
    voucherTicketTypeName?: string;
    renewUrl?: string;
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Tuttenbrocksee-CI-Templates
 *
 * Design-Prinzipien:
 *  - Email-client-safe (Tabellen-Layout, inline styles, keine media queries)
 *  - Wasser-/Lake-Aesthetic: Cyan/Teal Akzente, sandig-warme Voucher-Boxen
 *  - Hero-Stat-Cards mit grosser Zahl/Datum als Blickfang
 *  - Klare CTAs mit dezentem Schatten-Look (border-bottom)
 *  - Du-Form, freundlich, energetisch (passt zum TBS-Tonfall)
 * ────────────────────────────────────────────────────────────────────────── */

const HERO_GRADIENT_BLUE = "background:linear-gradient(135deg,#0891b2 0%,#0e7490 100%);";
const HERO_GRADIENT_SUNSET = "background:linear-gradient(135deg,#0e7490 0%,#0891b2 50%,#06b6d4 100%);";

const STYLE_CTA_PRIMARY =
  "display:inline-block;background:#0891b2;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15.5px;letter-spacing:0.01em;border-bottom:3px solid #0e7490;";
const STYLE_CTA_AMBER =
  "display:inline-block;background:#f59e0b;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15.5px;letter-spacing:0.01em;border-bottom:3px solid #d97706;";

/** Wiederverwendbare Voucher-Karte mit Code, Rabatt und Gueltigkeit. */
const VOUCHER_BOX = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
  <tr><td style="border:2px dashed #fbbf24;background:#fffbeb;border-radius:14px;padding:22px 18px;text-align:center;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#b45309;margin-bottom:8px;">Dein Gutschein-Code</div>
    <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:0.14em;color:#78350f;padding:10px 0 12px;">{{voucherCode}}</div>
    <div style="display:inline-block;background:#f59e0b;color:#ffffff;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:600;margin-bottom:6px;">{{voucherDiscountPercent}}% Rabatt</div>
    <div style="font-size:12px;color:#92400e;margin-top:6px;">Gültig bis <strong>{{voucherExpiresAt}}</strong></div>
  </td></tr>
</table>`;

/** Hero-Stat-Card (z. B. Countdown bis Aboablauf). */
function statCard(args: { label: string; value: string; sublabel: string }): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 26px;">
  <tr><td style="${HERO_GRADIENT_BLUE}border-radius:14px;padding:24px 16px;text-align:center;color:#ffffff;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;opacity:0.85;">${args.label}</div>
    <div style="font-size:42px;font-weight:800;line-height:1.1;margin:6px 0 4px;">${args.value}</div>
    <div style="font-size:13px;opacity:0.9;">${args.sublabel}</div>
  </td></tr>
</table>`;
}

/** Liste der typischen Tuttenbrocksee-Erlebnisse als kleine Chips. */
const ACTIVITY_CHIPS = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 24px;">
  <tr>
    <td style="padding:6px 4px;text-align:center;">
      <div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:10px;padding:12px 6px;color:#0e7490;font-size:13px;font-weight:600;">Strandbad</div>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:10px;padding:12px 6px;color:#0e7490;font-size:13px;font-weight:600;">Aquapark</div>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:10px;padding:12px 6px;color:#0e7490;font-size:13px;font-weight:600;">Wake &amp; Ski</div>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:10px;padding:12px 6px;color:#0e7490;font-size:13px;font-weight:600;">SUP</div>
    </td>
  </tr>
</table>`;

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: "abo-expiring-7",
    label: "Abo läuft in 7 Tagen aus",
    description:
      "Erinnert Mitglieder 7 Tage vor Ablauf an die Verlängerung – mit prominenter Countdown-Card und CTA.",
    defaults: {
      name: "Abo-Erinnerung 7 Tage vor Ablauf",
      trigger: "SUBSCRIPTION_EXPIRING",
      daysOffset: 7,
      cooldownDays: 30,
      subject: "Noch {{daysUntilExpiry}} Tage – dein {{subscriptionName}} läuft aus",
      bodyHtml: `<div style="font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#0891b2;margin-bottom:6px;">Dein Sommer am See</div>
<h1 style="margin:0 0 18px;font-size:26px;font-weight:800;line-height:1.2;color:#0f172a;">Hey {{firstName}}, dein Abo läuft bald aus.</h1>

${statCard({ label: "Noch", value: "{{daysUntilExpiry}} Tage", sublabel: "bis zum {{endDate}}" })}

<p style="margin:0 0 14px;color:#334155;">Damit du keinen Sommertag am Tuttenbrocksee verpasst, kannst du dein <strong>{{subscriptionName}}</strong> mit einem Klick verlängern – ohne Lücke und ohne neuen Vertrag aushandeln zu müssen.</p>

<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0e7490;letter-spacing:0.04em;text-transform:uppercase;">Was bei dir weiter dabei ist</p>
${ACTIVITY_CHIPS}

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
  <tr><td align="center"><a href="{{renewUrl}}" style="${STYLE_CTA_PRIMARY}">Jetzt verlängern</a></td></tr>
</table>

<p style="margin:0 0 6px;color:#64748b;font-size:13.5px;">Falls dein Abo automatisch verlängert wird, brauchst du nichts zu tun. Diese Mail ist trotzdem ein guter Reminder, damit du den Termin auf dem Schirm hast.</p>

<div style="border-top:1px solid #e2e8f0;margin:26px 0 18px;"></div>
<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
  Wir freuen uns, dich weiter am See zu sehen.<br/>
  <strong style="color:#0f172a;">Dein {{accountName}}-Team</strong>
</p>`,
      createVoucher: false,
      renewUrl: "https://www.tuttenbrocksee.com",
    },
  },
  {
    id: "abo-expired-3",
    label: "Win-Back: 3 Tage nach Aboablauf",
    description:
      "Reaktiviert ehemalige Mitglieder mit prominentem Voucher und kurzem Reminder, was sie verpassen.",
    defaults: {
      name: "Win-Back 3 Tage nach Aboablauf",
      trigger: "SUBSCRIPTION_EXPIRED",
      daysOffset: 3,
      cooldownDays: 90,
      subject: "Wir vermissen dich am See, {{firstName}}",
      bodyHtml: `<div style="font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#0891b2;margin-bottom:6px;">Komm zurück ans Wasser</div>
<h1 style="margin:0 0 18px;font-size:26px;font-weight:800;line-height:1.2;color:#0f172a;">Hey {{firstName}}, der See ohne dich? Geht so.</h1>

<p style="margin:0 0 14px;color:#334155;">Dein Abo ist seit ein paar Tagen ausgelaufen – und ehrlich gesagt: wir hätten dich gern weiter regelmäßig hier. Damit der Wiedereinstieg leichter fällt, gibt's von uns einen kleinen Bonus.</p>

${VOUCHER_BOX}

<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0e7490;letter-spacing:0.04em;text-transform:uppercase;">Das hast du gerade verpasst</p>
${ACTIVITY_CHIPS}

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
  <tr><td align="center"><a href="{{renewUrl}}" style="${STYLE_CTA_PRIMARY}">Wieder einsteigen</a></td></tr>
</table>

<p style="margin:0 0 6px;color:#64748b;font-size:13.5px;">Den Code einfach bei der nächsten Buchung oder direkt vor Ort vorzeigen – wir buchen den Rabatt automatisch ab.</p>

<div style="border-top:1px solid #e2e8f0;margin:26px 0 18px;"></div>
<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
  Wir freuen uns, dich bald wieder am Wasser zu sehen.<br/>
  <strong style="color:#0f172a;">Dein {{accountName}}-Team</strong>
</p>`,
      createVoucher: true,
      voucherDiscountPercent: 15,
      voucherValidDays: 60,
      voucherTicketTypeName: "Abo-Wiedereinstieg",
      renewUrl: "https://www.tuttenbrocksee.com",
    },
  },
  {
    id: "tagesgast-followup-2",
    label: "Tagesgast-Followup mit 10% Voucher",
    description:
      "Bedankt sich 2 Tage nach dem Besuch, fragt nach dem Erlebnis und liefert einen Folgebesuch-Voucher.",
    defaults: {
      name: "Tagesgast-Followup 2 Tage später",
      trigger: "DAY_VISIT_FOLLOWUP",
      daysOffset: 2,
      cooldownDays: 60,
      subject: "Schön war's, {{firstName}} – dein Bonus für den nächsten Besuch",
      bodyHtml: `<div style="font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#0891b2;margin-bottom:6px;">Danke für deinen Besuch</div>
<h1 style="margin:0 0 18px;font-size:26px;font-weight:800;line-height:1.2;color:#0f172a;">Du warst vor {{daysSinceVisit}} Tagen am See, {{firstName}}.</h1>

<p style="margin:0 0 14px;color:#334155;">Wir hoffen, du hattest eine richtig gute Zeit am Tuttenbrocksee – ob Strandtag, Action im Aquapark oder eine Runde Wakeboarden. Damit der nächste Besuch direkt feststeht, hast du hier deinen Bonus.</p>

${VOUCHER_BOX}

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 26px;">
  <tr>
    <td style="background:#f0fdfa;border-left:3px solid #0d9488;border-radius:8px;padding:14px 16px;">
      <div style="font-size:12px;font-weight:600;color:#115e59;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">Tipp für den nächsten Besuch</div>
      <div style="color:#0f172a;font-size:14.5px;line-height:1.5;">Buche dein Online-Ticket vorab – an Sonnentagen sparst du dir damit die Wartezeit am Eingang.</div>
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
  <tr><td align="center"><a href="{{renewUrl}}" style="${STYLE_CTA_AMBER}">Nächsten Besuch planen</a></td></tr>
</table>

<p style="margin:0 0 6px;color:#64748b;font-size:13.5px;">Code einfach an der Kasse vorzeigen oder bei der Online-Buchung eingeben.</p>

<div style="border-top:1px solid #e2e8f0;margin:26px 0 18px;"></div>
<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
  Bis hoffentlich bald wieder.<br/>
  <strong style="color:#0f172a;">Dein {{accountName}}-Team</strong>
</p>`,
      createVoucher: true,
      voucherDiscountPercent: 10,
      voucherValidDays: 60,
      voucherTicketTypeName: "Folgebesuch-Rabatt",
      renewUrl: "https://www.tuttenbrocksee.com",
    },
  },
  {
    id: "welcome-1",
    label: "Welcome-Mail nach 1 Tag",
    description:
      "Begrüßt neue Mitglieder einen Tag nach Ticket-Erstellung mit Tipps und Highlights für den ersten Besuch.",
    defaults: {
      name: "Welcome-Mail 1 Tag nach Anlage",
      trigger: "TICKET_WELCOME",
      daysOffset: 1,
      cooldownDays: 365,
      subject: "Willkommen am See, {{firstName}}",
      bodyHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
  <tr><td style="${HERO_GRADIENT_SUNSET}border-radius:14px;padding:30px 20px;text-align:center;color:#ffffff;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;">Willkommen am</div>
    <div style="font-size:30px;font-weight:800;line-height:1.15;margin:6px 0 4px;">Tuttenbrocksee</div>
    <div style="font-size:13.5px;opacity:0.92;">Strandbad · Aquapark · Wake &amp; Ski · SUP</div>
  </td></tr>
</table>

<h1 style="margin:0 0 14px;font-size:24px;font-weight:800;line-height:1.25;color:#0f172a;">Hey {{firstName}}, schön dass du dabei bist!</h1>

<p style="margin:0 0 18px;color:#334155;">Dein Ticket <strong>{{ticketTypeName}}</strong> ist seit gestern aktiv und wartet auf den ersten Scan. Hier kommt das Wichtigste für deinen Besuch in Kürze.</p>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td style="border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;background:#ffffff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;color:#0891b2;text-transform:uppercase;margin-bottom:8px;">So läuft dein Einlass</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="vertical-align:top;width:32px;padding:6px 10px 6px 0;"><div style="width:24px;height:24px;border-radius:50%;background:#0891b2;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:24px;">1</div></td>
          <td style="vertical-align:top;padding:8px 0;color:#334155;font-size:14.5px;line-height:1.5;">QR-Code aus dem Ticket einfach am Smartphone bereit halten.</td>
        </tr>
        <tr>
          <td style="vertical-align:top;width:32px;padding:6px 10px 6px 0;"><div style="width:24px;height:24px;border-radius:50%;background:#0891b2;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:24px;">2</div></td>
          <td style="vertical-align:top;padding:8px 0;color:#334155;font-size:14.5px;line-height:1.5;">Am Eingang scannen lassen – fertig. Kein Ausdruck nötig.</td>
        </tr>
        <tr>
          <td style="vertical-align:top;width:32px;padding:6px 10px 6px 0;"><div style="width:24px;height:24px;border-radius:50%;background:#0891b2;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:24px;">3</div></td>
          <td style="vertical-align:top;padding:8px 0;color:#334155;font-size:14.5px;line-height:1.5;">Strandkorb, Liegewiese, Wasser – sucht euch ein Plätzchen und genießt.</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0e7490;letter-spacing:0.04em;text-transform:uppercase;">Highlights, die du bei uns erleben kannst</p>
${ACTIVITY_CHIPS}

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
  <tr><td align="center"><a href="{{renewUrl}}" style="${STYLE_CTA_PRIMARY}">Mehr am See entdecken</a></td></tr>
</table>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 0;">
  <tr><td style="background:#f1f5f9;border-radius:10px;padding:14px 16px;color:#475569;font-size:13.5px;line-height:1.5;">
    <strong style="color:#0f172a;">Frage offen?</strong> Antworte einfach direkt auf diese Mail – wir helfen schnell weiter.
  </td></tr>
</table>

<div style="border-top:1px solid #e2e8f0;margin:26px 0 18px;"></div>
<p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
  Bis bald am Wasser!<br/>
  <strong style="color:#0f172a;">Dein {{accountName}}-Team</strong>
</p>`,
      createVoucher: false,
      renewUrl: "https://www.tuttenbrocksee.com",
    },
  },
];
