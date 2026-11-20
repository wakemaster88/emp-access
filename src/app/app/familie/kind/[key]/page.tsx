import Link from "next/link";
import { familyChildInfo } from "@/lib/rider-family-link";
import { RiderFamilyConfirm } from "@/components/rider/rider-family";

export const dynamic = "force-dynamic";

/**
 * Link aus der Mail „Familie in der App bestätigen“: eine Erwachsene möchte
 * die Abos dieser Adresse in ihre Familie holen.
 */
export default async function RiderFamilyChildPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const confirmKey = decodeURIComponent(key);
  const info = await familyChildInfo(confirmKey);
  const open = info?.persons.filter((p) => !p.joined) ?? [];

  return (
    <main className="rd-main">
      <p className="rd-label">Familie</p>
      <h1 className="rd-display rd-h1">Bestätigen</h1>
      {!info ? (
        <>
          <div className="rd-msg rd-msg-err" role="alert">
            Dieser Link gilt nicht mehr. Bitte lass dir einen neuen schicken.
          </div>
          <Link href="/app" className="rd-btn rd-btn-ghost rd-btn-wide"><span>Zur App</span></Link>
        </>
      ) : open.length === 0 ? (
        <>
          <p className="rd-soft" style={{ margin: 0 }}>
            {info.persons.length > 0
              ? `Das ist schon erledigt: das Abo gehört zur Familie von ${info.inviterName}.`
              : "Hier gibt es nichts mehr zu bestätigen. Vielleicht gehört das Abo schon zu einer anderen Familie."}
          </p>
          <Link href="/app" className="rd-btn rd-btn-ghost rd-btn-wide"><span>Zur App</span></Link>
        </>
      ) : (
        <>
          <p className="rd-soft" style={{ margin: 0 }}>
            {info.inviterName} möchte diese Abos in der App zur Familie holen. {info.inviterName} sieht dann Abo, Besuchstage und
            Gutscheine und kümmert sich darum. Gezählt wird weiter für jede Person einzeln.
          </p>
          <RiderFamilyConfirm confirmKey={confirmKey} persons={info.persons} inviterName={info.inviterName} />
        </>
      )}
    </main>
  );
}
