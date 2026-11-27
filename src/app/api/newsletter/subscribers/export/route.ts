import { NextResponse } from "next/server";
import { csvTextCell } from "@/lib/csv-cell";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { SUBSCRIBER_STATUS_LABEL, type SubscriberStatus } from "@/lib/newsletter/rules";

/**
 * Alle Abonnenten als CSV, mit Nachweis der Einwilligung (Zeitpunkt und IP
 * der Anmeldung, Zeitpunkt und IP der Bestätigung, Wortlaut).
 */
export async function GET() {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const rows = await auth.db.newsletterSubscriber.findMany({
    where: { accountId: auth.accountId },
    orderBy: { id: "asc" },
    include: { groups: { select: { group: { select: { name: true } } } } },
  });
  const iso = (d: Date | null) => (d ? d.toISOString() : "");
  const head = ["E-Mail", "Name", "Status", "Quelle", "Gruppen", "Angemeldet am", "IP Anmeldung", "Bestätigt am", "IP Bestätigung", "Abgemeldet am", "Grund", "Einwilligungstext"];
  const lines = rows.map((r) =>
    [
      r.email,
      r.name ?? "",
      SUBSCRIBER_STATUS_LABEL[r.status as SubscriberStatus] ?? r.status,
      r.source,
      r.groups.map((g) => g.group.name).sort().join(", "),
      iso(r.consentAt),
      r.consentIp ?? "",
      iso(r.confirmedAt),
      r.confirmIp ?? "",
      iso(r.unsubscribedAt),
      r.unsubscribeReason ?? "",
      r.consentText ?? "",
    ]
      .map(csvTextCell)
      .join(";"),
  );
  const csv = "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="newsletter-abonnenten.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
