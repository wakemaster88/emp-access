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

/** Wickelt den vom Tenant erstellten HTML-Body in einen schlichten Mail-Wrapper. */
export function wrapEmailHtml(args: {
  innerHtml: string;
  brandColor?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  accountName?: string | null;
  preheader?: string | null;
}): string {
  const brand = args.brandColor || "#4F46E5";
  const acc = escapeHtml(args.accountName || "EMP Access");
  const preheader = args.preheader ? escapeHtml(args.preheader) : "";
  const logo = args.logoUrl
    ? `<img src="${escapeHtml(args.logoUrl)}" alt="${acc}" style="max-height:48px;display:block;margin:0 auto 12px;" />`
    : "";
  const footer = args.websiteUrl
    ? `<a href="${escapeHtml(args.websiteUrl)}" style="color:${brand};text-decoration:none;">${escapeHtml(args.websiteUrl)}</a>`
    : "";

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${acc}</title>
</head>
<body style="margin:0;padding:24px 0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0f172a;">
<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;max-width:560px;">
  <tr><td style="background:${brand};border-radius:12px 12px 0 0;padding:20px;text-align:center;">
    ${logo}
    <div style="color:#ffffff;font-weight:600;font-size:14px;letter-spacing:0.04em;text-transform:uppercase;">${acc}</div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:28px 28px 24px 28px;font-size:15px;line-height:1.55;">
    ${args.innerHtml}
  </td></tr>
  <tr><td style="background:#f8fafc;border-radius:0 0 12px 12px;padding:16px 24px;font-size:12px;color:#64748b;text-align:center;">
    ${footer ? `${footer}<br/>` : ""}
    <span style="color:#94a3b8;">Diese Mail wurde automatisch von ${acc} versendet.</span>
  </td></tr>
</table>
</body></html>`;
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

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: "abo-expiring-7",
    label: "Abo läuft in 7 Tagen aus",
    description:
      "Erinnert Mitglieder 7 Tage vor Ablauf ihres Abos – mit Link zur Verlängerung.",
    defaults: {
      name: "Abo-Erinnerung 7 Tage vor Ablauf",
      trigger: "SUBSCRIPTION_EXPIRING",
      daysOffset: 7,
      cooldownDays: 30,
      subject: "Dein Abo läuft bald ab – {{accountName}}",
      bodyHtml: `<p>Hallo {{firstName}},</p>
<p>dein Abo <strong>{{subscriptionName}}</strong> bei {{accountName}} läuft am <strong>{{endDate}}</strong> aus – also in nur {{daysUntilExpiry}} Tagen.</p>
<p>Damit du ohne Unterbrechung weiter Zutritt hast, kannst du dein Abo direkt online verlängern:</p>
<p style="text-align:center;margin:24px 0;">
  <a href="{{renewUrl}}" style="background:#4F46E5;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Jetzt verlängern</a>
</p>
<p>Wir freuen uns, dich weiter bei uns zu sehen.</p>
<p>Sportliche Grüße,<br/>dein {{accountName}}-Team</p>`,
      createVoucher: false,
      renewUrl: "https://example.com/abo-verlaengern",
    },
  },
  {
    id: "abo-expired-3",
    label: "Win-Back: 3 Tage nach Aboablauf",
    description:
      "Reaktiviert ehemalige Mitglieder mit kleinem Wiedereinstiegs-Rabatt.",
    defaults: {
      name: "Win-Back 3 Tage nach Aboablauf",
      trigger: "SUBSCRIPTION_EXPIRED",
      daysOffset: 3,
      cooldownDays: 90,
      subject: "Wir vermissen dich, {{firstName}}",
      bodyHtml: `<p>Hallo {{firstName}},</p>
<p>dein Abo bei {{accountName}} ist seit ein paar Tagen abgelaufen – wir würden uns freuen, dich bald wiederzusehen.</p>
<p>Als kleines Dankeschön schenken wir dir <strong>{{voucherDiscountPercent}}% Rabatt</strong> auf deine nächste Verlängerung.</p>
<p style="text-align:center;margin:24px 0;background:#f1f5f9;border-radius:12px;padding:18px;">
  <span style="font-size:13px;color:#64748b;display:block;margin-bottom:6px;">Dein Code (gültig bis {{voucherExpiresAt}})</span>
  <strong style="font-family:ui-monospace,monospace;font-size:18px;letter-spacing:0.08em;">{{voucherCode}}</strong>
</p>
<p>Wir freuen uns auf dich!<br/>Dein {{accountName}}-Team</p>`,
      createVoucher: true,
      voucherDiscountPercent: 15,
      voucherValidDays: 60,
      voucherTicketTypeName: "Abo-Wiedereinstieg",
    },
  },
  {
    id: "tagesgast-followup-2",
    label: "Tagesgast-Followup mit 10% Voucher",
    description:
      "Bedankt sich 2 Tage nach dem Besuch und liefert einen 10%-Gutscheincode für den nächsten Besuch.",
    defaults: {
      name: "Tagesgast-Followup 2 Tage später",
      trigger: "DAY_VISIT_FOLLOWUP",
      daysOffset: 2,
      cooldownDays: 60,
      subject: "Wie hat es dir bei {{accountName}} gefallen?",
      bodyHtml: `<p>Hallo {{firstName}},</p>
<p>danke für deinen Besuch bei {{accountName}} vor {{daysSinceVisit}} Tagen – wir hoffen, du hattest eine richtig gute Zeit.</p>
<p>Damit der nächste Besuch noch reizvoller wird, schenken wir dir <strong>{{voucherDiscountPercent}}% Rabatt</strong> auf dein nächstes Tagesticket:</p>
<p style="text-align:center;margin:24px 0;background:#f1f5f9;border-radius:12px;padding:18px;">
  <span style="font-size:13px;color:#64748b;display:block;margin-bottom:6px;">Dein Code (gültig bis {{voucherExpiresAt}})</span>
  <strong style="font-family:ui-monospace,monospace;font-size:18px;letter-spacing:0.08em;">{{voucherCode}}</strong>
</p>
<p>Einfach beim nächsten Besuch an der Kasse vorzeigen.</p>
<p>Bis bald!<br/>Dein {{accountName}}-Team</p>`,
      createVoucher: true,
      voucherDiscountPercent: 10,
      voucherValidDays: 60,
      voucherTicketTypeName: "Folgebesuch-Rabatt",
    },
  },
  {
    id: "welcome-1",
    label: "Welcome-Mail nach 1 Tag",
    description:
      "Schickt 1 Tag nach Ticket-Erstellung eine Begrüßungsmail mit Hinweisen.",
    defaults: {
      name: "Welcome-Mail 1 Tag nach Anlage",
      trigger: "TICKET_WELCOME",
      daysOffset: 1,
      cooldownDays: 365,
      subject: "Willkommen bei {{accountName}}",
      bodyHtml: `<p>Hallo {{firstName}},</p>
<p>schön, dass du jetzt Teil von {{accountName}} bist. Dein Ticket ist seit gestern aktiv und freut sich auf den ersten Scan.</p>
<p>Falls du Fragen hast, antworte einfach direkt auf diese Mail.</p>
<p>Bis bald!<br/>Dein {{accountName}}-Team</p>`,
      createVoucher: false,
    },
  },
];
