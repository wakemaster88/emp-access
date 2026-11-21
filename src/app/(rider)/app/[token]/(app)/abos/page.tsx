import { riderBase } from "@/lib/rider-base";
import Link from "next/link";
import { requireRider } from "@/lib/rider-auth";
import { fmtDay } from "@/lib/rider-format";
import { aboStatus, daysLeftText, RIDER_LOCATION } from "@/lib/rider-shop";
import { RiderAboShop } from "@/components/rider/rider-abo-shop";

export const dynamic = "force-dynamic";

/** Abos buchen oder verlängern: der anny-Shop direkt in der App. */
export default async function RiderAbos({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const status = aboStatus(rider.abo);

  const intro =
    status.kind === "none"
      ? `Du hast noch kein Abo am ${RIDER_LOCATION}. Such dir hier eins aus und buch es direkt.`
      : status.kind === "paymentOpen"
        ? `${rider.abo?.name} ist pausiert: ${status.text} Bitte bezahl die Rechnung in deinem anny-Konto, dann ist es wieder aktiv.`
      : status.kind === "expired"
        ? `${rider.abo?.name} ist nicht mehr gültig${status.endDate ? ` (bis ${fmtDay(status.endDate)})` : ""}. Hier buchst du dein neues Abo.`
        : status.kind === "active"
          ? `${rider.abo?.name} gilt ${daysLeftText(status.daysLeft)}, bis ${fmtDay(status.endDate)}. Hier kannst du schon jetzt verlängern.`
          : `${rider.abo?.name} gilt ohne Ablaufdatum.`;

  return (
    <>
      <Link href={(await riderBase(token))} style={{ fontSize: 13, textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
        Zurück zum Start
      </Link>
      <h1 className="rd-display rd-h1">Abos</h1>
      <p className="rd-soft" style={{ margin: 0 }}>{intro}</p>
      <RiderAboShop />
      <p className="rd-muted" style={{ margin: 0, fontSize: 12 }}>
        Buchung und Bezahlung laufen über anny. Nach der Buchung zeigt dir die App dein neues Abo, sobald es bei uns angekommen ist.
      </p>
    </>
  );
}
