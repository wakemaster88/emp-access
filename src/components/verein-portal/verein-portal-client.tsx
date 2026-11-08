"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Building2, CalendarCheck, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  Clock, DoorOpen, Hourglass, Send, KeyRound, Loader2, RefreshCw, Users, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatCents, type PortalSlot } from "@/lib/verein-portal-rules";

interface PortalService {
  id: number;
  name: string;
  priceCents: number;
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

const NAME_KEY = "verein-portal-name";
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

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

/** Montag der Woche, in der `ymd` liegt. */
function mondayOf(ymd: string): string {
  const wd = weekdayOf(ymd);
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

/**
 * Vereinsportal (oeffentlich ueber geheimen Link). Handy zuerst: Angebot
 * waehlen, Tag waehlen, freien Slot antippen und verbindlich buchen. Unter
 * „Meine Buchungen“ stehen kommende Buchungen mit Storno bis zur Frist.
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
  const [slotsNote, setSlotsNote] = useState<string | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [picked, setPicked] = useState<PortalSlot | null>(null);
  const [bookedBy, setBookedBy] = useState("");
  const [note, setNote] = useState("");
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PortalBooking | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqStart, setReqStart] = useState("10:00");
  const [reqEnd, setReqEnd] = useState("11:00");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

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
    try {
      setBookedBy(localStorage.getItem(NAME_KEY) ?? "");
    } catch { /* privater Modus */ }
  }, [load]);

  const loadSlots = useCallback(async () => {
    if (serviceId == null || !date) return;
    setSlotsLoading(true);
    setSlotsError(null);
    setSlotsNote(null);
    try {
      const res = await fetch(`/api/verein-portal/${token}/slots?serviceId=${serviceId}&date=${date}`, { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as { slots?: PortalSlot[]; note?: string; error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Slots konnten nicht geladen werden.");
      setSlots(payload.slots ?? []);
      setSlotsNote(payload.note ?? null);
      if (payload.error) setSlotsError(payload.error);
    } catch (e) {
      setSlots([]);
      setSlotsError(e instanceof Error ? e.message : "Slots konnten nicht geladen werden.");
    } finally {
      setSlotsLoading(false);
    }
  }, [token, serviceId, date]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const service = data?.services.find((s) => s.id === serviceId) ?? null;
  const upcoming = useMemo(
    () => (data?.bookings ?? []).filter((b) => (b.status === "BOOKED" || b.status === "REQUESTED") && !b.past),
    [data],
  );
  const history = useMemo(
    () => (data?.bookings ?? []).filter((b) => b.status === "CANCELED" || b.status === "REJECTED" || b.past).reverse(),
    [data],
  );

  async function sendRequest() {
    if (serviceId == null || !date) return;
    setRequesting(true);
    setRequestError(null);
    try {
      const res = await fetch(`/api/verein-portal/${token}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, date, start: reqStart, end: reqEnd, bookedBy: bookedBy.trim() || null, note: note.trim() || null }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Anfrage fehlgeschlagen.");
      try {
        if (bookedBy.trim()) localStorage.setItem(NAME_KEY, bookedBy.trim());
      } catch { /* egal */ }
      setSuccess(`Anfrage für ${fmtDay(date)}, ${reqStart}–${reqEnd} Uhr ist raus. Ihr seht unter „Meine Buchungen“, sobald wir sie freigeben.`);
      setRequestOpen(false);
      setNote("");
      await load();
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : "Anfrage fehlgeschlagen.");
    } finally {
      setRequesting(false);
    }
  }

  async function confirmBooking() {
    if (!picked || serviceId == null || !date) return;
    setBooking(true);
    setBookError(null);
    try {
      const res = await fetch(`/api/verein-portal/${token}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, date, slotStart: picked.startTime, bookedBy: bookedBy.trim() || null, note: note.trim() || null }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Buchung fehlgeschlagen.");
      try {
        if (bookedBy.trim()) localStorage.setItem(NAME_KEY, bookedBy.trim());
      } catch { /* egal */ }
      setSuccess(`${service?.name ?? "Slot"} am ${fmtDay(date)} um ${picked.startTime} ist gebucht.`);
      setPicked(null);
      setNote("");
      await Promise.all([load(), loadSlots()]);
    } catch (e) {
      setBookError(e instanceof Error ? e.message : "Buchung fehlgeschlagen.");
      loadSlots();
    } finally {
      setBooking(false);
    }
  }

  async function cancelBooking(b: PortalBooking) {
    const res = await fetch(`/api/verein-portal/${token}/bookings/${b.id}`, { method: "DELETE" });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(payload.error ?? "Stornieren fehlgeschlagen.");
    setSuccess(b.status === "REQUESTED"
      ? `Anfrage für ${fmtDay(b.date)} um ${b.slotStart} ist zurückgezogen.`
      : `Buchung am ${fmtDay(b.date)} um ${b.slotStart} ist storniert.`);
    await Promise.all([load(), loadSlots()]);
  }

  // Wochenleiste: Montag bis Sonntag der gewaehlten Woche, ausserhalb des
  // Buchungsfensters gesperrt.
  const bookWindow = data?.verein.window;
  const weekStart = date ? mondayOf(date) : null;
  const days = weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];
  const canPrev = !!(bookWindow && weekStart && weekStart > bookWindow.from);
  const canNext = !!(bookWindow && weekStart && addDays(weekStart, 7) <= bookWindow.to);
  const visibleSlots = (slots ?? []).filter((s) => s.state !== "past");

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col text-foreground">
      <header className="relative overflow-hidden rounded-b-card bg-primary-fill text-primary-foreground dark:bg-primary/60">
        <div aria-hidden className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="relative px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-5 sm:px-6">
          <p className="mb-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary-foreground/75">
            <Building2 className="size-3" /> {accountName} · Vereinsportal
          </p>
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 ring-1 ring-primary-foreground/30">
              <Users className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold sm:text-xl">{vereinName}</h1>
              <p className="text-xs text-primary-foreground/80">Slots selbst buchen, abgerechnet wird gesammelt.</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 pt-4 pb-8 sm:space-y-5 sm:px-6">
        {loadError && (
          <Notice tone="danger" title={loadError} action={<Button variant="outline" size="sm" onClick={load}>Erneut versuchen</Button>} />
        )}
        {!data && !loadError && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Lädt …
          </div>
        )}

        {data && (
          <>
            <AccessCard token={token} access={data.access} onChanged={load} />
            <Segmented
              aria-label="Ansicht"
              stretch
              value={tab}
              onValueChange={(v) => { setTab(v); setSuccess(null); }}
              options={[
                { value: "book", label: "Buchen" },
                { value: "mine", label: "Meine Buchungen", ...(upcoming.length > 0 ? { count: upcoming.length } : {}) },
              ]}
            />

            {success && (
              <Notice tone="success" icon={CheckCircle2} title={success} compact role="status" />
            )}

            {tab === "book" && (
              data.services.length === 0 ? (
                <Card>
                  <CardContent>
                    <EmptyState icon={CalendarDays} title="Für euren Verein ist noch nichts zum Buchen freigegeben." description="Meldet euch bei uns, dann schalten wir die Angebote frei." />
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Slot buchen</CardTitle>
                    <CardDescription>
                      Buchbar bis {fmtDay(data.verein.window.to, true)}. Kostenlos stornierbar bis {data.verein.cancelHours} Std. vorher.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.services.length > 1 ? (
                      <Segmented
                        aria-label="Angebot"
                        stretch
                        value={String(serviceId ?? "")}
                        onValueChange={(v) => setServiceId(Number(v))}
                        options={data.services.map((s) => ({ value: String(s.id), label: s.name }))}
                      />
                    ) : null}
                    {service && (
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{service.name}</span> · {formatCents(service.priceCents)} pro Slot
                      </p>
                    )}

                    {/* Woche: Pfeile wechseln, sieben Tage als Raster (nichts scrollt seitlich). */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Button variant="ghost" size="icon" aria-label="Vorige Woche" disabled={!canPrev}
                          onClick={() => weekStart && bookWindow && setDate(addDays(weekStart, -7) < bookWindow.from ? bookWindow.from : addDays(weekStart, -7))}>
                          <ChevronLeft />
                        </Button>
                        <span className="text-sm font-medium tabular-nums">
                          {weekStart && `${fmtDay(weekStart).slice(4)} – ${fmtDay(addDays(weekStart, 6), true).slice(4)}`}
                        </span>
                        <Button variant="ghost" size="icon" aria-label="Nächste Woche" disabled={!canNext}
                          onClick={() => weekStart && setDate(addDays(weekStart, 7))}>
                          <ChevronRight />
                        </Button>
                      </div>
                      <div className="grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Tag">
                        {days.map((d) => {
                          const disabled = !bookWindow || d < bookWindow.from || d > bookWindow.to;
                          const active = d === date;
                          return (
                            <button
                              key={d}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              disabled={disabled}
                              onClick={() => setDate(d)}
                              className={cn(
                                "press flex min-h-14 flex-col items-center justify-center rounded-tile text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                active ? "bg-primary-fill text-primary-foreground" : "glass-tile",
                                disabled && "opacity-40",
                              )}
                            >
                              <span className={cn("text-[11px]", active ? "text-primary-foreground/80" : "text-muted-foreground")}>{WEEKDAYS[weekdayOf(d)]}</span>
                              <span className="text-base font-semibold tabular-nums">{d.slice(8)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <SectionHeading
                        title={date ? fmtDay(date, true) : "Slots"}
                        aside={
                          <Button variant="ghost" size="icon-sm" aria-label="Slots neu laden" onClick={loadSlots} disabled={slotsLoading}>
                            <RefreshCw className={cn("size-3.5", slotsLoading && "animate-spin")} />
                          </Button>
                        }
                      />
                      {slotsLoading && !slots ? (
                        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Lädt …</div>
                      ) : slotsError ? (
                        <Notice tone="warning" icon={AlertTriangle} title={slotsError} compact />
                      ) : slotsNote ? (
                        <Notice tone="neutral" title={slotsNote} compact />
                      ) : visibleSlots.length === 0 ? (
                        <EmptyState size="sm" icon={Clock} title="An diesem Tag gibt es keine freien Slots." description="Fragt eure Wunschzeit an, wir prüfen sie und geben sie frei." />
                      ) : (
                        <div className={cn("grid grid-cols-2 gap-2 min-[380px]:grid-cols-3 sm:grid-cols-4", slotsLoading && "opacity-60")}>
                          {visibleSlots.map((s) => (
                            <button
                              key={s.startTime}
                              type="button"
                              disabled={s.state !== "free"}
                              onClick={() => { setPicked(s); setBookError(null); setSuccess(null); }}
                              className={cn(
                                "press flex min-h-14 flex-col items-center justify-center rounded-tile px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                s.state === "free" && "glass-tile hover:ring-1 hover:ring-primary/40",
                                s.state === "mine" && "bg-primary/12 ring-1 ring-primary/50",
                                s.state === "taken" && "glass-tile",
                              )}
                            >
                              <span className={cn("font-semibold tabular-nums", s.state === "taken" && "text-muted-foreground line-through")}>
                                {s.startTime}–{s.endTime}
                              </span>
                              <span className={cn("text-[11px]", s.state === "mine" ? "font-medium text-primary" : "text-muted-foreground")}>
                                {s.state === "free" ? "frei" : s.state === "mine" ? "eure Buchung" : "belegt"}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">Passt nichts? Fragt eine eigene Zeit an.</p>
                      <Button variant="outline" className="max-sm:h-11" disabled={!date} onClick={() => { setRequestError(null); setSuccess(null); setRequestOpen(true); }}>
                        <Send /> Wunschzeit anfragen
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            )}

            {tab === "mine" && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Kommende Buchungen ({upcoming.length})</CardTitle>
                    <CardDescription>Stornieren geht bis {data.verein.cancelHours} Std. vor Beginn, danach meldet euch bitte direkt.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {upcoming.length === 0 ? (
                      <EmptyState size="sm" icon={CalendarCheck} title="Ihr habt gerade nichts gebucht."
                        action={<Button variant="outline" size="sm" onClick={() => setTab("book")}>Slot buchen</Button>} />
                    ) : upcoming.map((b) => (
                      <BookingRow key={b.id} booking={b} onCancel={b.canCancel ? () => setCancelTarget(b) : undefined} />
                    ))}
                  </CardContent>
                </Card>
                {history.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Vergangen und storniert</CardTitle>
                      <CardDescription>Die letzten 90 Tage.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {history.map((b) => <BookingRow key={b.id} booking={b} />)}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}
      </main>

      <Dialog open={!!picked} onOpenChange={(o) => { if (!o && !booking) setPicked(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slot verbindlich buchen?</DialogTitle>
            <DialogDescription>
              {service?.name} · {date && fmtDay(date, true)} · {picked?.startTime}–{picked?.endTime}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="glass-tile flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted-foreground">Preis</span>
              <span className="font-semibold tabular-nums">{formatCents(service?.priceCents ?? 0)}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vp-name">Gebucht von *</Label>
              <Input id="vp-name" value={bookedBy} onChange={(e) => setBookedBy(e.target.value)} placeholder="Vor- und Nachname" maxLength={120} className="max-sm:h-11" autoComplete="name" required aria-required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vp-note">Bemerkung (optional)</Label>
              <Textarea id="vp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Namen der Teilnehmer oder Anmerkungen, z. B. Training Jugend" maxLength={500} rows={3} />
            </div>
            <p className="text-xs text-muted-foreground">
              Abgerechnet wird gesammelt. Kostenlos stornierbar bis {data?.verein.cancelHours ?? 48} Std. vorher.
            </p>
            {bookError && <Notice tone="danger" icon={XCircle} title={bookError} compact role="alert" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicked(null)} disabled={booking}>Abbrechen</Button>
            <Button onClick={confirmBooking} disabled={booking || !bookedBy.trim()}>
              {booking && <Loader2 className="animate-spin" />}
              Verbindlich buchen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requestOpen} onOpenChange={(o) => { if (!requesting) setRequestOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wunschzeit anfragen</DialogTitle>
            <DialogDescription>
              {service?.name} · {date && fmtDay(date, true)}. Wir prüfen die Anfrage und geben sie frei. Erst dann ist sie gebucht.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vr-start">Von</Label>
                <Input id="vr-start" type="time" step={900} value={reqStart} onChange={(e) => setReqStart(e.target.value)} className="max-sm:h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vr-end">Bis</Label>
                <Input id="vr-end" type="time" step={900} value={reqEnd} onChange={(e) => setReqEnd(e.target.value)} className="max-sm:h-11" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vr-name">Angefragt von *</Label>
              <Input id="vr-name" value={bookedBy} onChange={(e) => setBookedBy(e.target.value)} placeholder="Vor- und Nachname" maxLength={120} className="max-sm:h-11" autoComplete="name" required aria-required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vr-note">Bemerkung (optional)</Label>
              <Textarea id="vr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Namen der Teilnehmer oder Anmerkungen, z. B. Training Jugend, 8 Personen" maxLength={500} rows={3} />
            </div>
            {requestError && <Notice tone="danger" icon={XCircle} title={requestError} compact role="alert" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)} disabled={requesting}>Abbrechen</Button>
            <Button onClick={sendRequest} disabled={requesting || !reqStart || !reqEnd || !bookedBy.trim()}>
              {requesting && <Loader2 className="animate-spin" />}
              Anfrage senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        title={cancelTarget?.status === "REQUESTED" ? "Anfrage zurückziehen?" : "Buchung stornieren?"}
        description={cancelTarget ? `${cancelTarget.serviceName} am ${fmtDay(cancelTarget.date, true)} um ${cancelTarget.slotStart}.${cancelTarget.status === "REQUESTED" ? "" : " Der Slot wird wieder frei und nicht berechnet."}` : undefined}
        confirmLabel={cancelTarget?.status === "REQUESTED" ? "Zurückziehen" : "Stornieren"}
        cancelLabel="Behalten"
        onConfirm={async () => {
          if (cancelTarget) await cancelBooking(cancelTarget);
          setCancelTarget(null);
        }}
      />
    </div>
  );
}

function BookingRow({ booking: b, onCancel }: { booking: PortalBooking; onCancel?: () => void }) {
  const canceled = b.status === "CANCELED" || b.status === "REJECTED";
  const requested = b.status === "REQUESTED";
  return (
    <div className="glass-tile flex items-center gap-3 px-3 py-2.5">
      <IconChip icon={canceled ? XCircle : requested ? Hourglass : CalendarCheck} tone={canceled ? "neutral" : requested ? "warning" : "primary"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {fmtDay(b.date)} · <span className="tabular-nums">{b.slotStart}–{b.slotEnd}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {b.serviceName} · {formatCents(b.priceCents)}{b.bookedBy ? ` · ${b.bookedBy}` : ""}
        </p>
        {b.status === "REJECTED" && b.rejectReason && (
          <p className="text-xs text-muted-foreground">Abgelehnt: {b.rejectReason}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
        {requested && <Badge variant="warning">Angefragt</Badge>}
        {b.status === "REJECTED" ? (
          <Badge variant="neutral">Abgelehnt</Badge>
        ) : b.status === "CANCELED" ? (
          <Badge variant="neutral">Storniert</Badge>
        ) : b.past ? (
          <Badge variant={b.billed ? "success" : "neutral"}>{b.billed ? "Abgerechnet" : "Vorbei"}</Badge>
        ) : onCancel ? (
          <Button variant="outline" size="sm" onClick={onCancel}>{requested ? "Zurückziehen" : "Stornieren"}</Button>
        ) : (
          !requested && <Badge variant="neutral">Gebucht</Badge>
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
 * Zugang ausserhalb des Betriebs: Im Fenster der Buchung (mit Vor- und
 * Nachbereitung) oeffnen die Tasten Tor und Tueren; sonst steht nur, ab wann.
 */
function AccessCard({ token, access, onChanged }: { token: string; access: PortalAccess; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (access.points.length === 0 || !access.window) return null;

  if (!access.active) {
    return (
      <Notice tone="neutral" icon={KeyRound} title="Zugang zu eurer Buchung" compact>
        Tor und Türen öffnet ihr hier am {fmtWindowDay(access.window.from)} von {fmtWindowTime(access.window.from)} bis {fmtWindowTime(access.window.to)} Uhr
        ({access.leadMinutes} Min. Vorbereitung, {access.trailMinutes} Min. Nachbereitung).
      </Notice>
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
    <Card>
      <CardHeader>
        <CardTitle>Zugang</CardTitle>
        <CardDescription>Freigeschaltet bis {fmtWindowTime(access.window.to)} Uhr.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {access.points.map((p) => {
          const key = `${p.kind}:${p.id}`;
          return (
            <div key={key} className="glass-tile flex min-h-14 items-center gap-3 px-3 py-2">
              <IconChip icon={DoorOpen} tone="live" active={done === key} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
              <Button onClick={() => open(p)} disabled={busy !== null} className="max-sm:h-11" aria-label={`${p.name} öffnen`}>
                {busy === key ? <Loader2 className="animate-spin" /> : done === key ? <CheckCircle2 /> : <DoorOpen />}
                {done === key ? "Geöffnet" : "Öffnen"}
              </Button>
            </div>
          );
        })}
        {error && <Notice tone="danger" title={error} compact role="alert" />}
      </CardContent>
    </Card>
  );
}
