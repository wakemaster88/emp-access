"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarPlus, CheckCircle2, FileText, Loader2, PartyPopper, Receipt, Settings2, Trash2, Upload, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import {
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KINDS,
  formatEuro,
  formatEventDay,
  formatEventTime,
  MAX_DOCUMENT_BYTES,
  type VenueDocumentKind,
} from "@/lib/venue-event-rules";
import type { AdminEvent } from "@/lib/venue-events";
import {
  emptyEventForm, eventFormBody, eventFormError, eventFormFrom, EventFormFields,
  type EventFormState, type ExtraOption, type VenueOption,
} from "@/components/veranstaltungen/event-form";
import { EventRow, groupByMonth, monthLabel } from "@/components/veranstaltungen/event-row";

type Filter = "upcoming" | "past" | "canceled";

interface Change { at: string; by: string; byName: string | null; summary: string }

/**
 * Belegung der Veranstaltungsräume: Terminliste nach Monat, Termin anlegen
 * und bearbeiten, Dokumente aus DATEV hochladen, bestätigen, absagen,
 * abrechnen. Partner tragen über ihren Link selbst ein.
 */
export function VenueEventsBoard({
  venues,
  partners,
  extras,
  events: initialEvents,
  isAdmin,
  openId,
  today,
}: {
  venues: VenueOption[];
  partners: { id: number; name: string }[];
  extras: ExtraOption[];
  events: AdminEvent[];
  isAdmin: boolean;
  openId: number | null;
  today: string;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [editing, setEditing] = useState<AdminEvent | "new" | null>(() => initialEvents.find((e) => e.id === openId) ?? null);

  useEffect(() => setEvents(initialEvents), [initialEvents]);

  const visible = useMemo(() => {
    const rows = events.filter((e) => !areaFilter || e.areaId === Number(areaFilter));
    if (filter === "canceled") return rows.filter((e) => e.status === "CANCELED");
    if (filter === "past") return rows.filter((e) => e.status !== "CANCELED" && e.past).reverse();
    return rows.filter((e) => e.status !== "CANCELED" && !e.past);
  }, [events, filter, areaFilter]);

  const counts = useMemo(() => ({
    upcoming: events.filter((e) => e.status !== "CANCELED" && !e.past).length,
    open: events.filter((e) => e.status === "RESERVED" && !e.past).length,
  }), [events]);

  function upsert(e: AdminEvent) {
    setEvents((prev) => {
      const next = prev.some((x) => x.id === e.id) ? prev.map((x) => (x.id === e.id ? e : x)) : [...prev, e];
      return next.sort((a, b) => a.startDate.localeCompare(b.startDate));
    });
  }

  if (venues.length === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState
            icon={PartyPopper}
            title="Noch kein Veranstaltungsraum"
            description="Schalte unter Einstellungen eine Ressource wie die Rooftop Lounge als Veranstaltungsraum ein."
            action={isAdmin ? <Button asChild variant="outline" size="sm"><Link href="/veranstaltungen/einstellungen"><Settings2 /> Einstellungen</Link></Button> : undefined}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Belegung</CardTitle>
          <CardDescription>
            {counts.upcoming} kommende {counts.upcoming === 1 ? "Veranstaltung" : "Veranstaltungen"}
            {counts.open > 0 ? `, ${counts.open} noch nicht bestätigt` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Segmented
              aria-label="Termine"
              value={filter}
              onValueChange={setFilter}
              className="sm:flex-1"
              stretch
              options={[
                { value: "upcoming", label: "Kommend", ...(counts.upcoming ? { count: counts.upcoming } : {}) },
                { value: "past", label: "Vergangen" },
                { value: "canceled", label: "Abgesagt" },
              ]}
            />
            {venues.length > 1 && (
              <NativeSelect aria-label="Raum" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} containerClassName="sm:w-48">
                <option value="">Alle Räume</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </NativeSelect>
            )}
            <Button onClick={() => setEditing("new")} className="max-sm:h-11">
              <CalendarPlus /> Termin anlegen
            </Button>
          </div>

          {visible.length === 0 ? (
            <EmptyState size="sm" icon={PartyPopper}
              title={filter === "upcoming" ? "Keine kommenden Veranstaltungen." : filter === "past" ? "Keine vergangenen Veranstaltungen in den letzten Monaten." : "Keine abgesagten Termine."} />
          ) : (
            groupByMonth(visible).map((g) => (
              <section key={g.month} className="space-y-2">
                <SectionHeading title={monthLabel(`${g.month}-01`)} />
                {g.rows.map((e) => (
                  <EventRow key={e.id} event={e} showArea={venues.length > 1} onOpen={() => setEditing(e)} />
                ))}
              </section>
            ))
          )}
        </CardContent>
      </Card>

      <EventDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={(e) => { upsert(e); setEditing(e); }}
        venues={venues}
        partners={partners}
        extras={extras}
        isAdmin={isAdmin}
        today={today}
      />
    </>
  );
}

function EventDialog({
  target, onClose, onSaved, venues, partners, extras, isAdmin, today,
}: {
  target: AdminEvent | "new" | null;
  onClose: () => void;
  onSaved: (e: AdminEvent) => void;
  venues: VenueOption[];
  partners: { id: number; name: string }[];
  extras: ExtraOption[];
  isAdmin: boolean;
  today: string;
}) {
  const router = useRouter();
  const event = target && target !== "new" ? target : null;
  const [form, setForm] = useState<EventFormState>(() => emptyEventForm(venues[0]?.id, today));
  const [partnerId, setPartnerId] = useState("");
  const [actualGuests, setActualGuests] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "cancel" | { docId: number; label: string }>(null);
  const eventId = event?.id ?? null;

  // Formular nur beim Öffnen bzw. Wechsel des Termins neu befüllen.
  useEffect(() => {
    if (!target) return;
    setError(null);
    setConfirm(null);
    if (target === "new") {
      setForm(emptyEventForm(venues[0]?.id, today));
      setPartnerId(partners.length === 1 ? String(partners[0].id) : "");
      setActualGuests("");
      setInternalNote("");
      setChanges([]);
      return;
    }
    setForm(eventFormFrom(target));
    setPartnerId(target.partnerId ? String(target.partnerId) : "");
    setActualGuests(target.actualGuests != null ? String(target.actualGuests) : "");
    setInternalNote(target.internalNote ?? "");
    fetch(`/api/veranstaltungen/events/${target.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { changes: Change[] } | null) => setChanges(d?.changes ?? []))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, target === "new"]);

  async function call(url: string, init: RequestInit): Promise<AdminEvent> {
    const res = await fetch(url, init);
    const payload = (await res.json().catch(() => ({}))) as { event?: AdminEvent; error?: string };
    if (!res.ok || !payload.event) throw new Error(payload.error ?? "Das hat nicht geklappt.");
    onSaved(payload.event);
    router.refresh();
    const d = await fetch(`/api/veranstaltungen/events/${payload.event.id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d?.changes) setChanges(d.changes);
    return payload.event;
  }

  async function save() {
    const venue = venues.find((v) => v.id === Number(form.areaId));
    const invalid = eventFormError(form, venue);
    if (invalid) { setError(invalid); return; }
    const guestsRaw = actualGuests.trim();
    if (guestsRaw && !/^\d+$/.test(guestsRaw)) { setError("Tatsächliche Personen: bitte eine Zahl."); return; }
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...eventFormBody(form),
        internalNote: internalNote.trim() || null,
        ...(event ? { actualGuests: guestsRaw ? Number(guestsRaw) : null } : { partnerId: partnerId ? Number(partnerId) : null }),
      };
      await call(event ? `/api/veranstaltungen/events/${event.id}` : "/api/veranstaltungen/events", {
        method: event ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function action(name: "confirm" | "cancel" | "billed" | "unbilled" | "reopen") {
    if (!event) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/api/veranstaltungen/events/${event.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name }),
      });
      setConfirm(null);
    } catch (e) {
      if (name === "cancel") throw e;
      setError(e instanceof Error ? e.message : "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDoc(docId: number) {
    if (!event) return;
    const res = await fetch(`/api/veranstaltungen/documents/${docId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Entfernen fehlgeschlagen.");
    const d = await fetch(`/api/veranstaltungen/events/${event.id}`, { cache: "no-store" }).then((r) => r.json());
    onSaved(d.event);
    setChanges(d.changes ?? []);
    setConfirm(null);
    router.refresh();
  }

  const canceled = event?.status === "CANCELED";
  const venueList = event && !venues.some((v) => v.id === event.areaId)
    ? [...venues, { id: event.areaId, name: event.areaName, bufferMinutes: 0, capacity: null }]
    : venues;

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{event ? event.title : "Termin anlegen"}</DialogTitle>
          <DialogDescription>
            {event
              ? `${event.areaName} · ${formatEventDay(event.date)} · ${formatEventTime(event.startTime, event.endTime)}${event.partnerName ? ` · ${event.partnerName}` : ""}`
              : "Eigener Termin oder für einen Partner. Überschneidungen samt Auf- und Abbau werden abgelehnt."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62dvh] space-y-5 overflow-y-auto">
          {canceled && <Notice tone="neutral" icon={XCircle} title={`Abgesagt${event?.canceledBy === "PARTNER" ? " vom Partner" : ""}.`} compact />}

          {!event && partners.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="ve-partner">Für</Label>
              <NativeSelect id="ve-partner" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">Eigener Termin</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </div>
          )}

          <EventFormFields
            idPrefix="ve"
            form={form}
            onChange={setForm}
            venues={venueList}
            extras={extras}
            booked={event?.extras ?? []}
            disabled={canceled}
          />

          {event && (
            <div className="space-y-1.5">
              <Label htmlFor="ve-actual">Personen (tatsächlich)</Label>
              <Input id="ve-actual" inputMode="numeric" value={actualGuests} onChange={(e) => setActualGuests(e.target.value)}
                placeholder="Nach der Veranstaltung" className="max-sm:h-11" disabled={canceled} />
              <p className="text-xs text-muted-foreground">Zählt für Zusatzleistungen je Person. Der Partner kann sie auch selbst melden.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ve-internal">Interne Notiz</Label>
            <Textarea id="ve-internal" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={2} maxLength={2000}
              placeholder="Sieht der Partner nicht" disabled={canceled} />
          </div>

          {event && (
            <DocumentsSection event={event} isAdmin={isAdmin} onUploaded={(e) => { onSaved(e); router.refresh(); }}
              onDelete={(docId, label) => setConfirm({ docId, label })} />
          )}

          {event && changes.length > 0 && (
            <div className="space-y-2">
              <SectionHeading title="Verlauf" />
              <ul className="space-y-1 text-xs text-muted-foreground">
                {changes.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 tabular-nums">{new Date(c.at).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="min-w-0">{c.summary} · {c.by === "PARTNER" ? "Partner" : "Team"}{c.byName ? ` (${c.byName})` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error && <Notice tone="danger" title={error} compact role="alert" />}

        {confirm === "cancel" ? (
          <ConfirmStep
            title="Termin absagen?"
            description={event?.partnerId ? "Der Raum wird wieder frei. Der Partner bekommt eine Mail." : "Der Raum wird wieder frei."}
            confirmLabel="Absagen"
            icon={XCircle}
            onConfirm={() => action("cancel")}
            onCancel={() => setConfirm(null)}
          />
        ) : confirm ? (
          <ConfirmStep
            title={`${confirm.label} entfernen?`}
            description="Die Datei ist danach auch für den Partner weg."
            confirmLabel="Entfernen"
            icon={Trash2}
            onConfirm={() => deleteDoc(confirm.docId)}
            onCancel={() => setConfirm(null)}
          />
        ) : (
          <DialogFooter className="flex-wrap gap-2">
            {event && !canceled && (
              <>
                <Button variant="outline" className="sm:mr-auto" onClick={() => setConfirm("cancel")} disabled={busy}>
                  <XCircle /> Absagen
                </Button>
                {event.status === "RESERVED" && (
                  <Button variant="outline" onClick={() => action("confirm")} disabled={busy}>
                    <CheckCircle2 /> Bestätigen
                  </Button>
                )}
                <Button variant="outline" onClick={() => action(event.billed ? "unbilled" : "billed")} disabled={busy}>
                  <Receipt /> {event.billed ? "Nicht abgerechnet" : "Abgerechnet"}
                </Button>
              </>
            )}
            {canceled ? (
              <Button onClick={() => action("reopen")} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Wieder aufnehmen
              </Button>
            ) : (
              <Button onClick={save} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} {event ? "Speichern" : "Anlegen"}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Dokumente aus DATEV: Liste zum Ansehen, Hochladen für Admins. */
function DocumentsSection({
  event, isAdmin, onUploaded, onDelete,
}: {
  event: AdminEvent;
  isAdmin: boolean;
  onUploaded: (e: AdminEvent) => void;
  onDelete: (docId: number, label: string) => void;
}) {
  const nextKind: VenueDocumentKind = !event.documents.some((d) => d.kind === "ORDER_CONFIRMATION")
    ? "ORDER_CONFIRMATION"
    : !event.documents.some((d) => d.kind === "DEPOSIT_INVOICE")
      ? "DEPOSIT_INVOICE"
      : "FINAL_INVOICE";
  const [kind, setKind] = useState<VenueDocumentKind>(nextKind);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => setKind(nextKind), [nextKind]);

  async function upload() {
    if (!file) { setError("Bitte eine PDF-Datei wählen."); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { setError("Die Datei ist größer als 4 MB."); return; }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", kind);
      fd.set("reference", reference);
      fd.set("amount", amount);
      fd.set("notify", notify ? "1" : "0");
      const res = await fetch(`/api/veranstaltungen/events/${event.id}/documents`, { method: "POST", body: fd });
      const payload = (await res.json().catch(() => ({}))) as { event?: AdminEvent; error?: string };
      if (!res.ok || !payload.event) throw new Error(payload.error ?? "Hochladen fehlgeschlagen.");
      onUploaded(payload.event);
      setFile(null);
      setReference("");
      setAmount("");
      setInputKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hochladen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <SectionHeading title="Dokumente" description="Auftragsbestätigung, Anzahlungs- und Schlussrechnung aus DATEV. Der Partner sieht sie bei seinem Termin." />
      {event.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Dokumente.</p>
      ) : (
        <div className="glass-tile divide-y divide-border">
          {event.documents.map((d) => (
            <div key={d.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <a href={`/api/veranstaltungen/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-sm hover:underline">
                <span className="block truncate font-medium">{DOCUMENT_KIND_LABEL[d.kind]}{d.reference ? ` ${d.reference}` : ""}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {new Date(d.createdAt).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}
                  {d.amountCents != null ? ` · ${formatEuro(d.amountCents)}` : ""} · {d.fileName}
                </span>
              </a>
              {event.partnerId && <Badge variant={d.viewed ? "success" : "neutral"} className="max-sm:hidden">{d.viewed ? "Gesehen" : "Ungesehen"}</Badge>}
              {isAdmin && (
                <Button variant="ghost" size="icon-sm" aria-label={`${DOCUMENT_KIND_LABEL[d.kind]} entfernen`} onClick={() => onDelete(d.id, DOCUMENT_KIND_LABEL[d.kind])}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && event.status !== "CANCELED" && (
        <div className="glass-tile space-y-3 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ve-doc-kind">Art</Label>
              <NativeSelect id="ve-doc-kind" value={kind} onChange={(e) => setKind(e.target.value as VenueDocumentKind)}>
                {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ve-doc-file">PDF (bis 4 MB)</Label>
              <Input key={inputKey} id="ve-doc-file" type="file" accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ve-doc-ref">Nummer (optional)</Label>
              <Input id="ve-doc-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} placeholder="z. B. RE-2026-0142" className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ve-doc-amount">Betrag brutto (optional)</Label>
              <Input id="ve-doc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00 €" className="max-sm:h-11" />
            </div>
          </div>
          {event.partnerId && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <Checkbox checked={notify} onCheckedChange={(v) => setNotify(!!v)} />
              Partner per Mail informieren (ohne Anhang, mit Link)
            </label>
          )}
          {kind === "ORDER_CONFIRMATION" && event.status === "RESERVED" && (
            <p className="text-xs text-muted-foreground">Mit der Auftragsbestätigung gilt der Termin als bestätigt.</p>
          )}
          {kind === "FINAL_INVOICE" && (
            <p className="text-xs text-muted-foreground">Mit der Schlussrechnung gilt der Termin als abgerechnet; der Partner ändert dann nichts mehr.</p>
          )}
          {error && <Notice tone="danger" title={error} compact role="alert" />}
          <div className="flex justify-end">
            <Button variant="outline" onClick={upload} disabled={busy || !file}>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />} Hochladen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
