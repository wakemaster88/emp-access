/**
 * Rendert die Tuttenbrocksee-Email-Templates (abo-expiring-7, abo-expired-3,
 * tagesgast-followup-2, welcome-1) in eine HTML-Datei zur visuellen Pruefung.
 *
 * Nutzung: `npx tsx scripts/preview-email-template.ts`
 * Ergebnis: `tmp/email-preview.html`
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  PRESET_TEMPLATES,
  buildSampleTemplateVariables,
  computeExpiryStatus,
  renderTemplate,
  wrapEmailHtml,
} from "../src/lib/email-templates";

const ACCOUNT_NAME = "Tuttenbrocksee";
const BRAND_COLOR = "#236770";
const WEBSITE_URL = "https://www.tuttenbrocksee.com";

interface RenderInput {
  id: string;
  presetId: string;
  daysOffsetOverride?: number;
  expiryDaysOverride?: number;
}

function renderPreset(input: RenderInput): { id: string; subject: string; html: string } {
  const preset = PRESET_TEMPLATES.find((p) => p.id === input.presetId);
  if (!preset) throw new Error(`Preset not found: ${input.presetId}`);

  const offset = input.daysOffsetOverride ?? preset.defaults.daysOffset;
  const vars = buildSampleTemplateVariables({
    trigger: preset.defaults.trigger,
    daysOffset: offset,
    createVoucher: preset.defaults.createVoucher,
    voucherDiscountPercent: preset.defaults.voucherDiscountPercent ?? null,
    voucherValidDays: preset.defaults.voucherValidDays ?? null,
    renewUrl: preset.defaults.renewUrl ?? null,
    accountName: ACCOUNT_NAME,
    brandColor: BRAND_COLOR,
    websiteUrl: WEBSITE_URL,
  });

  // Edge-Case-Override: simuliere "heute" oder "bereits abgelaufen", um die
  // dynamischen expiry-Status-Variablen visuell zu pruefen.
  if (input.expiryDaysOverride !== undefined && preset.defaults.trigger === "SUBSCRIPTION_EXPIRING") {
    const today = new Date();
    const endDate = new Date(today.getTime() + input.expiryDaysOverride * 86_400_000);
    const fmt = endDate.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    const expiry = computeExpiryStatus({
      rawDaysUntilExpiry: input.expiryDaysOverride,
      formattedEndDate: fmt,
    });
    vars.endDate = fmt;
    vars.daysUntilExpiry = String(Math.max(0, input.expiryDaysOverride));
    vars.expiryStatLabel = expiry.statLabel;
    vars.expiryStatValue = expiry.statValue;
    vars.expiryStatSublabel = expiry.statSublabel;
    vars.expiryHeadline = expiry.headline;
  }

  const subject = renderTemplate(preset.defaults.subject, vars);
  const inner = renderTemplate(preset.defaults.bodyHtml, vars);
  const html = wrapEmailHtml({
    innerHtml: inner,
    brandColor: BRAND_COLOR,
    accountName: ACCOUNT_NAME,
    websiteUrl: WEBSITE_URL,
    preheader: subject,
  });

  return { id: input.id, subject, html };
}

const renders: { id: string; subject: string; html: string }[] = [
  ...PRESET_TEMPLATES.map((p) => renderPreset({ id: p.id, presetId: p.id })),
  renderPreset({ id: "abo-expiring-7-today", presetId: "abo-expiring-7", expiryDaysOverride: 0 }),
  renderPreset({ id: "abo-expiring-7-overdue", presetId: "abo-expiring-7", expiryDaysOverride: -3 }),
];

const outDir = join(process.cwd(), "tmp");
mkdirSync(outDir, { recursive: true });

for (const r of renders) {
  const filePath = join(outDir, `email-preview-${r.id}.html`);
  writeFileSync(filePath, r.html);
  console.log(`- ${r.id}: ${filePath}`);
}

const indexHtml = `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<title>Email-Preview – Tuttenbrocksee CI</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#0f0f10; color:#fbf8f1; padding:32px; }
  h1 { margin:0 0 18px; font-size:18px; font-weight:600; }
  ul { list-style:none; margin:0; padding:0; }
  li { margin:0 0 12px; }
  a { color:#e8ae2a; text-decoration:none; font-weight:600; }
  a:hover { text-decoration:underline; }
  .subj { color:#c4c2bd; font-weight:400; margin-left:8px; }
</style></head>
<body>
<h1>Email-Preview – Tuttenbrocksee CI (4 Vorlagen)</h1>
<ul>
${renders.map((r) => `  <li><a href="email-preview-${r.id}.html">${r.id}</a><span class="subj">${r.subject}</span></li>`).join("\n")}
</ul>
</body></html>`;

writeFileSync(join(outDir, "email-preview.html"), indexHtml);
console.log(`Index: ${join(outDir, "email-preview.html")}`);
