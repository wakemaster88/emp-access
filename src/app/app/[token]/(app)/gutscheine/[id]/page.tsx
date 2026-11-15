import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { riderAppPath } from "@/lib/rider-app";
import { requireRider } from "@/lib/rider-auth";
import { fmtDay } from "@/lib/rider-format";

export const dynamic = "force-dynamic";

/** Ein Gutschein mit QR-Code zum Vorzeigen an der Kasse. */
export default async function RiderVoucher({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const rider = await requireRider(token);
  const voucher = rider.vouchers.find((v) => v.id === Number(id));
  if (!voucher) notFound();
  const open = voucher.state === "open";
  const svg = open
    ? await QRCode.toString(voucher.code, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1b1c20", light: "#ffffff" } })
    : null;

  return (
    <>
      <Link href={`${riderAppPath(token)}/gutscheine`} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 6, textDecoration: "none", fontWeight: 500 }}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        Zurück
      </Link>
      <div className="rd-card rd-center" style={{ padding: "24px 20px", gap: 12 }}>
        {voucher.source && <div className="rd-label">{voucher.source}</div>}
        <div className="rd-display" style={{ fontSize: 36 }}>{voucher.label}</div>
        {svg && (
          <div className="rd-qr" role="img" aria-label={`QR-Code des Gutscheins ${voucher.code}`} dangerouslySetInnerHTML={{ __html: svg }} />
        )}
        <div className="rd-code">{voucher.code}</div>
        <div className="rd-row" style={{ gap: 8 }}>
          <span className={`rd-pill ${open ? "rd-pill-open" : "rd-pill-off"}`}>
            {open ? "offen" : voucher.state === "redeemed" ? "eingelöst" : "abgelaufen"}
          </span>
          <span className="rd-muted">
            {voucher.state === "redeemed"
              ? `am ${fmtDay(voucher.redeemedAt)}`
              : voucher.expiresAt
                ? `gültig bis ${fmtDay(voucher.expiresAt)}`
                : "ohne Ablauf"}
          </span>
        </div>
      </div>
      {open && (
        <div className="rd-card">
          <b>So löst du ihn ein</b>
          <div className="rd-soft">Zeig den Code an der Kasse. Das Personal scannt ihn, danach ist er entwertet und gilt nicht noch einmal.</div>
        </div>
      )}
    </>
  );
}
