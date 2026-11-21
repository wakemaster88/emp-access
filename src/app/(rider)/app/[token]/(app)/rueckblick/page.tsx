import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRiderRecap, riderAppPath } from "@/lib/rider-app";
import { requireRider } from "@/lib/rider-auth";
import { formatDegrees, tempStatNote, ymdToDbDate } from "@/lib/gamification";
import { fmtDay } from "@/lib/rider-format";

export const dynamic = "force-dynamic";

/** Saisonrückblick: die Saison in Zahlen, für das laufende oder das vergangene Jahr (`?jahr=`). */
export default async function RiderRecapPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ jahr?: string }>;
}) {
  const { token } = await params;
  const rider = await requireRider(token);
  const base = riderAppPath(token);
  const wanted = Number((await searchParams).jahr);
  const data = await loadRiderRecap(rider, wanted === rider.year - 1 ? wanted : rider.year);
  if (!data) notFound();
  const { recap, year } = data;
  const other = year === rider.year ? rider.year - 1 : rider.year;
  const level = year === rider.year ? rider.level : null;

  return (
    <>
      <div className="rd-recap">
        <div className="rd-recap-eyebrow">Deine Saison {year}</div>
        <div className="rd-display rd-recap-num">{recap.visitDays}</div>
        <div className="rd-recap-unit">{recap.visitDays === 1 ? "Tag auf dem Wasser" : "Tage auf dem Wasser"}</div>
        {data.aheadOf != null && data.aheadOf >= 50 && (
          <div>Damit warst du öfter da als {data.aheadOf} % der Abo-Fahrer.</div>
        )}
        {recap.firstDay && recap.lastDay && recap.firstDay !== recap.lastDay && (
          <div>Vom {fmtDay(ymdToDbDate(recap.firstDay))} bis {fmtDay(ymdToDbDate(recap.lastDay))}.</div>
        )}
      </div>

      {recap.visitDays === 0 ? (
        <div className="rd-card rd-muted">
          {year === rider.year
            ? `In ${year} ist noch kein Besuchstag gezählt. Sobald du am Drehkreuz startest, füllt sich dein Rückblick.`
            : `In ${year} ist für dich kein Besuchstag gezählt.`}
        </div>
      ) : (
        <div className="rd-recap-grid">
          <div className="rd-stat">
            <div className="rd-display">{recap.starts}</div>
            <b>Starts</b>
            {recap.bestDay && (
              <div className="rd-muted">Rekord: {recap.bestDay.starts} am {fmtDay(ymdToDbDate(recap.bestDay.day)).slice(0, 6)}</div>
            )}
          </div>
          <div className="rd-stat">
            <div className="rd-display">{recap.streakWeeks}</div>
            <b>{recap.streakWeeks === 1 ? "Woche am Stück" : "Wochen am Stück"}</b>
            <div className="rd-muted">deine längste Serie</div>
          </div>
          {recap.bestMonth && (
            <div className="rd-stat">
              <div className="rd-display rd-recap-word">{recap.bestMonth.name}</div>
              <b>Stärkster Monat</b>
              <div className="rd-muted">{recap.bestMonth.visitDays} {recap.bestMonth.visitDays === 1 ? "Besuchstag" : "Besuchstage"}</div>
            </div>
          )}
          {recap.bestWeekday && (
            <div className="rd-stat">
              <div className="rd-display rd-recap-word">{recap.bestWeekday.name}</div>
              <b>Dein Tag</b>
              <div className="rd-muted">{recap.bestWeekday.visitDays} von {recap.visitDays} Besuchen</div>
            </div>
          )}
          {data.air && (
            <div className="rd-stat">
              <div className="rd-display">{formatDegrees(data.air.avg)}°</div>
              <b>Luft im Schnitt</b>
              <div className="rd-muted">{tempStatNote(data.air, recap.visitDays)}</div>
            </div>
          )}
          {(data.water || data.waterSensor) && (
            <div className="rd-stat">
              <div className="rd-display">{data.water ? `${formatDegrees(data.water.avg)}°` : "–"}</div>
              <b>Wasser im Schnitt</b>
              <div className="rd-muted">
                {data.water ? tempStatNote(data.water, recap.visitDays) : "an deinen Tagen noch nicht gemessen"}
              </div>
            </div>
          )}
        </div>
      )}

      {level?.current && (
        <div className="rd-card">
          <div className="rd-label">Erreichte Stufe</div>
          <div className="rd-display" style={{ fontSize: 40 }}>{level.current.name}</div>
          {level.next && (
            <div className="rd-muted">Noch {level.next.threshold - level.next.value} bis {level.next.name}</div>
          )}
        </div>
      )}

      <Link href={base} className="rd-btn rd-btn-wide"><span>Zur Übersicht</span></Link>
      <Link href={`${base}/rueckblick?jahr=${other}`} className="rd-btn rd-btn-ghost rd-btn-wide">
        <span>Saison {other} ansehen</span>
      </Link>
    </>
  );
}
