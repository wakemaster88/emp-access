"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck, CalendarX2, Check, ChevronLeft, ChevronRight, Clock, DoorOpen, Loader2, ReceiptText,
  RefreshCw, Sun, Sunset, Undo2,
} from "lucide-react";
import { formatCents, type PortalSlot } from "@/lib/verein-portal-rules";

interface PortalService {
  id: number;
  name: string;
  priceCents: number;
  daylight?: boolean;
  /** Inklusivmiete (0 €) für Vorstand und Trainer wählbar. */
  inclusive?: boolean;
}

interface PortalBooking {
  id: number;
  serviceName: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  priceCents: number;
  status: "BOOKED" | "CANCELED" | "REQUESTED" | "REJECTED";
  bookedBy: string | null;
  bookedFor?: string | null;
  inclusive?: boolean;
  note: string | null;
  canceledBy: string | null;
  rejectReason: string | null;
  billed: boolean;
  past: boolean;
  canCancel: boolean;
}

interface PortalAccess {
  points: { kind: "device" | "doorbird"; id: number; name: string }[];
  leadMinutes: number;
  trailMinutes: number;
  active: boolean;
  window: { from: string; to: string } | null;
}

interface PortalData {
  access: PortalAccess;
  verein: { name: string; accountName: string; cancelHours: number; horizonDays: number; window: { from: string; to: string } };
  services: PortalService[];
  bookings: PortalBooking[];
}

interface SlotsPayload {
  slots?: PortalSlot[];
  note?: string;
  error?: string;
  daylight?: { sunrise: string | null; sunset: string | null };
}

const NAME_KEY = "verein-portal-name";
const FOR_KEY = "verein-portal-for";
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Sa, 14.11." bzw. mit Jahr "Sa, 14.11.2026" */
function fmtDay(ymd: string, withYear = false): string {
  const [y, m, d] = ymd.split("-");
  return `${WEEKDAYS[weekdayOf(ymd)]}, ${d}.${m}.${withYear ? y : ""}`;
}

/** "Sonntag, 6. Dezember" */
function fmtDayLong(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${WEEKDAYS_LONG[weekdayOf(ymd)]}, ${d}. ${MONTHS[m - 1]}`;
}

/** Montag der Woche, in der `ymd` liegt. */
function mondayOf(ymd: string): string {
  const wd = weekdayOf(ymd);
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

/** "Dezember 2026" bzw. "Nov / Dez 2026", wenn die Woche zwei Monate streift. */
function fmtWeekMonth(monday: string): string {
  const sunday = addDays(monday, 6);
  const [y1, m1] = monday.split("-").map(Number);
  const [y2, m2] = sunday.split("-").map(Number);
  if (m1 === m2) return `${MONTHS[m1 - 1]} ${y1}`;
  return `${MONTHS[m1 - 1].slice(0, 3)} / ${MONTHS[m2 - 1].slice(0, 3)} ${y2}`;
}

function todayBerlin(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

function readStore(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStore(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
  } catch { /* privater Modus */ }
}

/**
 * Vereinsportal (öffentlich über geheimen Link), im Look der Kunden-App.
 * Handy zuerst: Angebot, Tag und freien Slot antippen, im Blatt von unten
 * angeben, für wen gebucht wird, verbindlich buchen. Unter „Meine
 * Buchungen“ stehen kommende Buchungen mit Storno bis zur Frist.
 */
export function VereinPortalClient({
  token,
  vereinName,
  accountName,
}: {
  token: string;
  vereinName: string;
  accountName: string;
}) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"book" | "mine">("book");
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<PortalSlot[] | null>(null);
  const [slotsInfo, setSlotsInfo] = useState<Pick<SlotsPayload, "note" | "error" | "daylight">>({});
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [sheet, setSheet] = useState<
    | { kind: "book"; slot: PortalSlot }
    | { kind: "request" }
    | { kind: "cancel"; booking: PortalBooking }
    | { kind: "done"; title: string; text: string }
    | null
  >(null);
  const [bookedBy, setBookedBy] = useState("");
  const [bookedFor, setBookedFor] = useState("");
  const [note, setNote] = useState("");
  // Inklusivmiete bewusst je Buchung wählen, Standard ist die Miete.
  const [inclusiveChoice, setInclusiveChoice] = useState(false);
  const [reqStart, setReqStart] = useState("10:00");
  const [reqEnd, setReqEnd] = useState("11:00");
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/verein-portal/${token}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "Dieser Link ist nicht (mehr) gültig." : "Laden fehlgeschlagen.");
      const payload = (await res.json()) as PortalData;
      setData(payload);
      setLoadError(null);
      setServiceId((prev) => prev ?? payload.services[0]?.id ?? null);
      setDate((prev) => prev ?? payload.verein.window.from);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Laden fehlgeschlagen.");
    }
  }, [token]);

  useEffect(() => {
    load();
    setBookedBy(readStore(NAME_KEY));
    setBookedFor(readStore(FOR_KEY));
  }, [load]);

  const loadSlots = useCallback(async () => {
    if (serviceId == null || !date) return;
    setSlotsLoading(true);
    try {
      const res = await fetch(`/api/verein-portal/${token}/slots?serviceId=${serviceId}&date=${date}`, { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as SlotsPayload;
      if (!res.ok) throw new Error(payload.error ?? "Slots konnten nicht geladen werden.");
      setSlots(payload.slots ?? []);
      setSlotsInfo({ note: payload.note, error: payload.error, daylight: payload.daylight });
    } catch (e) {
      setSlots([]);
      setSlotsInfo({ error: e instanceof Error ? e.message : "Slots konnten nicht geladen werden." });
    } finally {
      setSlotsLoading(false);
    }
  }, [token, serviceId, date]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const service = data?.services.find((s) => s.id === serviceId) ?? null;
  const inclusive = !!service?.inclusive && inclusiveChoice;
  const priceLabel = formatCents(inclusive ? 0 : service?.priceCents ?? 0).replace(",00", "");
  const upcoming = useMemo(
    () => (data?.bookings ?? []).filter((b) => (b.status === "BOOKED" || b.status === "REQUESTED") && !b.past),
    [data],
  );
  const history = useMemo(
    () => (data?.bookings ?? []).filter((b) => b.status === "CANCELED" || b.status === "REJECTED" || b.past).reverse(),
    [data],
  );

  function openSheet(next: NonNullable<typeof sheet>) {
    setSheetError(null);
    if (next.kind === "book" || next.kind === "request") setInclusiveChoice(false);
    setSheet(next);
  }

  function closeSheet() {
    if (!busy) setSheet(null);
  }

  async function confirmBooking(slot: PortalSlot) {
    if (serviceId == null || !date) return;
    setBusy(true);
    setSheetError(null);
    try {
      const res = await fetch(`/api/verein-portal/${token}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          date,
          slotStart: slot.startTime,
          bookedBy: bookedBy.trim(),
          bookedFor: bookedFor.trim(),
          note: note.trim() || null,
          inclusive,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Buchung fehlgeschlagen.");
      writeStore(NAME_KEY, bookedBy.trim());
      writeStore(FOR_KEY, bookedFor.trim());
      setNote("");
      setSheet({
        kind: "done",
        title: "Gebucht",
        text: `${service?.name ?? "Slot"} am ${fmtDay(date)} von ${slot.startTime} bis ${slot.endTime} Uhr für ${bookedFor.trim()}${inclusive ? ", inklusive (0 €)" : ""}.`,
      });
      await Promise.all([load(), loadSlots()]);
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Buchung fehlgeschlagen.");
      loadSlots();
    } finally {
      setBusy(false);
    }
  }

  async function sendRequest() {
    if (serviceId == null || !date) return;
    setBusy(true);
    setSheetError(null);
    try {
      const res = await fetch(`/api/verein-portal/${token}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          date,
          start: reqStart,
          end: reqEnd,
          bookedBy: bookedBy.trim(),
          bookedFor: bookedFor.trim(),
          note: note.trim() || null,
          inclusive,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Anfrage fehlgeschlagen.");
      writeStore(NAME_KEY, bookedBy.trim());
      writeStore(FOR_KEY, bookedFor.trim());
      setNote("");
      setSheet({
        kind: "done",
        title: "Anfrage ist raus",
        text: `${fmtDay(date)}, ${reqStart}–${reqEnd} Uhr. Unter „Meine Buchungen“ seht ihr, sobald wir sie freigeben.`,
      });
      await load();
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Anfrage fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking(b: PortalBooking) {
    setBusy(true);
    setSheetError(null);
    try {
      const res = await fetch(`/api/verein-portal/${token}/bookings/${b.id}`, { method: "DELETE" });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Stornieren fehlgeschlagen.");
      setSheet({
        kind: "done",
        title: b.status === "REQUESTED" ? "Zurückgezogen" : "Storniert",
        text: b.status === "REQUESTED"
          ? `Die Anfrage für ${fmtDay(b.date)} um ${b.slotStart} ist zurückgezogen.`
          : `${fmtDay(b.date)} um ${b.slotStart} ist wieder frei und wird nicht berechnet.`,
      });
      await Promise.all([load(), loadSlots()]);
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Stornieren fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  // Woche: Montag bis Sonntag, außerhalb des Buchungsfensters gesperrt.
  const bookWindow = data?.verein.window;
  const weekStart = date ? mondayOf(date) : null;
  const days = weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];
  const canPrev = !!(bookWindow && weekStart && weekStart > bookWindow.from);
  const canNext = !!(bookWindow && weekStart && addDays(weekStart, 7) <= bookWindow.to);
  const visibleSlots = (slots ?? []).filter((s) => s.state !== "past");
  const freeCount = visibleSlots.filter((s) => s.state === "free").length;
  const today = todayBerlin();
  const cancelHours = data?.verein.cancelHours ?? 24;

  return (
    <main className="rd-main">
      <header className="rd-hero vp-hero">
        <svg aria-hidden="true" viewBox="0 0 390 120" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M-10 52 C 60 20, 120 84, 195 52 S 330 20, 400 52" opacity="0.55" />
          <path d="M-10 74 C 60 42, 120 106, 195 74 S 330 42, 400 74" opacity="0.3" />
          <path d="M-10 96 C 60 64, 120 128, 195 96 S 330 64, 400 96" opacity="0.15" />
        </svg>
        <div className="rd-hero-body">
          <span className="rd-hero-line">{accountName} · Vereinsportal</span>
          <h1 className="rd-display rd-h1">{vereinName}</h1>
          <p>Lift selbst buchen. Abgerechnet wird gesammelt am Monatsende.</p>
        </div>
      </header>

      {loadError && (
        <div className="rd-card">
          <p className="rd-msg rd-msg-err" role="alert">{loadError}</p>
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={load}><span>Erneut versuchen</span></button>
        </div>
      )}
      {!data && !loadError && (
        <div className="vp-empty rd-muted" aria-live="polite"><Loader2 className="vp-spin" /> Lädt …</div>
      )}

      {data && (
        <>
          <AccessCard token={token} access={data.access} onChanged={load} />

          <div className="vp-tabs" role="tablist" aria-label="Ansicht">
            <button type="button" role="tab" aria-selected={tab === "book"} onClick={() => setTab("book")}>Buchen</button>
            <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>
              Meine Buchungen
              {upcoming.length > 0 && <span className="vp-count">{upcoming.length}</span>}
            </button>
          </div>

          {tab === "book" && (
            data.services.length === 0 ? (
              <section className="rd-card vp-empty">
                <CalendarX2 />
                <b>Für euren Verein ist noch nichts freigegeben.</b>
                <span className="rd-muted">Meldet euch bei uns, dann schalten wir die Angebote frei.</span>
              </section>
            ) : (
              <>
                <section className="vp-section" aria-label="Angebot">
                  {data.services.length > 1 ? (
                    <div className="vp-offers" role="radiogroup" aria-label="Angebot">
                      {data.services.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          role="radio"
                          aria-checked={s.id === serviceId}
                          className="vp-offer"
                          onClick={() => setServiceId(s.id)}
                        >
                          <span className="rd-grow vp-offer-text">
                            <span className="vp-offer-name">{s.name}</span>
                            <span className="vp-offer-sub">{s.daylight ? "Täglich, solange es hell ist" : "In den Buchungszeiten"}</span>
                            {s.inclusive && <span className="vp-offer-incl">Vorstand und Trainer: 0 € inklusive</span>}
                          </span>
                          <span className="vp-price">
                            <span className="rd-display">{formatCents(s.priceCents).replace(",00", "")}</span>
                            <small>pro Slot</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : service && (
                    <div className="vp-offer">
                      <span className="rd-grow vp-offer-text">
                        <span className="vp-offer-name">{service.name}</span>
                        <span className="vp-offer-sub">{service.daylight ? "Täglich, solange es hell ist" : "In den Buchungszeiten"}</span>
                        {service.inclusive && <span className="vp-offer-incl">Vorstand und Trainer: 0 € inklusive</span>}
                      </span>
                      <span className="vp-price">
                        <span className="rd-display">{formatCents(service.priceCents).replace(",00", "")}</span>
                        <small>pro Slot</small>
                      </span>
                    </div>
                  )}
                  <div className="vp-facts">
                    <span className="vp-fact"><Undo2 /> Storno bis {cancelHours} Std. vorher</span>
                    <span className="vp-fact"><ReceiptText /> Rechnung monatlich</span>
                  </div>
                </section>

                <section className="rd-card vp-section" aria-label="Tag und Uhrzeit">
                  <div className="vp-week-head">
                    <button
                      type="button"
                      className="vp-nav"
                      aria-label="Vorige Woche"
                      disabled={!canPrev}
                      onClick={() => weekStart && bookWindow && setDate(addDays(weekStart, -7) < bookWindow.from ? bookWindow.from : addDays(weekStart, -7))}
                    >
                      <ChevronLeft />
                    </button>
                    <span className="rd-display">{weekStart && fmtWeekMonth(weekStart)}</span>
                    <button
                      type="button"
                      className="vp-nav"
                      aria-label="Nächste Woche"
                      disabled={!canNext}
                      onClick={() => weekStart && setDate(addDays(weekStart, 7))}
                    >
                      <ChevronRight />
                    </button>
                  </div>
                  <div className="vp-days" role="radiogroup" aria-label="Tag">
                    {days.map((d) => {
                      const disabled = !bookWindow || d < bookWindow.from || d > bookWindow.to;
                      return (
                        <button
                          key={d}
                          type="button"
                          role="radio"
                          aria-checked={d === date}
                          aria-label={fmtDayLong(d)}
                          disabled={disabled}
                          onClick={() => setDate(d)}
                          className={`vp-day${d === today ? " vp-day-today" : ""}`}
                        >
                          <span>{WEEKDAYS[weekdayOf(d)]}</span>
                          <b>{Number(d.slice(8))}</b>
                        </button>
                      );
                    })}
                  </div>

                  <div className="vp-dayline">
                    <h2 className="rd-display">{date ? fmtDayLong(date) : "Slots"}</h2>
                    <button type="button" className="vp-nav" aria-label="Slots neu laden" onClick={loadSlots} disabled={slotsLoading}>
                      <RefreshCw className={slotsLoading ? "vp-spin" : undefined} size={18} />
                    </button>
                  </div>
                  {slotsInfo.daylight?.sunrise && slotsInfo.daylight.sunset && (
                    <span className="vp-sun">
                      <Sun /> Hell von {slotsInfo.daylight.sunrise} <Sunset /> bis {slotsInfo.daylight.sunset} Uhr
                      {freeCount > 0 && <span className="rd-muted">· {freeCount} frei</span>}
                    </span>
                  )}

                  {slotsLoading && !slots ? (
                    <div className="vp-empty rd-muted"><Loader2 className="vp-spin" /> Lädt …</div>
                  ) : slotsInfo.error ? (
                    <p className="rd-msg rd-msg-err" role="alert">{slotsInfo.error}</p>
                  ) : slotsInfo.note ? (
                    <p className="rd-msg rd-msg-ok">{slotsInfo.note}</p>
                  ) : visibleSlots.length === 0 ? (
                    <div className="vp-empty">
                      <Clock />
                      <b>An diesem Tag ist nichts mehr frei.</b>
                      <span className="rd-muted">Nehmt einen anderen Tag oder fragt eure Wunschzeit an.</span>
                    </div>
                  ) : (
                    <div className={`vp-slots${slotsLoading ? " vp-loading" : ""}`}>
                      {visibleSlots.map((s) => (
                        <button
                          key={s.startTime}
                          type="button"
                          disabled={s.state !== "free"}
                          onClick={() => openSheet({ kind: "book", slot: s })}
                          className={`vp-slot vp-slot-${s.state}`}
                          aria-label={`${s.startTime} bis ${s.endTime} Uhr, ${s.state === "free" ? "frei" : s.state === "mine" ? "eure Buchung" : "belegt"}`}
                        >
                          <b>{s.startTime}</b>
                          <small>bis {s.endTime}</small>
                          <span className="vp-slot-tag">{s.state === "free" ? "frei" : s.state === "mine" ? "eure" : "belegt"}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="vp-wish">
                    <p>Passt nichts? Fragt eine eigene Zeit an.</p>
                    <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={!date} onClick={() => openSheet({ kind: "request" })}>
                      <span>Anfragen</span>
                    </button>
                  </div>
                </section>
              </>
            )
          )}

          {tab === "mine" && (
            <>
              <section className="rd-card" aria-label="Kommende Buchungen">
                <div className="vp-section-head">
                  <span className="rd-label">Kommend</span>
                  <span className="rd-muted" style={{ fontSize: 12 }}>Storno bis {cancelHours} Std. vorher</span>
                </div>
                {upcoming.length === 0 ? (
                  <div className="vp-empty">
                    <CalendarCheck />
                    <b>Gerade ist nichts gebucht.</b>
                    <button type="button" className="rd-btn rd-btn-sm" onClick={() => setTab("book")}><span>Jetzt buchen</span></button>
                  </div>
                ) : (
                  <div className="vp-bookings">
                    {upcoming.map((b) => (
                      <BookingRow key={b.id} booking={b} onCancel={b.canCancel ? () => openSheet({ kind: "cancel", booking: b }) : undefined} />
                    ))}
                  </div>
                )}
              </section>
              {history.length > 0 && (
                <section className="rd-card" aria-label="Vergangen und storniert">
                  <span className="rd-label">Vergangen und storniert · 90 Tage</span>
                  <div className="vp-bookings">
                    {history.map((b) => <BookingRow key={b.id} booking={b} />)}
                  </div>
                </section>
              )}
            </>
          )}
          <p className="vp-foot">{accountName} · Fragen? Sprecht uns an der Anlage an.</p>
        </>
      )}

      {sheet && (
        <Sheet onClose={closeSheet} label={sheet.kind === "book" ? "Slot buchen" : sheet.kind === "request" ? "Wunschzeit anfragen" : sheet.kind === "cancel" ? "Stornieren" : "Erledigt"}>
          {sheet.kind === "book" && date && (
            <form
              className="vp-section"
              onSubmit={(e) => {
                e.preventDefault();
                confirmBooking(sheet.slot);
              }}
            >
              <div className="vp-sheet-title">
                <span className="rd-label">{service?.name}</span>
                <h2 className="rd-display">{fmtDay(date)} · {sheet.slot.startTime}–{sheet.slot.endTime}</h2>
              </div>
              {service?.inclusive ? (
                <>
                  <KindChoice priceCents={service.priceCents} inclusive={inclusive} onChange={setInclusiveChoice} />
                  <p className="vp-small">1 Slot, verbindlich. Kostenlos stornierbar bis {cancelHours} Std. vorher.</p>
                </>
              ) : (
                <div className="vp-sum">
                  <div className="vp-sum-what">
                    <b>1 Slot, verbindlich</b>
                    <span>Kostenlos stornierbar bis {cancelHours} Std. vorher</span>
                  </div>
                  <span className="rd-display">{priceLabel}</span>
                </div>
              )}
              <WhoFields bookedFor={bookedFor} setBookedFor={setBookedFor} bookedBy={bookedBy} setBookedBy={setBookedBy} note={note} setNote={setNote} />
              {sheetError && <p className="rd-msg rd-msg-err" role="alert">{sheetError}</p>}
              <div className="vp-actions">
                <button type="submit" className="rd-btn rd-btn-accent rd-btn-wide" disabled={busy || !bookedFor.trim() || !bookedBy.trim()}>
                  <span>{busy ? "Bucht …" : `${inclusive ? "Inklusiv buchen" : "Verbindlich buchen"} · ${priceLabel}`}</span>
                </button>
                <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={closeSheet} disabled={busy}><span>Abbrechen</span></button>
              </div>
              <p className="vp-small">
                {inclusive ? "Läuft über eure Jahrespauschale, es wird nichts zusätzlich berechnet." : "Abgerechnet wird gesammelt am Monatsende an den Verein."}
              </p>
            </form>
          )}

          {sheet.kind === "request" && date && (
            <form
              className="vp-section"
              onSubmit={(e) => {
                e.preventDefault();
                sendRequest();
              }}
            >
              <div className="vp-sheet-title">
                <span className="rd-label">{service?.name} · Wunschzeit</span>
                <h2 className="rd-display">{fmtDay(date, true)}</h2>
              </div>
              <p className="vp-small">Wir prüfen die Anfrage und geben sie frei. Erst dann ist sie gebucht.</p>
              {service?.inclusive && <KindChoice priceCents={service.priceCents} inclusive={inclusive} onChange={setInclusiveChoice} />}
              <div className="vp-times">
                <div className="rd-field">
                  <label htmlFor="vp-req-start">Von</label>
                  <input id="vp-req-start" className="rd-input" type="time" step={900} value={reqStart} onChange={(e) => setReqStart(e.target.value)} />
                </div>
                <div className="rd-field">
                  <label htmlFor="vp-req-end">Bis</label>
                  <input id="vp-req-end" className="rd-input" type="time" step={900} value={reqEnd} onChange={(e) => setReqEnd(e.target.value)} />
                </div>
              </div>
              <WhoFields bookedFor={bookedFor} setBookedFor={setBookedFor} bookedBy={bookedBy} setBookedBy={setBookedBy} note={note} setNote={setNote} byLabel="Angefragt von" />
              {sheetError && <p className="rd-msg rd-msg-err" role="alert">{sheetError}</p>}
              <div className="vp-actions">
                <button type="submit" className="rd-btn rd-btn-accent rd-btn-wide" disabled={busy || !reqStart || !reqEnd || !bookedFor.trim() || !bookedBy.trim()}>
                  <span>{busy ? "Sendet …" : "Anfrage senden"}</span>
                </button>
                <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={closeSheet} disabled={busy}><span>Abbrechen</span></button>
              </div>
            </form>
          )}

          {sheet.kind === "cancel" && (
            <div className="vp-section">
              <div className="vp-sheet-title">
                <span className="rd-label">{sheet.booking.serviceName}</span>
                <h2 className="rd-display">{sheet.booking.status === "REQUESTED" ? "Anfrage zurückziehen?" : "Buchung stornieren?"}</h2>
              </div>
              <p className="rd-soft" style={{ margin: 0 }}>
                {fmtDay(sheet.booking.date, true)}, {sheet.booking.slotStart}–{sheet.booking.slotEnd} Uhr
                {sheet.booking.bookedFor ? ` für ${sheet.booking.bookedFor}` : ""}.
                {sheet.booking.status === "REQUESTED" ? "" : " Der Slot wird wieder frei und nicht berechnet."}
              </p>
              {sheetError && <p className="rd-msg rd-msg-err" role="alert">{sheetError}</p>}
              <div className="vp-actions">
                <button type="button" className="rd-btn rd-btn-danger rd-btn-wide" onClick={() => cancelBooking(sheet.booking)} disabled={busy}>
                  <span>{busy ? "Storniert …" : sheet.booking.status === "REQUESTED" ? "Zurückziehen" : "Stornieren"}</span>
                </button>
                <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={closeSheet} disabled={busy}><span>Behalten</span></button>
              </div>
            </div>
          )}

          {sheet.kind === "done" && (
            <div className="vp-section vp-done" role="status">
              <span className="vp-done-icon"><Check /></span>
              <h2 className="rd-display rd-h2">{sheet.title}</h2>
              <p className="rd-soft" style={{ margin: 0 }}>{sheet.text}</p>
              <button type="button" className="rd-btn rd-btn-wide" onClick={() => setSheet(null)}><span>Fertig</span></button>
            </div>
          )}
        </Sheet>
      )}
    </main>
  );
}

/** Miete oder Inklusivmiete (0 €, Vorstand und Trainer über die Jahrespauschale). */
function KindChoice({
  priceCents, inclusive, onChange,
}: {
  priceCents: number;
  inclusive: boolean;
  onChange: (inclusive: boolean) => void;
}) {
  const options = [
    { value: false, title: "Miete", text: "Für Mitglieder, wird monatlich abgerechnet", price: priceCents },
    { value: true, title: "Inklusiv", text: "Vorstand, Trainer und Familie 1. Grades", price: 0 },
  ];
  return (
    <div className="vp-kinds" role="radiogroup" aria-label="Wer fährt?">
      {options.map((o) => (
        <button
          key={o.title}
          type="button"
          role="radio"
          aria-checked={inclusive === o.value}
          className="vp-kind"
          onClick={() => onChange(o.value)}
        >
          <span className="vp-kind-dot" aria-hidden="true" />
          <span className="vp-kind-text">
            <b>{o.title}</b>
            <small>{o.text}</small>
          </span>
          <span className="rd-display">{formatCents(o.price).replace(",00", "")}</span>
        </button>
      ))}
    </div>
  );
}

function WhoFields({
  bookedFor, setBookedFor, bookedBy, setBookedBy, note, setNote, byLabel = "Gebucht von",
}: {
  bookedFor: string;
  setBookedFor: (v: string) => void;
  bookedBy: string;
  setBookedBy: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  byLabel?: string;
}) {
  return (
    <>
      <div className="rd-field">
        <label htmlFor="vp-for">Für wen? *</label>
        <input
          id="vp-for"
          className="rd-input"
          value={bookedFor}
          onChange={(e) => setBookedFor(e.target.value)}
          placeholder="z. B. Max, Lisa und Tom"
          maxLength={200}
          required
          aria-required
        />
        <span className="vp-field-hint">Wer fährt? Namen der Fahrer oder Gruppe.</span>
      </div>
      <div className="rd-field">
        <label htmlFor="vp-by">{byLabel} *</label>
        <input
          id="vp-by"
          className="rd-input"
          value={bookedBy}
          onChange={(e) => setBookedBy(e.target.value)}
          placeholder="Vor- und Nachname"
          maxLength={120}
          autoComplete="name"
          required
          aria-required
        />
      </div>
      <div className="rd-field">
        <label htmlFor="vp-note">Bemerkung (optional)</label>
        <textarea
          id="vp-note"
          className="rd-input vp-textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. Hebler: Jan"
          maxLength={500}
          rows={2}
        />
      </div>
    </>
  );
}

/** Blatt von unten: Fokus bleibt drin, Escape und Tipp daneben schließen, die Seite scrollt nicht mit. */
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab" || !el) return;
      const items = el.querySelectorAll<HTMLElement>("button:not(:disabled), input, textarea");
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="vp-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="vp-sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <span className="vp-grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

function BookingRow({ booking: b, onCancel }: { booking: PortalBooking; onCancel?: () => void }) {
  const off = b.status === "CANCELED" || b.status === "REJECTED";
  const requested = b.status === "REQUESTED";
  const [, m, d] = b.date.split("-").map(Number);
  const pill = requested ? (
    <span className="rd-pill vp-pill-wait">Angefragt</span>
  ) : b.status === "REJECTED" ? (
    <span className="rd-pill rd-pill-off">Abgelehnt</span>
  ) : b.status === "CANCELED" ? (
    <span className="rd-pill rd-pill-off">Storniert</span>
  ) : b.past ? (
    <span className={`rd-pill ${b.billed ? "vp-pill-done" : "rd-pill-off"}`}>{b.billed ? "Abgerechnet" : "Vorbei"}</span>
  ) : (
    <span className="rd-pill rd-pill-open">Gebucht</span>
  );
  return (
    <div className={`vp-booking${off || b.past ? " vp-booking-off" : ""}`}>
      <div className="vp-date" aria-hidden="true">
        <span>{WEEKDAYS[weekdayOf(b.date)]}</span>
        <b>{d}</b>
        <span>{MONTHS[m - 1].slice(0, 3)}</span>
      </div>
      <div className="vp-booking-main">
        <div className="vp-booking-top">
          <b>{b.slotStart}–{b.slotEnd}</b>
          {pill}
        </div>
        <span>{b.serviceName} · {b.inclusive ? "Inklusiv, 0 €" : formatCents(b.priceCents).replace(",00", "")}</span>
        {b.bookedFor && <span>Für {b.bookedFor}</span>}
        {b.bookedBy && <span>Gebucht von {b.bookedBy}</span>}
        {b.status === "REJECTED" && b.rejectReason && <span>Abgelehnt: {b.rejectReason}</span>}
        {onCancel && (
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm vp-booking-action" onClick={onCancel}>
            <span>{requested ? "Anfrage zurückziehen" : "Stornieren"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function fmtWindowTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
}

function fmtWindowDay(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit" });
}

/**
 * Zugang außerhalb des Betriebs: Im Fenster der Buchung (mit Vor- und
 * Nachbereitung) öffnen die Tasten Tor und Türen; sonst steht nur, ab wann.
 */
function AccessCard({ token, access, onChanged }: { token: string; access: PortalAccess; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (access.points.length === 0 || !access.window) return null;

  if (!access.active) {
    return (
      <section className="rd-card" aria-label="Zugang">
        <div className="rd-row">
          <DoorOpen size={20} className="rd-muted" />
          <span className="rd-grow rd-soft">
            Tor und Türen öffnet ihr hier am {fmtWindowDay(access.window.from)} von {fmtWindowTime(access.window.from)} bis {fmtWindowTime(access.window.to)} Uhr.
          </span>
        </div>
      </section>
    );
  }

  async function open(p: PortalAccess["points"][number]) {
    const key = `${p.kind}:${p.id}`;
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/verein-portal/${token}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: p.kind, id: p.id }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Öffnen fehlgeschlagen.");
      setDone(key);
      setTimeout(() => setDone((d) => (d === key ? null : d)), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Öffnen fehlgeschlagen.");
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rd-card vp-access" aria-label="Zugang">
      <div className="vp-section-head">
        <span className="rd-label">Zugang offen</span>
        <span className="rd-muted" style={{ fontSize: 12 }}>bis {fmtWindowTime(access.window.to)} Uhr</span>
      </div>
      {access.points.map((p) => {
        const key = `${p.kind}:${p.id}`;
        return (
          <div key={key} className="vp-door">
            <DoorOpen size={20} />
            <b className="rd-grow">{p.name}</b>
            <button type="button" className="rd-btn rd-btn-accent" onClick={() => open(p)} disabled={busy !== null} aria-label={`${p.name} öffnen`}>
              <span>{busy === key ? "Öffnet …" : done === key ? "Geöffnet" : "Öffnen"}</span>
            </button>
          </div>
        );
      })}
      {error && <p className="rd-msg rd-msg-err" role="alert">{error}</p>}
    </section>
  );
}
