import { riderBase } from "@/lib/rider-base";
import Link from "next/link";
import { requireRider } from "@/lib/rider-auth";
import { loadRiderSchedules } from "@/lib/rider-opening";
import { calendarDayLabel, calendarMonth, calendarMonthKey } from "@/lib/rider-calendar";
import { berlinYmd } from "@/lib/berlin-day";
import { RIDER_LOCATION } from "@/lib/rider-shop";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const CHEVRON = (d: string) => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/** Öffnungszeiten als Monatskalender: Lift zuerst, die anderen Bereiche zum Umschalten. */
export default async function RiderOpeningCalendar({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ monat?: string; bereich?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const rider = await requireRider(token);
  const base = await riderBase(token);
  const schedules = await loadRiderSchedules(rider.accountId);
  const today = berlinYmd(new Date());
  const schedule = schedules.find((s) => String(s.id) === query.bereich) ?? schedules[0] ?? null;
  const month = schedule ? calendarMonth(schedule.spec, calendarMonthKey(query.monat, today), today) : null;
  const href = (monat: string | null, bereich: number | undefined) => {
    const p = new URLSearchParams();
    if (monat && monat !== today.slice(0, 7)) p.set("monat", monat);
    if (bereich != null && bereich !== schedules[0]?.id) p.set("bereich", String(bereich));
    const q = p.toString();
    return `${base}/zeiten${q ? `?${q}` : ""}`;
  };

  return (
    <>
      <Link href={base} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 6, textDecoration: "none", fontWeight: 500 }}>
        {CHEVRON("M15 5l-7 7 7 7")}
        Zurück zum Start
      </Link>
      <h1 className="rd-display rd-h1">Öffnungszeiten</h1>

      {!schedule || !month ? (
        <div className="rd-card rd-muted">Für den {RIDER_LOCATION} sind gerade keine Öffnungszeiten hinterlegt.</div>
      ) : (
        <>
          {schedules.length > 1 && (
            <nav className="rd-family rd-family-wrap" aria-label="Bereich">
              {schedules.map((s) => (
                <Link key={s.id} href={href(month.key, s.id)} replace scroll={false} aria-current={s.id === schedule.id ? "true" : undefined}>
                  {s.name}
                </Link>
              ))}
            </nav>
          )}

          <div className="rd-card rd-cal">
            <div className="rd-cal-head">
              {month.prev ? (
                <Link href={href(month.prev, schedule.id)} replace scroll={false} className="rd-cal-nav" aria-label="Monat zurück">
                  {CHEVRON("M15 6l-6 6 6 6")}
                </Link>
              ) : (
                <span className="rd-cal-nav" aria-hidden="true" />
              )}
              <h2 className="rd-display rd-h3" style={{ margin: 0 }}>{month.title}</h2>
              {month.next ? (
                <Link href={href(month.next, schedule.id)} replace scroll={false} className="rd-cal-nav" aria-label="Monat vor">
                  {CHEVRON("M9 6l6 6-6 6")}
                </Link>
              ) : (
                <span className="rd-cal-nav" aria-hidden="true" />
              )}
            </div>
            <div className="rd-cal-grid" role="grid" aria-label={`${schedule.name}, ${month.title}`}>
              {WEEKDAYS.map((w) => (
                <div key={w} className="rd-cal-wd" role="columnheader">{w}</div>
              ))}
              {month.weeks.flat().map((d) => {
                const cls = [
                  "rd-cal-day",
                  !d.inMonth && "rd-cal-out",
                  d.open && "rd-cal-open",
                  d.exception && "rd-cal-exc",
                  d.today && "rd-cal-today",
                  d.past && "rd-cal-past",
                ]
                  .filter(Boolean)
                  .join(" ");
                const label = `${calendarDayLabel(d.ymd)}${d.today ? " (heute)" : ""}: ${d.open ? `${d.hours} Uhr` : "geschlossen"}${d.note ? `, ${d.note}` : ""}`;
                return (
                  <div key={d.ymd} className={cls} role="gridcell" aria-label={d.inMonth ? label : undefined} aria-hidden={d.inMonth ? undefined : true}>
                    <span className="rd-cal-num">{Number(d.ymd.slice(8, 10))}</span>
                    {d.inMonth && d.open && <span className="rd-cal-hours">{d.hours?.replace(" und ", " ")}</span>}
                  </div>
                );
              })}
            </div>
            <div className="rd-cal-legend rd-muted">
              <span><i className="rd-cal-key rd-cal-key-open" />geöffnet</span>
              <span><i className="rd-cal-key rd-cal-key-exc" />Sondertag</span>
            </div>
          </div>

          <div className="rd-label" style={{ marginTop: 4 }}>
            {schedule.name} · {month.key === today.slice(0, 7) ? "ab heute" : month.title}
          </div>
          {month.list.length === 0 ? (
            <div className="rd-card rd-muted">
              {month.key < today.slice(0, 7) ? `Im ${month.title} war nicht geöffnet.` : `Im ${month.title} ist kein Tag mehr geplant.`}
              {month.next && (
                <>
                  {" "}
                  <Link href={href(month.next, schedule.id)} replace scroll={false}>Nächsten Monat ansehen</Link>
                </>
              )}
            </div>
          ) : (
            <div className="rd-card rd-list rd-cal-list">
              {month.list.map((d) => (
                <div key={d.ymd} className={d.today ? "rd-cal-list-today" : undefined}>
                  <span className="rd-grow">
                    <b>{d.today ? "Heute" : calendarDayLabel(d.ymd)}</b>
                    {d.note && <span className="rd-muted"> · {d.note}</span>}
                  </span>
                  <span className={d.open ? "rd-cal-list-hours" : "rd-muted"}>{d.open ? `${d.hours} Uhr` : "geschlossen"}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
