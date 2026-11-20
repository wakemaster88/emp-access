"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
<<<<<<< HEAD
  CalendarPlus, CheckCircle2, FileText, Loader2, PartyPopper, Pencil, Users, XCircle,
=======
  Building2, CalendarPlus, CheckCircle2, FileText, Loader2, PartyPopper, Pencil, Users, XCircle,
>>>>>>> origin/claude/project-thread-iy5t9v
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
  billableGuests,
  DOCUMENT_KIND_LABEL,
  extraLineCents,
  formatEuro,
  formatEventDay,
  formatEventTime,
  STATUS_LABEL,
  UNIT_LABEL,
} from "@/lib/venue-event-rules";
import type { PartnerEvent } from "@/lib/venue-events";
import {
  emptyEventForm, eventFormBody, eventFormError, eventFormFrom, EventFormFields,
  type EventFormState, type ExtraOption, type VenueOption,
} from "@/components/veranstaltungen/event-form";
import { EventRow, groupByMonth, monthLabel } from "@/components/veranstaltungen/event-row";

interface PortalData {
  partner: { name: string; accountName: string; editLockHours: number; horizon: { from: string; to: string } };
  venues: VenueOption[];
  extras: ExtraOption[];
  events: PartnerEvent[];
  busy: { areaId: number; date: string; startTime: string; endTime: string }[];
}

type Tab = "mine" | "calendar" | "past";
const NAME_KEY = "partner-portal-name";

function readName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
}
function storeName(name: string) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* privat */ }
}

/**
 * Partnerzugang (öffentlich über geheimen Link): eigene Veranstaltungen
 * eintragen und ändern, Personenzahl melden, Zusatzleistungen wählen,
 * Auftragsbestätigung und Rechnungen ansehen. Fremde Termine erscheinen nur
 * als „belegt“.
 */
<<<<<<< HEAD
export function PartnerPortalClient({
  token, partnerName, accountName, partnerLogoUrl, accountLogoUrl, venueNames,
}: {
  token: string;
  partnerName: string;
  accountName: string;
  partnerLogoUrl: string | null;
  accountLogoUrl: string | null;
  venueNames: string[];
}) {
=======
export function PartnerPortalClient({ token, partnerName, accountName }: { token: string; partnerName: string; accountName: string }) {
>>>>>>> origin/claude/project-thread-iy5t9v
  const [data, setData] = useState<PortalData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("mine");
  const [open, setOpen] = useState<PartnerEvent | "new" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
<<<<<<< HEAD
  const wide = useWide();
=======
>>>>>>> origin/claude/project-thread-iy5t9v

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/partner-portal/${token}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "Dieser Link ist nicht (mehr) gültig." : "Laden fehlgeschlagen.");
      setData((await res.json()) as PortalData);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Laden fehlgeschlagen.");
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const upcoming = useMemo(() => (data?.events ?? []).filter((e) => e.status !== "CANCELED" && !e.past), [data]);
  const history = useMemo(() => (data?.events ?? []).filter((e) => e.status === "CANCELED" || e.past).reverse(), [data]);
  const openReports = useMemo(
    () => (data?.events ?? []).filter((e) => e.past && e.canReportGuests && e.actualGuests == null && e.status !== "CANCELED"),
    [data],
  );

  function onSaved(e: PartnerEvent, message: string) {
    setData((prev) => prev && ({
      ...prev,
      events: (prev.events.some((x) => x.id === e.id) ? prev.events.map((x) => (x.id === e.id ? e : x)) : [...prev.events, e])
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    }));
    setSuccess(message);
    load();
  }

<<<<<<< HEAD
  const next = upcoming[0] ?? null;
  const venueTitle = venueNames.length === 1 ? venueNames[0] : "Veranstaltungen";
  const showTabsCalendar = !wide;
  const view: Tab = !showTabsCalendar && tab === "calendar" ? "mine" : tab;
  const startNew = () => { setSuccess(null); setOpen("new"); };

  return (
    <>
      <header className="pp-hero">
        <SkylineArt />
        <div className="pp-wrap">
          <div className="pp-brandbar">
            <div className="pp-logos">
              {accountLogoUrl ? (
                <span className="pp-logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={accountLogoUrl} alt={accountName} referrerPolicy="no-referrer" />
                </span>
              ) : (
                <span className="pp-wordmark">{accountName}<small>{venueTitle}</small></span>
              )}
              <span className="pp-x" aria-hidden>×</span>
              {partnerLogoUrl ? (
                <span className="pp-logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={partnerLogoUrl} alt={partnerName} referrerPolicy="no-referrer" />
                </span>
              ) : (
                <span className="pp-monogram" aria-label={partnerName}>{partnerName.trim().charAt(0).toUpperCase()}</span>
              )}
            </div>
          </div>
          <p className="pp-kicker">Partnerzugang {partnerName}</p>
          <h1 className="pp-title">{venueTitle}</h1>
          <p className="pp-sub">
            Hier tragt ihr eure Veranstaltungen ein, meldet die Personenzahl, wählt Zusatzleistungen und findet Auftragsbestätigung und Rechnungen.
          </p>
          {data && data.venues.length > 0 && (
            <button type="button" className="pp-cta" onClick={startNew}>
              <CalendarPlus aria-hidden /> Veranstaltung eintragen
            </button>
          )}
        </div>
      </header>

      <div className="pp-wrap">
        <div className="pp-stats" aria-label="Überblick">
          <div className="pp-stat">
            <p className="pp-stat-label">Nächste</p>
            <p className="pp-stat-value">{next ? formatEventDay(next.date, false).slice(4) : "–"}</p>
            <p className="pp-stat-hint">{next ? next.title : "nichts geplant"}</p>
          </div>
          <div className="pp-stat">
            <p className="pp-stat-label">Kommend</p>
            <p className="pp-stat-value">{data ? upcoming.length : "–"}</p>
            <p className="pp-stat-hint">{upcoming.length === 1 ? "Veranstaltung" : "Veranstaltungen"}</p>
          </div>
          <div className="pp-stat">
            <p className="pp-stat-label">Gäste</p>
            <p className="pp-stat-value">{data ? upcoming.reduce((n, e) => n + e.guestCount, 0) : "–"}</p>
            <p className="pp-stat-hint">geplant</p>
          </div>
        </div>
      </div>

      <main className="pp-wrap flex-1 space-y-4 pt-4 pb-8 sm:space-y-5 sm:pt-6">
=======
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col text-foreground">
      <header className="rounded-b-card bg-primary-fill text-primary-foreground dark:bg-primary/60">
        <div className="px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-5 sm:px-6">
          <p className="mb-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary-foreground/75">
            <Building2 className="size-3" /> {accountName} · Partnerzugang
          </p>
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 ring-1 ring-primary-foreground/30">
              <PartyPopper className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold sm:text-xl">{partnerName}</h1>
              <p className="text-xs text-primary-foreground/80">Veranstaltungen eintragen, Personen melden, Dokumente ansehen.</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 pt-4 pb-8 sm:space-y-5 sm:px-6">
>>>>>>> origin/claude/project-thread-iy5t9v
        {loadError && (
          <Notice tone="danger" title={loadError} action={<Button variant="outline" size="sm" onClick={load}>Erneut versuchen</Button>} />
        )}
        {!data && !loadError && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Lädt …
          </div>
        )}

        {data && data.venues.length === 0 && (
          <Notice tone="neutral" title="Für euch ist noch kein Raum freigeschaltet." compact>Bitte meldet euch bei uns.</Notice>
        )}

        {data && data.venues.length > 0 && (
<<<<<<< HEAD
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
            <div className="min-w-0 space-y-4">
              {openReports.length > 0 && (
                <Notice tone="warning" icon={Users} title="Bitte tatsächliche Personenzahl melden" compact>
                  {openReports.map((e) => `${e.title} (${formatEventDay(e.date)})`).join(", ")}
                </Notice>
              )}

              <Segmented
                aria-label="Ansicht"
                stretch
                value={view}
                onValueChange={(v) => { setTab(v); setSuccess(null); }}
                options={[
                  { value: "mine", label: "Kommend", ...(upcoming.length ? { count: upcoming.length } : {}) },
                  ...(showTabsCalendar ? [{ value: "calendar" as const, label: "Belegung" }] : []),
                  { value: "past", label: "Vergangen" },
                ]}
              />

              {success && <Notice tone="success" icon={CheckCircle2} title={success} compact role="status" />}

              {view === "mine" && (
                <Card>
                  <CardHeader>
                    <CardTitle>Eure Veranstaltungen</CardTitle>
                    <CardDescription>Ändern und absagen geht bis {data.partner.editLockHours} Std. vor Beginn, danach meldet euch bitte direkt.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {upcoming.length === 0 ? (
                      <EmptyState
                        icon={PartyPopper}
                        title="Noch keine Veranstaltung eingetragen"
                        description="Tragt Datum, Uhrzeit und Personenzahl ein. Der Raum ist dann für euch geblockt, wir bestätigen mit der Auftragsbestätigung."
                        action={<Button onClick={startNew} className="max-sm:h-11"><CalendarPlus /> Veranstaltung eintragen</Button>}
                      />
                    ) : groupByMonth(upcoming).map((g) => (
                      <section key={g.month} className="space-y-2">
                        <SectionHeading title={monthLabel(`${g.month}-01`)} />
                        {g.rows.map((e) => <EventRow key={e.id} event={e} showArea={data.venues.length > 1} onOpen={() => { setSuccess(null); setOpen(e); }} />)}
                      </section>
                    ))}
                  </CardContent>
                </Card>
              )}

              {view === "calendar" && <OccupancyCard data={data} onOpen={(e) => setOpen(e)} />}

              {view === "past" && (
                <Card>
                  <CardHeader>
                    <CardTitle>Vergangen und abgesagt</CardTitle>
                    <CardDescription>Die letzten sechs Monate, mit Rechnungen.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {history.length === 0
                      ? <EmptyState size="sm" icon={PartyPopper} title="Noch nichts." />
                      : history.map((e) => <EventRow key={e.id} event={e} showArea={data.venues.length > 1} onOpen={() => setOpen(e)} />)}
                  </CardContent>
                </Card>
              )}
            </div>

            {wide && <OccupancyCard data={data} onOpen={(e) => setOpen(e)} />}
          </div>
        )}
      </main>

      <footer className="pp-footer">{accountName} · {venueTitle} · Partnerzugang für {partnerName}</footer>

=======
          <>
            <Button className="w-full max-sm:h-11" onClick={() => { setSuccess(null); setOpen("new"); }}>
              <CalendarPlus /> Veranstaltung eintragen
            </Button>

            {openReports.length > 0 && (
              <Notice tone="warning" icon={Users} title="Bitte tatsächliche Personenzahl melden" compact>
                {openReports.map((e) => `${e.title} (${formatEventDay(e.date)})`).join(", ")}
              </Notice>
            )}

            <Segmented
              aria-label="Ansicht"
              stretch
              value={tab}
              onValueChange={(v) => { setTab(v); setSuccess(null); }}
              options={[
                { value: "mine", label: "Kommend", ...(upcoming.length ? { count: upcoming.length } : {}) },
                { value: "calendar", label: "Belegung" },
                { value: "past", label: "Vergangen" },
              ]}
            />

            {success && <Notice tone="success" icon={CheckCircle2} title={success} compact role="status" />}

            {tab === "mine" && (
              <Card>
                <CardHeader>
                  <CardTitle>Eure Veranstaltungen</CardTitle>
                  <CardDescription>Ändern und absagen geht bis {data.partner.editLockHours} Std. vor Beginn, danach meldet euch bitte direkt.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {upcoming.length === 0 ? (
                    <EmptyState size="sm" icon={PartyPopper} title="Gerade nichts eingetragen." />
                  ) : groupByMonth(upcoming).map((g) => (
                    <section key={g.month} className="space-y-2">
                      <SectionHeading title={monthLabel(`${g.month}-01`)} />
                      {g.rows.map((e) => <EventRow key={e.id} event={e} showArea={data.venues.length > 1} onOpen={() => { setSuccess(null); setOpen(e); }} />)}
                    </section>
                  ))}
                </CardContent>
              </Card>
            )}

            {tab === "calendar" && <OccupancyCard data={data} onOpen={(e) => setOpen(e)} />}

            {tab === "past" && (
              <Card>
                <CardHeader>
                  <CardTitle>Vergangen und abgesagt</CardTitle>
                  <CardDescription>Die letzten sechs Monate, mit Rechnungen.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {history.length === 0
                    ? <EmptyState size="sm" icon={PartyPopper} title="Noch nichts." />
                    : history.map((e) => <EventRow key={e.id} event={e} showArea={data.venues.length > 1} onOpen={() => setOpen(e)} />)}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>

>>>>>>> origin/claude/project-thread-iy5t9v
      {data && (
        <PartnerEventDialog
          token={token}
          target={open}
          data={data}
          onClose={() => setOpen(null)}
          onSaved={(e, msg) => { onSaved(e, msg); setOpen(null); }}
        />
      )}
<<<<<<< HEAD
    </>
  );
}

/** Breiter Bildschirm (ab 1024 px): Belegung steht dann daneben statt als eigener Reiter. */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

/** Feine Skyline mit Dachterrasse und Lichterkette, rechts unten im Kopf. */
function SkylineArt() {
  return (
    <svg className="pp-hero-art" viewBox="0 0 560 180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M0 180V120h40V96h36v84M76 180V70h52v110M128 180V108h30v72M158 180V58h86v122M244 180V100h34v80M278 180V40h120v140M398 180V86h44v94M442 180V112h46v68M488 180V76h72v104" />
      <path d="M278 40V22M398 40V22M278 22h120" />
      <path d="M284 22c18 12 36 12 54 0s36-12 54 0" strokeDasharray="1 7" strokeLinecap="round" strokeWidth="4" />
      <path d="M298 40v-10h10v10M330 40v-14M326 26h8M362 40v-10h10v10" />
      <path d="M170 74h12M196 74h12M220 74h12M170 96h12M196 96h12M220 96h12M290 60h14M318 60h14M346 60h14M374 60h14M290 84h14M318 84h14M346 84h14M374 84h14M88 86h10M108 86h10M88 108h10M108 108h10M500 94h12M528 94h12M500 116h12M528 116h12" />
    </svg>
=======
    </div>
>>>>>>> origin/claude/project-thread-iy5t9v
  );
}

/** Belegung der kommenden Monate: eigene Termine mit Titel, fremde nur als „belegt“. */
function OccupancyCard({ data, onOpen }: { data: PortalData; onOpen: (e: PartnerEvent) => void }) {
  const showArea = data.venues.length > 1;
  const venueName = (id: number) => data.venues.find((v) => v.id === id)?.name ?? "";
  const rows = [
    ...data.events
      .filter((e) => e.status !== "CANCELED" && !e.past)
      .map((e) => ({ key: `e${e.id}`, date: e.date, startTime: e.startTime, endTime: e.endTime, areaId: e.areaId, own: e as PartnerEvent | null })),
    ...data.busy.map((b, i) => ({ key: `b${i}`, ...b, own: null as PartnerEvent | null })),
  ].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Belegung</CardTitle>
        <CardDescription>Alle belegten Zeiten, auch von anderen. Zwischen zwei Veranstaltungen bleibt Zeit für Auf- und Abbau.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <EmptyState size="sm" icon={CalendarPlus} title="Noch ist alles frei." />
        ) : groupByMonth(rows).map((g) => (
          <section key={g.month} className="space-y-2">
            <SectionHeading title={monthLabel(`${g.month}-01`)} />
            <div className="glass-tile divide-y divide-border">
              {g.rows.map((r) => {
                const content = (
                  <>
                    <span className="w-20 shrink-0 text-sm tabular-nums">{formatEventDay(r.date, false)}</span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block tabular-nums">
                        {formatEventTime(r.startTime, r.endTime)}
                        {showArea ? <span className="text-muted-foreground"> · {venueName(r.areaId)}</span> : null}
                      </span>
                      <span className={r.own ? "block truncate font-medium text-primary" : "block text-muted-foreground"}>
                        {r.own ? r.own.title : "belegt"}
                      </span>
                    </span>
                  </>
                );
                return r.own ? (
                  <button key={r.key} type="button" onClick={() => onOpen(r.own!)} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-foreground/[0.03]">{content}</button>
                ) : (
                  <div key={r.key} className="flex min-h-11 items-center gap-3 px-3 py-2">{content}</div>
                );
              })}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function PartnerEventDialog({
  token, target, data, onClose, onSaved,
}: {
  token: string;
  target: PartnerEvent | "new" | null;
  data: PortalData;
  onClose: () => void;
  onSaved: (e: PartnerEvent, message: string) => void;
}) {
  const event = target && target !== "new" ? target : null;
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [form, setForm] = useState<EventFormState>(() => emptyEventForm(data.venues[0]?.id, data.partner.horizon.from));
  const [byName, setByName] = useState("");
  const [guests, setGuests] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setError(null);
    setConfirmCancel(false);
    setByName(readName());
    if (target === "new") {
      setForm(emptyEventForm(data.venues[0]?.id, data.partner.horizon.from));
      setMode("edit");
    } else {
      setForm(eventFormFrom(target));
      setGuests(target.actualGuests != null ? String(target.actualGuests) : "");
      setMode("view");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function request(url: string, init: RequestInit, message: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const payload = (await res.json().catch(() => ({}))) as { event?: PartnerEvent; error?: string };
      if (!res.ok || !payload.event) throw new Error(payload.error ?? "Das hat nicht geklappt.");
      if (byName.trim()) storeName(byName.trim());
      onSaved(payload.event, message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Das hat nicht geklappt.");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const invalid = eventFormError(form, data.venues.find((v) => v.id === Number(form.areaId)));
    if (invalid) { setError(invalid); return; }
    if (!byName.trim()) { setError("Bitte euren Namen angeben."); return; }
    const body = JSON.stringify({ ...eventFormBody(form), byName: byName.trim() });
    await request(
      event ? `/api/partner-portal/${token}/events/${event.id}` : `/api/partner-portal/${token}`,
      { method: event ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body },
      event ? "Änderung gespeichert. Wir sind informiert." : "Eingetragen. Wir melden uns mit der Auftragsbestätigung.",
    ).catch(() => undefined);
  }

  async function reportGuests() {
    if (!event) return;
    if (!/^\d+$/.test(guests.trim())) { setError("Bitte eine Zahl angeben."); return; }
    await request(
      `/api/partner-portal/${token}/events/${event.id}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actualGuests: Number(guests), byName: byName.trim() || null }) },
      "Personenzahl gemeldet. Danke!",
    ).catch(() => undefined);
  }

  async function cancel() {
    if (!event) return;
    await request(
      `/api/partner-portal/${token}/events/${event.id}?by=${encodeURIComponent(byName.trim())}`,
      { method: "DELETE" },
      "Abgesagt. Der Raum ist wieder frei.",
    );
  }

  const started = event ? new Date(event.startDate).getTime() <= Date.now() : false;
  const guestsForBilling = event ? billableGuests(event) : 0;

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{event ? (mode === "edit" ? "Veranstaltung ändern" : event.title) : "Veranstaltung eintragen"}</DialogTitle>
          <DialogDescription>
            {event
              ? `${event.areaName} · ${formatEventDay(event.date)} · ${formatEventTime(event.startTime, event.endTime)}`
              : "Der Raum ist damit für euch geblockt. Wir bestätigen mit der Auftragsbestätigung."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62dvh] space-y-5 overflow-y-auto">
          {mode === "edit" ? (
            <>
              <EventFormFields idPrefix="pp" form={form} onChange={setForm} venues={data.venues} extras={data.extras} booked={event?.extras ?? []} />
              <div className="space-y-1.5">
                <Label htmlFor="pp-by">Eingetragen von *</Label>
                <Input id="pp-by" value={byName} onChange={(e) => setByName(e.target.value)} maxLength={120} placeholder="Vor- und Nachname"
                  autoComplete="name" className="max-sm:h-11" />
              </div>
            </>
          ) : event && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={event.status === "CONFIRMED" ? "success" : event.status === "CANCELED" ? "neutral" : "warning"}>{STATUS_LABEL[event.status]}</Badge>
                {event.billed && <Badge variant="info">Abgerechnet</Badge>}
                {event.hostName && <span className="text-sm text-muted-foreground">{event.hostName}</span>}
              </div>

              <div className="glass-tile divide-y divide-border text-sm">
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-muted-foreground">Personen geplant</span>
                  <span className="font-medium tabular-nums">{event.guestCount}</span>
                </div>
                {event.actualGuests != null && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="text-muted-foreground">Personen tatsächlich</span>
                    <span className="font-medium tabular-nums">{event.actualGuests}</span>
                  </div>
                )}
                {event.extras.map((x, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate">{x.name}{x.unit === "PER_PIECE" ? ` × ${x.quantity}` : ""}</span>
                      <span className="block text-xs text-muted-foreground">{formatEuro(x.unitPriceCents)} {UNIT_LABEL[x.unit]}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatEuro(extraLineCents(x, guestsForBilling))}</span>
                  </div>
                ))}
                {event.extras.length > 0 && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 font-semibold">
                    <span>Zusatzleistungen netto</span>
                    <span className="tabular-nums">{formatEuro(event.extrasTotalCents)}</span>
                  </div>
                )}
              </div>
              {event.note && <p className="text-sm whitespace-pre-line text-muted-foreground">{event.note}</p>}

              <div className="space-y-2">
                <SectionHeading title="Dokumente" />
                {event.documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Auftragsbestätigung und Rechnungen erscheinen hier, sobald wir sie hochgeladen haben.</p>
                ) : (
                  <div className="glass-tile divide-y divide-border">
                    {event.documents.map((d) => (
                      <a key={d.id} href={`/api/partner-portal/${token}/documents/${d.id}`} target="_blank" rel="noopener noreferrer"
                        className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm hover:bg-foreground/[0.03]">
                        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{DOCUMENT_KIND_LABEL[d.kind]}{d.reference ? ` ${d.reference}` : ""}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {new Date(d.createdAt).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}
                            {d.amountCents != null ? ` · ${formatEuro(d.amountCents)}` : ""}
                          </span>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {event.canReportGuests && started && (
                <div className="glass-tile space-y-2 p-3">
                  <Label htmlFor="pp-actual">Tatsächliche Personenzahl</Label>
                  <div className="flex gap-2">
                    <Input id="pp-actual" inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value)} className="max-sm:h-11" />
                    <Button onClick={reportGuests} disabled={busy} className="max-sm:h-11">Melden</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Danach rechnen wir Leistungen je Person ab.</p>
                </div>
              )}
              {!event.canEdit && event.reason && event.status !== "CANCELED" && (
                <p className="text-xs text-muted-foreground">{event.reason}</p>
              )}
            </>
          )}
        </div>

        {error && <Notice tone="danger" title={error} compact role="alert" />}

        {confirmCancel ? (
          <ConfirmStep title="Veranstaltung absagen?" description="Der Raum wird wieder frei. Wir bekommen Bescheid." confirmLabel="Absagen" icon={XCircle}
            onConfirm={cancel} onCancel={() => setConfirmCancel(false)} />
        ) : mode === "edit" ? (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => (event ? setMode("view") : onClose())} disabled={busy}>Abbrechen</Button>
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} {event ? "Speichern" : "Eintragen"}</Button>
          </DialogFooter>
        ) : event?.canEdit ? (
          <DialogFooter className="gap-2">
            <Button variant="outline" className={cn("sm:mr-auto")} onClick={() => setConfirmCancel(true)} disabled={busy}><XCircle /> Absagen</Button>
            <Button onClick={() => { setError(null); setMode("edit"); }} disabled={busy}><Pencil /> Ändern</Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Schließen</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
