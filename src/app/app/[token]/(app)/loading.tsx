/** Platzhalter, solange eine noch nicht vorab geladene Seite der Kunden-App kommt: sofort sichtbar statt Stillstand. */
export default function RiderLoading() {
  return (
    <div className="rd-skel-wrap" role="status" aria-label="Lädt">
      <div className="rd-skel" style={{ height: 40, width: "55%" }} />
      <div className="rd-skel" style={{ height: 96 }} />
      <div className="rd-skel" style={{ height: 72 }} />
      <div className="rd-skel" style={{ height: 72 }} />
    </div>
  );
}
