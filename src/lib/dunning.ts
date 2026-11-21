/**
 * Mahnlauf für offene Abo-Zahlungen (Aaron, 21.11.2026: vollautomatisch).
 *
 * Grundlage ist „Zahlung offen“ (lib/payment-open): Der anny-Abgleich pausiert
 * ein Abo bei überfälliger Rechnung und legt `extras.paymentPause` an. Jeden
 * Morgen (Cron `/api/cron/dunning`) prüft der Lauf je pausiertem Abo die
 * nächste Stufe:
 *
 * 1. Zahlungserinnerung: DUNNING_REMINDER_DAYS Tage nach Beginn der Pause.
 *    anny verschickt sie (`POST /invoices/{id}/send-payment-reminder`); klappt
 *    das nicht, geht eine eigene Erinnerungsmail.
 * 2. 1. Mahnung: DUNNING_STEP_DAYS Tage nach der Erinnerung, eigene Mail mit
 *    Frist DUNNING_STEP_DAYS Tage.
 * 3. Letzte Mahnung: DUNNING_STEP_DAYS Tage nach der 1. Mahnung, eigene Mail
 *    mit Frist DUNNING_FINAL_DAYS Tage und Hinweis auf Inkasso.
 * 4. Bereit für Inkasso: nach Ablauf dieser Frist, ohne Mail. Hier setzt die
 *    spätere Übergabe an ein Inkassobüro an.
 *
 * Die Stufen laufen immer nacheinander, auch bei alten Schulden: Der erste Lauf
 * schickt also höchstens Erinnerungen. Keine Mahngebühr, kein erneutes Abbuchen.
 *
 * Der Stand liegt in `extras.paymentPause.dunning`. Der Abgleich trägt ihn mit,
 * solange die Pause besteht; ist bezahlt, fällt der Vermerk samt Mahnstand weg
 * (Abgleich oder Webhook `invoices.updated`), der Mahnlauf endet damit.
 *
 * Schalter: `ApiConfig(ANNY).extraConfig.dunning.enabled`, Standard an.
 */
import type { PrismaClient } from "@prisma/client";
import { addCalendarDays, berlinHour, berlinYmd } from "./berlin-day";
import { sendEmail } from "./email-sender";
import { formatMoney, openAmount, paymentOpenInfo } from "./payment-open";
import { dunningMail } from "./dunning-mail";
import {
  DUNNING_FINAL_DAYS, DUNNING_STAGE_LABEL, DUNNING_STEP_DAYS, applyDunningStage, dueDunningStage,
  dunningStart, dunningState, dunningStuck, failDunningStage, parseDunningConfig, type DunningStage, type DunningState,
} from "./dunning-state";

export * from "./dunning-state";

/** Höchstens so viele Mails je Lauf und Konto. */
export const DUNNING_MAX_PER_RUN = 30;
/** Kunden-Mails nur in dieser Zeit (Berlin). */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 20;

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

export interface DunningRunResult {
  accountId: number;
  skipped?: string;
  checked: number;
  sent: Partial<Record<DunningStage, number>>;
  viaAnny: number;
  failed: number;
  noEmail: number;
}

type AnnyRemind = (invoiceId: string) => Promise<{ ok: boolean; error?: string }>;

interface RunDeps {
  send?: typeof sendEmail;
  /** Erinnerung über anny; Standard: echter API-Aufruf. */
  annyRemind?: AnnyRemind | null;
}

function annyReminder(baseUrl: string | null, token: string): AnnyRemind {
  const base = (baseUrl?.replace(/\/+$/, "") || "https://b.anny.co");
  return async (invoiceId) => {
    try {
      const res = await fetch(`${base}/api/v1/invoices/${encodeURIComponent(invoiceId)}/send-payment-reminder`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true };
      const body = await res.text().catch(() => "");
      return { ok: false, error: `anny ${res.status} ${body.slice(0, 120)}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

function personName(t: { firstName: string | null; lastName: string | null; name: string }): string {
  return [t.firstName, t.lastName].filter((v) => v?.trim()).join(" ").trim() || t.name;
}

/**
 * Mahnlauf für ein Konto. Schickt je Abo höchstens eine Stufe und schreibt den
 * Stand sofort zurück, damit ein abgebrochener Lauf nichts doppelt schickt.
 */
export async function runDunningForAccount(
  db: PrismaClient,
  accountId: number,
  now: Date = new Date(),
  deps: RunDeps = {},
): Promise<DunningRunResult> {
  const result: DunningRunResult = { accountId, checked: 0, sent: {}, viaAnny: 0, failed: 0, noEmail: 0 };
  const hour = berlinHour(now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return { ...result, skipped: "außerhalb 9–20 Uhr" };

  const [anny, account, mail] = await Promise.all([
    db.apiConfig.findFirst({ where: { accountId, provider: "ANNY" }, select: { token: true, baseUrl: true, extraConfig: true } }),
    db.account.findUnique({ where: { id: accountId }, select: { name: true, isActive: true } }),
    db.emailConfig.findUnique({ where: { accountId } }),
  ]);
  if (!anny) return { ...result, skipped: "anny nicht eingerichtet" };
  if (!account?.isActive) return { ...result, skipped: "Konto inaktiv" };
  if (!parseDunningConfig(anny.extraConfig).enabled) return { ...result, skipped: "Mahnlauf ausgeschaltet" };
  if (!mail?.isActive || !mail.apiKey) return { ...result, skipped: "Mailversand nicht eingerichtet" };

  const send = deps.send ?? sendEmail;
  const remind = deps.annyRemind === undefined ? (anny.token ? annyReminder(anny.baseUrl, anny.token) : null) : deps.annyRemind;

  const tickets = await db.ticket.findMany({
    where: { accountId, status: "PAUSED", subscriptionId: { not: null } },
    select: {
      id: true, name: true, firstName: true, lastName: true, email: true,
      ticketTypeName: true, extras: true, subscription: { select: { name: true } },
    },
    orderBy: { id: "asc" },
    take: 2000,
  });

  let mails = 0;
  for (const t of tickets) {
    const info = paymentOpenInfo(t.extras);
    if (!info) continue;
    result.checked++;
    const state = dunningState(t.extras);
    const stage = dueDunningStage(dunningStart(info), state, now);
    if (!stage || dunningStuck(state, stage)) continue;

    let next: DunningState;
    if (stage === "collection") {
      next = applyDunningStage(state, stage, now);
    } else {
      const email = t.email?.trim().toLowerCase() || null;
      // Erinnerung zuerst über anny (anny kennt Zahlungslink und Adresse).
      let viaAnny = false;
      if (stage === "reminder" && remind && info.invoiceId) {
        const r = await remind(info.invoiceId);
        viaAnny = r.ok;
        if (!r.ok) console.warn(`[dunning] account=${accountId} Ticket ${t.id}: anny-Erinnerung fehlgeschlagen (${r.error ?? "?"}), eigene Mail`);
      }
      if (viaAnny) {
        next = applyDunningStage(state, stage, now, "anny");
        result.viaAnny++;
        if (email) await logSend(db, accountId, t.id, email, "Zahlungserinnerung (über anny)", true);
      } else if (!email) {
        result.noEmail++;
        next = failDunningStage(state, stage, "Keine E-Mail-Adresse am Abo");
      } else {
        if (mails >= DUNNING_MAX_PER_RUN) {
          console.warn(`[dunning] account=${accountId} Obergrenze ${DUNNING_MAX_PER_RUN} Mails je Lauf erreicht, Rest morgen`);
          break;
        }
        mails++;
        const content = dunningMail({
          stage,
          accountName: account.name,
          firstName: t.firstName,
          person: personName(t),
          aboName: t.ticketTypeName ?? t.subscription?.name ?? null,
          amount: formatMoney(openAmount(info), info.currency),
          invoiceNumber: info.invoiceNumber,
          dueDate: info.dueDate,
          deadline: stage === "first"
            ? addCalendarDays(berlinYmd(now), DUNNING_STEP_DAYS)
            : stage === "final" ? addCalendarDays(berlinYmd(now), DUNNING_FINAL_DAYS) : null,
          brandColor: mail.brandColor,
          logoUrl: mail.logoUrl,
          websiteUrl: mail.websiteUrl,
        });
        const r = await send({ config: mail, to: email, subject: content.subject, html: content.html, text: content.text });
        await logSend(db, accountId, t.id, email, content.subject, r.ok, r.error);
        next = r.ok ? applyDunningStage(state, stage, now, "mail") : failDunningStage(state, stage, r.error ?? "Versand fehlgeschlagen");
        if (!r.ok) console.error(`[dunning] account=${accountId} Ticket ${t.id}: ${DUNNING_STAGE_LABEL[stage]} nicht verschickt: ${r.error ?? "?"}`);
      }
      if (next.failedStage) result.failed++;
      else result.sent[stage] = (result.sent[stage] ?? 0) + 1;
    }
    if (stage === "collection") result.sent.collection = (result.sent.collection ?? 0) + 1;
    await saveDunning(db, t.id, t.extras, next);
  }
  return result;
}

async function logSend(db: PrismaClient, accountId: number, ticketId: number, to: string, subject: string, ok: boolean, error?: string) {
  await db.emailSend
    .create({
      data: {
        accountId, ticketId, to, subject,
        status: ok ? "SENT" : "FAILED",
        errorMessage: ok ? null : (error ?? "Unbekannter Fehler").slice(0, 500),
      },
    })
    .catch(() => null);
}

/** Schreibt den Mahnstand in `extras.paymentPause.dunning`, alles andere bleibt. */
export function withDunning(extras: unknown, d: DunningState): Record<string, unknown> {
  const base = (extras && typeof extras === "object" && !Array.isArray(extras) ? extras : {}) as Record<string, unknown>;
  const pay = (base.paymentPause && typeof base.paymentPause === "object" ? base.paymentPause : {}) as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== undefined) clean[k] = v;
  return { ...base, paymentPause: { ...pay, dunning: clean } };
}

async function saveDunning(db: PrismaClient, ticketId: number, extras: unknown, d: DunningState) {
  await db.ticket.update({ where: { id: ticketId }, data: { extras: withDunning(extras, d) as object } });
}
