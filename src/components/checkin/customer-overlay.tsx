"use client";

/**
 * Kundenfenster an der Kasse (Bändchen am Kunden, lib/chips).
 *
 * Bändchen scannen → Person, Zahlen, letzte Käufe und ein Vorschlag aus der
 * Historie. Ein Klick verkauft (Kurse und anny-Slots öffnen das Formular).
 * Leihbändchen und unbekannte Bändchen bekommen einen Vorschlag nach Uhrzeit,
 * der Kunde ist freiwillig. Stammgäste ohne Konto bekommen „Konto anlegen“.
 * Abo läuft: „Einchecken“. anny-Buchung: Personen der Bestellung mit Bändchen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronDown, Clock, CreditCard, History, Info, Loader2, LogIn, Nfc, ScanLine,
  Search, Sparkles, Ticket, Undo2, User, UserPlus, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { initials, type ChipView, type ChipViewTicket } from "@/lib/chip-rules";
import type { ServiceData } from "./checkin-types";
import { OverlayGrip, overlayScrimClass, overlaySheetClass } from "./checkin-ui";
import { postTicketWithRetry, safeJson } from "./add-ticket-overlay";
import { canQuickSell, quickSalePayload, shortServiceName } from "./quick-sale";

export interface FormSalePrefill {
  serviceId?: number;
  rfidCode?: string;
  firstName?: string;
  lastName?: string;
  personId?: number;
  focusRfid?: boolean;
}

interface Conflict {
  reason: string;
  message: string;
  holderId: number | null;
  holderName: string | null;
  runningAbo: boolean;
  payload: Record<string, unknown>;
  label: string;
}

interface Done {
  ticketId: number;
  label: string;
}

type Mode = "main" | "search" | "konto" | "other";

const TZ = "Europe/Berlin";
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" });
const fmtWeekday = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { timeZone: TZ, weekday: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const berlinDay = (iso: string | Date) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });

const STATE_BADGE: Record<string, "neutral" | "live" | "info" | "warning" | "danger"> = {
  neu: "info",
  aktiv: "live",
  läuft: "live",
  eingelöst: "neutral",
  abgelaufen: "neutral",
  storniert: "danger",
  pausiert: "warning",
};

/** Genitiv: „Mias Bändchen“, aber „Lukas’ Bändchen“. */
function genitive(name: string): string {
  return /(s|ß|x|z)$/i.test(name) ? `${name}’` : `${name}s`;
}

function personName(v: ChipView): string | null {
  const p = v.person;
  if (!p) return null;
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || null;
}

function codeTail(code: string | null): string {
  if (!code) return "";
  return code.length > 6 ? code.slice(-4).toUpperCase() : code.toUpperCase();
}

/** Ein Abo, das heute gilt. */
function activeAbo(v: ChipView): ChipViewTicket | null {
  return v.active.find((t) => t.kind === "ABO" && t.personal) ?? v.active.find((t) => t.kind === "ABO") ?? null;
}

export function CustomerOverlay({
  token,
  services,
  initial,
  photo,
  onClose,
  onOpenTicket,
  canOpen,
  onFormSale,
  onChanged,
}: {
  token: string;
  services: ServiceData[];
  initial: ChipView;
  /** Kassenfoto des gescannten Tickets (Abo), zum Abgleich. */
  photo?: string | null;
  onClose: () => void;
  onOpenTicket: (ticketId: number) => void;
  /** Ticket steht in der Liste des Monitors und lässt sich öffnen. */
  canOpen: (ticketId: number) => boolean;
  onFormSale: (prefill: FormSalePrefill) => void;
  onChanged: (newTicketId?: number) => void;
}) {
  const [view, setView] = useState<ChipView>(initial);
  const [mode, setMode] = useState<Mode>("main");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Neuer Scan = neues Fenster: der Monitor setzt dafür einen neuen `key`.

  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const name = personName(view);
  const first = view.person?.firstName || name;
  const abo = activeAbo(view);
  const stammgast = !view.person && view.owner === "KUNDE" && view.openTickets >= 2;
  const leih = view.owner === "BETRIEB" && !view.person;
  const staff = view.owner === "MITARBEITER";
  const suggested = view.suggestion.serviceId != null ? byId.get(view.suggestion.serviceId) ?? null : null;

  const reload = useCallback(async (personId?: number | null) => {
    const sp = new URLSearchParams();
    if (view.code) sp.set("code", view.code);
    const pid = personId !== undefined ? personId : view.person?.id ?? null;
    if (pid != null) sp.set("personId", String(pid));
    if (view.anny) sp.set("annyTicketId", String(view.anny.tickets.find((t) => t.booker)?.id ?? view.anny.tickets[0]?.id ?? ""));
    const res = await fetch(`/api/checkin/public/${token}/kunde?${sp}`, { cache: "no-store" });
    const json = await safeJson(res);
    if (res.ok && json?.customer) setView(json.customer as unknown as ChipView);
  }, [token, view.code, view.person?.id, view.anny]);

  async function sell(svcId: number, extra: { shareCode?: boolean; transferCode?: boolean; personId?: number | null } = {}) {
    const svc = byId.get(svcId);
    if (!svc) return;
    setMenuOpen(false);
    setError("");
    const personId = extra.personId !== undefined ? extra.personId : view.person?.id ?? null;
    if (!canQuickSell(svc)) {
      onFormSale({
        serviceId: svc.id,
        rfidCode: view.code ?? undefined,
        firstName: view.person?.firstName ?? undefined,
        lastName: view.person?.lastName ?? undefined,
        personId: personId ?? undefined,
      });
      return;
    }
    const payload = quickSalePayload(svc, {
      code: view.code,
      personId,
      firstName: view.person?.firstName,
      lastName: view.person?.lastName,
    });
    if (extra.shareCode) payload.shareCode = true;
    if (extra.transferCode) payload.transferCode = true;
    setBusy(`sell:${svc.id}`);
    try {
      const res = await postTicketWithRetry(token, payload);
      const json = await safeJson(res);
      if (res.status === 409) {
        const err = (json?.error ?? {}) as Record<string, unknown>;
        if (err.code === "CODE_CONFLICT") {
          setConflict({
            reason: String(err.reason ?? ""),
            message: Array.isArray(err.formErrors) ? String(err.formErrors[0] ?? "") : "",
            holderId: typeof err.holderId === "number" ? err.holderId : null,
            holderName: typeof err.holderName === "string" ? err.holderName : null,
            runningAbo: err.runningAbo === true,
            payload,
            label: shortServiceName(svc.name),
          });
          return;
        }
      }
      if (!res.ok) {
        const err = (json?.error ?? null) as { formErrors?: string[] } | string | null;
        setError((typeof err === "object" && err?.formErrors?.[0]) || (typeof err === "string" ? err : "") || `Verkauf fehlgeschlagen (HTTP ${res.status})`);
        return;
      }
      const id = typeof json?.id === "number" ? json.id : null;
      setConflict(null);
      if (id != null) setDone({ ticketId: id, label: shortServiceName(svc.name) });
      onChanged(id ?? undefined);
      await reload(personId);
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    } finally {
      setBusy(null);
    }
  }

  async function undo() {
    if (!done) return;
    setBusy("undo");
    setError("");
    try {
      const res = await fetch(`/api/checkin/public/${token}/kunde`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", ticketId: done.ticketId }),
      });
      const json = await safeJson(res);
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : "Rückgängig hat nicht geklappt.");
        return;
      }
      setDone(null);
      onChanged();
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function checkin(ticketIds: number[]) {
    setBusy("checkin");
    setError("");
    try {
      let failure: string | null = null;
      for (const id of ticketIds) {
        const res = await fetch(`/api/checkin/public/${token}/checkin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: id }),
        });
        const json = await safeJson(res);
        if (!json?.success && !failure) failure = typeof json?.message === "string" ? json.message : "Einchecken hat nicht geklappt.";
      }
      if (failure) setError(failure);
      onChanged();
      await reload();
    } finally {
      setBusy(null);
    }
  }

  // ---------------------------------------------------------------------------

  const header = (() => {
    const badges: React.ReactNode[] = [];
    let title: React.ReactNode;
    let avatar: React.ReactNode;
    if (view.person) {
      title = (
        <>
          {name ?? "Kunde"}
          {view.person.age != null && <span className="ml-1.5 text-base font-normal text-muted-foreground">({view.person.age})</span>}
        </>
      );
      avatar = photo
        // eslint-disable-next-line @next/next/no-img-element -- Kassenfoto als Data-URL, wie im Ticket-Fenster
        ? <img src={photo} alt="" className="size-14 shrink-0 rounded-tile object-cover sm:size-16" />
        : <span className="flex size-14 shrink-0 items-center justify-center rounded-tile bg-primary-fill text-lg font-semibold text-primary-foreground sm:size-16 sm:text-xl">{initials(view.person.firstName, view.person.lastName)}</span>;
      if (view.code) {
        badges.push(
          <Badge key="chip" variant="info"><Nfc />{view.owner === "BETRIEB" ? `Betriebsbändchen bei ${first}` : `Bändchen gehört ${first}`}</Badge>,
        );
      }
      if (view.person.customer) badges.push(<Badge key="konto" variant="secondary"><User />Konto {view.person.customer.email}</Badge>);
      if (view.person.inApp) badges.push(<Badge key="app" variant="live">In der App</Badge>);
      if (abo) badges.push(<Badge key="abo" variant="secondary"><CreditCard />{abo.label}{abo.endDate ? ` bis ${fmtDate(abo.endDate)}` : ""}</Badge>);
    } else {
      avatar = (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-tile bg-glass-tile text-muted-foreground ring-1 ring-inset ring-border sm:size-16">
          <Nfc className="size-7" />
        </span>
      );
      if (staff) {
        title = "Mitarbeiter-Bändchen";
      } else if (leih) {
        title = `Leihbändchen ${codeTail(view.code)}`;
        badges.push(<Badge key="own" variant="secondary">gehört dem Betrieb</Badge>);
        const inUse = view.lastGuest?.inUse ?? false;
        badges.push(<Badge key="free" variant={inUse ? "warning" : "live"}>{inUse ? "in Benutzung" : "frei"}</Badge>);
      } else if (!view.known) {
        title = "Unbekanntes Bändchen";
        badges.push(<Badge key="new" variant="secondary">noch nie gescannt</Badge>);
        badges.push(<Badge key="own" variant="neutral">nicht vom Betrieb</Badge>);
      } else if (stammgast) {
        title = "Stammgast ohne Konto";
        badges.push(<Badge key="n" variant="info">{view.openTickets} Besuche mit diesem Bändchen</Badge>);
        badges.push(<Badge key="k" variant="neutral">kein Kundenkonto</Badge>);
        if (view.lastName?.firstName) badges.push(<Badge key="name" variant="secondary">Name am letzten Ticket: {view.lastName.firstName}</Badge>);
      } else {
        title = "Bändchen ohne Kunde";
        if (view.lastName && (view.lastName.firstName || view.lastName.lastName)) {
          badges.push(<Badge key="name" variant="secondary">Name am Ticket: {[view.lastName.firstName, view.lastName.lastName].filter(Boolean).join(" ")}</Badge>);
        }
      }
    }
    return (
      <div className="flex items-start gap-3 border-b border-border p-4 sm:gap-4 sm:p-5">
        {avatar}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold leading-tight text-foreground sm:text-2xl">{title}</h2>
          {badges.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5 [&>*]:max-w-full [&>*]:shrink [&>*]:whitespace-normal [&>*]:text-left">{badges}</div>}
        </div>
        <Button
          variant="secondary"
          size="icon-lg"
          onClick={onClose}
          className="size-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
          aria-label="Schließen"
        >
          <X className="size-5" />
        </Button>
      </div>
    );
  })();

  const stats = (view.person || stammgast) && (view.stats.visits > 0 || view.history.length > 0) ? (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        { v: String(view.stats.visits), l: `Besuche ${view.stats.year}` },
        { v: String(view.stats.starts), l: `Starts ${view.stats.year}` },
        { v: view.stats.awards == null ? "–" : String(view.stats.awards), l: view.stats.awards == null ? "Awards (nur mit Konto)" : "Awards" },
        { v: view.stats.lastVisit ? (berlinDay(view.stats.lastVisit) === berlinDay(new Date()) ? "heute" : fmtDay(view.stats.lastVisit)) : "–", l: "Letzter Besuch" },
      ].map((s) => (
        <div key={s.l} className="glass-tile rounded-tile px-3 py-2.5">
          <p className="text-lg font-semibold tabular-nums text-foreground">{s.v}</p>
          <p className="text-xs text-muted-foreground">{s.l}</p>
        </div>
      ))}
    </div>
  ) : null;

  const sectionTitle = (icon: React.ReactNode, text: string) => (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {text}
    </p>
  );

  // Dropdown „Anderes Ticket“: Suche, häufig bei der Person, weitere.
  const menu = menuOpen ? (
    <ServiceMenu
      services={services}
      frequent={[
        ...(view.suggestion.basis === "history" && view.suggestion.serviceId != null ? [{ serviceId: view.suggestion.serviceId, count: view.suggestion.count }] : []),
        ...(view.suggestion.basis === "history" ? view.suggestion.frequent : []),
      ]}
      frequentTitle={view.person ? `Häufig bei ${first}` : view.suggestion.basis === "history" ? "Häufig mit diesem Bändchen" : null}
      busy={busy}
      onPick={(id) => void sell(id)}
    />
  ) : null;

  const otherButton = (label: string) => (
    <Button
      type="button"
      variant="outline"
      onClick={() => setMenuOpen((o) => !o)}
      aria-expanded={menuOpen}
      className="h-12 justify-between font-semibold sm:h-14 sm:min-w-56"
    >
      {label}
      <ChevronDown className={cn("transition-transform", menuOpen && "rotate-180")} />
    </Button>
  );

  const suggestion = (() => {
    if (staff) {
      return <Notice tone="warning" title="Mitarbeiter-Bändchen">Auf dieses Bändchen wird nichts verkauft. Der Gast bekommt ein eigenes Bändchen.</Notice>;
    }
    if (view.blocked) {
      return <Notice tone="danger" title="Bändchen gesperrt">Auf dieses Bändchen kann nichts verkauft werden.</Notice>;
    }
    if (abo && !done) {
      const checked = abo.checkedInToday;
      return (
        <div className="space-y-2">
          {sectionTitle(<Sparkles className="size-3.5" />, "Vorschlag")}
          <div className="rounded-card border border-primary/30 bg-primary/[0.06] p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-tile bg-primary/10 text-primary"><CreditCard className="size-5" /></span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-foreground sm:text-lg">Einchecken mit {abo.label}</p>
                <p className="text-sm text-muted-foreground">Abo läuft, nichts zu bezahlen. {checked ? "Heute schon eingecheckt." : "Heute noch nicht gefahren."}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={() => void checkin([abo.id])}
                disabled={checked || busy != null}
                className="h-12 flex-1 text-base font-semibold sm:h-14"
              >
                {busy === "checkin" ? <Loader2 className="animate-spin" /> : <Check />}
                {checked ? "Eingecheckt" : "Einchecken"}
              </Button>
              {otherButton("Zusätzlich verkaufen")}
            </div>
            {menu}
          </div>
        </div>
      );
    }
    if (done) return null;
    const svc = suggested;
    const duration = svc?.defaultValidityType === "DURATION";
    const reason = view.suggestion.basis === "history"
      ? `${view.suggestion.count} von ${view.suggestion.of} ${view.suggestion.of === 1 ? "Besuch" : "Besuchen"}${view.suggestion.lastAt ? `, zuletzt am ${fmtDay(view.suggestion.lastAt)}` : ""}`
      : view.suggestion.basis === "hour"
        ? "Am häufigsten verkauft um diese Uhrzeit"
        : null;
    return (
      <div className="space-y-2">
        {sectionTitle(<Sparkles className="size-3.5" />, svc ? "Vorschlag" : "Ticket")}
        <div className={cn("rounded-card p-3 sm:p-4", svc ? "border border-primary/30 bg-primary/[0.06]" : "glass-tile")}>
          {svc && (
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-tile bg-primary/10 text-primary">
                {duration ? <Clock className="size-5" /> : <Ticket className="size-5" />}
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-foreground sm:text-lg">{svc.name}</p>
                <p className="text-sm text-muted-foreground">
                  {[reason, duration ? "startet beim ersten Scan" : null, !canQuickSell(svc) ? "Termin im nächsten Schritt" : null].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
          )}
          <div className={cn("flex flex-col gap-2 sm:flex-row", svc && "mt-3")}>
            {svc && (
              <Button
                type="button"
                onClick={() => void sell(svc.id)}
                disabled={busy != null}
                className="h-12 flex-1 text-base font-semibold sm:h-14"
              >
                {busy === `sell:${svc.id}` ? <Loader2 className="animate-spin" /> : <Ticket />}
                {shortServiceName(svc.name)} {canQuickSell(svc) ? "verkaufen" : "auswählen"}
              </Button>
            )}
            {otherButton(svc ? "Anderes Ticket" : "Ticket wählen")}
          </div>
          {menu}
        </div>
      </div>
    );
  })();

  const doneCard = done ? (
    <div className="rounded-card border border-success/30 bg-success/[0.07] p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"><Check className="size-6" /></span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground sm:text-lg">{done.label} {first ? `für ${first} ` : ""}angelegt</p>
          <p className="text-sm text-muted-foreground">
            {view.code ? (first ? `${genitive(first)} Bändchen ist freigeschaltet.` : "Das Bändchen ist freigeschaltet.") : "Das Ticket ist angelegt."}
            {view.person ? ` Starts zählen weiter auf ${first}.` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={onClose} className="h-12 flex-1 text-base font-semibold sm:h-14">Fertig</Button>
        <Button type="button" variant="outline" onClick={() => void undo()} disabled={busy != null} className="h-12 font-semibold sm:h-14 sm:min-w-44">
          {busy === "undo" ? <Loader2 className="animate-spin" /> : <Undo2 />}
          Rückgängig
        </Button>
      </div>
    </div>
  ) : null;

  const conflictCard = conflict ? (
    <Notice tone="warning" title="Bändchen bereits vergeben">
      <p>{conflict.message}</p>
      {conflict.runningAbo && <p className="mt-1 font-medium text-foreground">Übergeben nimmt einem laufenden Abo das Bändchen.</p>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {conflict.reason === "OTHER_PERSON" && conflict.holderId != null && (
          <Button type="button" onClick={() => { const id = Number(conflict.payload.serviceId); setConflict(null); void sell(id, { personId: conflict.holderId }); }} className="h-11 font-semibold sm:h-12">
            Für {conflict.holderName ?? "die Person"} verkaufen
          </Button>
        )}
        {(conflict.reason === "STAFF" || conflict.reason === "AMBIGUOUS") && (
          <Button type="button" onClick={() => { const id = Number(conflict.payload.serviceId); setConflict(null); void sell(id, { shareCode: true }); }} className="h-11 font-semibold sm:h-12">
            Trotzdem verkaufen
          </Button>
        )}
        {conflict.reason !== "BLOCKED" && conflict.reason !== "STAFF" && (
          <Button type="button" variant="outline" onClick={() => { const id = Number(conflict.payload.serviceId); setConflict(null); void sell(id, { transferCode: true }); }} className="h-11 font-semibold sm:h-12">
            {conflict.reason === "LEIH_IN_USE" ? "Bändchen freigeben und verkaufen" : "Bändchen übergeben"}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => setConflict(null)} className="h-11 font-semibold sm:h-12">Abbrechen</Button>
      </div>
    </Notice>
  ) : null;

  const activeDay = view.active.filter((t) => t.kind === "TICKET" && !(done && t.id === done.ticketId));
  const activeCard = activeDay.length > 0 && !view.anny ? (
    <div className="space-y-2">
      {activeDay.map((t) => (
        <Notice
          key={t.id}
          tone="info"
          icon={Clock}
          compact
          title={`Heute gültig: ${t.label}`}
          action={canOpen(t.id) ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenTicket(t.id)} className="h-11 font-semibold">Ticket öffnen</Button>
          ) : undefined}
        >
          {t.state === "neu" ? "noch nicht gestartet" : t.checkedInToday ? "eingecheckt" : "läuft"}
        </Notice>
      ))}
    </div>
  ) : null;

  const whoSection = !view.person && !staff && !view.blocked && !done && !view.anny ? (
    stammgast ? (
      <Notice
        tone="info"
        icon={UserPlus}
        title="Kundenkonto anlegen?"
        actionAlign="start"
      >
        <p>Mit Name und E-Mail werden die {view.openTickets} Besuche{view.stats.starts > 0 ? ` und ${view.stats.starts} Starts` : ""} übernommen, Awards nachträglich vergeben und der Gast bekommt den Link zur App.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={() => setMode("konto")} className="h-11 font-semibold sm:h-12"><UserPlus />Konto anlegen</Button>
          <Button type="button" variant="outline" onClick={() => setMode("search")} className="h-11 font-semibold sm:h-12"><Search />Ist schon Kunde</Button>
        </div>
      </Notice>
    ) : (
      <div className="space-y-2">
        {sectionTitle(<User className="size-3.5" />, leih ? "Für wen?" : "Wem gehört das Bändchen? (freiwillig)")}
        {view.ambiguous.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {view.ambiguous.map((p) => (
              <Button key={p.id} type="button" variant="outline" onClick={() => void reload(p.id)} className="h-11 font-semibold">{p.name}</Button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" onClick={() => setMode("search")} className="h-12 font-semibold sm:h-14"><Search />Kunde suchen</Button>
          <Button type="button" variant="outline" onClick={() => setMode("konto")} className="h-12 font-semibold sm:h-14"><UserPlus />Neuer Kunde</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {leih
            ? "Ohne Namen geht es auch. Mit E-Mail bekommt der Gast ein Kundenkonto. Behält er das Bändchen, gehört es ab dann ihm."
            : "Ohne Kunde hängt das Bändchen nur an diesem Ticket. Mit Kunde wird es als Bändchen des Kunden gespeichert, und beim nächsten Besuch kommt der Vorschlag aus seiner Historie."}
        </p>
      </div>
    )
  ) : null;

  const otherGuest = view.person && !view.anny && !done && !abo && mode === "main" ? (
    <button type="button" onClick={() => setMode("other")} className="min-h-11 text-left text-sm font-medium text-primary underline-offset-4 hover:underline">
      Ticket für jemand anderen?
    </button>
  ) : null;

  const history = view.history.length > 0 ? (
    <div className="space-y-2">
      {sectionTitle(<History className="size-3.5" />, view.person || stammgast ? "Letzte Käufe" : "Tickets mit diesem Bändchen")}
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border">
        {view.history.map((t) => {
          const today = berlinDay(t.at) === berlinDay(new Date());
          const meta = [
            fmtWeekday(t.createdAt),
            `${fmtTime(t.createdAt)} Uhr`,
            t.starts > 0 ? `${t.starts} ${t.starts === 1 ? "Start" : "Starts"}` : null,
            t.source === "ANNY" ? "über anny" : null,
            !view.person && (t.firstName || t.lastName) ? `Name „${[t.firstName, t.lastName].filter(Boolean).join(" ")}“` : null,
          ].filter(Boolean).join(" · ");
          const openable = canOpen(t.id);
          const Row = openable ? "button" : "div";
          return (
            <Row
              key={t.id}
              {...(openable ? { type: "button" as const, onClick: () => onOpenTicket(t.id) } : {})}
              className={cn("flex w-full min-h-14 items-center gap-3 px-3 py-2.5 text-left sm:px-4", openable && "hover:bg-glass-tile")}
            >
              <span className="w-16 shrink-0 text-sm tabular-nums text-muted-foreground sm:w-20">{today ? "heute" : fmtDate(t.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="block line-clamp-2 text-sm font-semibold text-foreground">{t.label}</span>
                <span className="block line-clamp-2 text-xs text-muted-foreground">{meta}</span>
              </span>
              <Badge variant={STATE_BADGE[t.state] ?? "neutral"}>{t.state}</Badge>
            </Row>
          );
        })}
      </div>
    </div>
  ) : leih && view.lastGuest ? (
    <Notice tone="neutral" icon={Info} compact title={`Letzter Gast: ${fmtDate(view.lastGuest.at)}`}>
      {view.lastGuest.label}{view.lastGuest.inUse ? ", heute noch gültig." : ", abgelaufen. Das Bändchen wird ohne Rückfrage für das neue Ticket frei."}
    </Notice>
  ) : null;

  return (
    <div className={cn("fixed inset-0 z-50 flex items-end justify-center sm:items-center", overlayScrimClass)} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Kundenfenster"
        className={cn(overlaySheetClass, "monitor-scrollbar max-h-[94dvh] w-full overflow-y-auto pb-[env(safe-area-inset-bottom)] sm:max-w-2xl")}
      >
        <OverlayGrip />
        {header}
        <div className="space-y-4 p-4 sm:p-5">
          {mode === "search" && (
            <PersonSearch
              token={token}
              onCancel={() => setMode("main")}
              onPick={async (id) => { setMode("main"); await reload(id); }}
            />
          )}
          {mode === "konto" && (
            <KontoForm
              token={token}
              view={view}
              sellService={suggested && canQuickSell(suggested) ? suggested : null}
              onCancel={() => setMode("main")}
              onCreated={async (next, sellId) => {
                setView(next);
                setMode("main");
                onChanged();
                if (sellId != null && next.person) await sell(sellId, { personId: next.person.id });
              }}
            />
          )}
          {mode === "other" && view.person && (
            <Notice tone="info" title={first ? `Anderer Gast mit ${genitive(first)} Bändchen?` : "Anderer Gast mit diesem Bändchen?"}>
              <p>Ein Ticket für jemand anderen bekommt ein eigenes Bändchen. {first ? `${genitive(first)} Abo und Statistik bleiben` : "Abo und Statistik des Kunden bleiben"} an diesem Bändchen.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button type="button" onClick={() => setMode("main")} className="h-11 font-semibold sm:h-12">Für {first} verkaufen</Button>
                <Button type="button" variant="outline" onClick={() => onFormSale({ focusRfid: true })} className="h-11 font-semibold sm:h-12">
                  <ScanLine />Neues Bändchen für anderen Gast
                </Button>
              </div>
            </Notice>
          )}
          {mode === "main" && (
            <>
              {stats}
              {view.anny && (
                <AnnyCard
                  token={token}
                  view={view}
                  busy={busy}
                  onCheckin={(ids) => void checkin(ids)}
                  onChanged={async () => { onChanged(); await reload(); }}
                  menuButton={otherButton("Zusätzlich verkaufen")}
                  menu={menu}
                />
              )}
              {activeCard}
              {doneCard}
              {conflictCard}
              {!view.anny && suggestion}
              {otherGuest}
              {error && <Notice tone="danger" compact title={error} />}
              {whoSection}
              {history}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ServiceMenu({
  services,
  frequent,
  frequentTitle,
  busy,
  onPick,
}: {
  services: ServiceData[];
  frequent: Array<{ serviceId: number; count: number }>;
  frequentTitle: string | null;
  busy: string | null;
  onPick: (serviceId: number) => void;
}) {
  const [q, setQ] = useState("");
  const byId = new Map(services.map((s) => [s.id, s]));
  const term = q.trim().toLowerCase();
  const match = (s: ServiceData) => !term || s.name.toLowerCase().includes(term);
  const freq = frequent.map((f) => ({ ...f, svc: byId.get(f.serviceId) })).filter((f) => f.svc && match(f.svc));
  const freqIds = new Set(freq.map((f) => f.serviceId));
  const rest = services.filter((s) => !freqIds.has(s.id) && match(s)).sort((a, b) => a.name.localeCompare(b.name, "de"));
  const item = (s: ServiceData, count?: number) => (
    <button
      key={s.id}
      type="button"
      disabled={busy != null}
      onClick={() => onPick(s.id)}
      className="flex w-full min-h-12 items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-glass-tile disabled:opacity-60"
    >
      {s.defaultValidityType === "DURATION" ? <Clock className="size-4 shrink-0 text-muted-foreground" /> : <Ticket className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{s.name}</span>
      {count != null && <span className="text-xs tabular-nums text-muted-foreground">{count}×</span>}
      {busy === `sell:${s.id}` && <Loader2 className="size-4 animate-spin" />}
    </button>
  );
  return (
    <div className="mt-3 space-y-2 rounded-tile border border-border bg-popover p-2">
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticket suchen" aria-label="Ticket suchen" className="h-11" />
      <div className="max-h-80 overflow-y-auto">
        {freq.length > 0 && frequentTitle && (
          <>
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{frequentTitle}</p>
            {freq.map((f) => item(f.svc!, f.count))}
          </>
        )}
        {rest.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{freq.length > 0 ? "Weitere" : "Alle Tickets"}</p>
            {rest.map((s) => item(s))}
          </>
        )}
        {freq.length === 0 && rest.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">Kein Ticket gefunden.</p>}
      </div>
    </div>
  );
}

interface FoundPerson {
  id: number;
  firstName: string | null;
  lastName: string | null;
  age: number | null;
  email: string | null;
  chips: number;
  tickets: number;
}

function PersonSearch({ token, onCancel, onPick }: { token: string; onCancel: () => void; onPick: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<FoundPerson[] | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function search(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    const term = value.trim();
    const mine = ++seq.current;
    if (term.length < 2) {
      setRows(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/checkin/public/${token}/kunde?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const json = await safeJson(res);
        if (mine === seq.current) setRows(Array.isArray(json?.persons) ? (json.persons as unknown as FoundPerson[]) : []);
      } catch {
        if (mine === seq.current) setRows([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
  }
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Search className="size-3.5" />Kunde suchen</p>
      <SearchInput autoFocus value={q} onChange={(e) => search(e.target.value)} placeholder="Name oder E-Mail" aria-label="Kunde suchen" className="h-12" />
      {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Suche …</p>}
      {rows && rows.length === 0 && !loading && <p className="text-sm text-muted-foreground">Niemand gefunden. Leg ein Konto an oder verkauf ohne Kunde.</p>}
      {rows && rows.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-card border border-border">
          {rows.map((p) => (
            <button key={p.id} type="button" onClick={() => onPick(p.id)} className="flex w-full min-h-14 items-center gap-3 px-3 py-2 text-left hover:bg-glass-tile">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{initials(p.firstName, p.lastName)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {[p.firstName, p.lastName].filter(Boolean).join(" ") || "Ohne Namen"}
                  {p.age != null && <span className="font-normal text-muted-foreground"> ({p.age})</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[p.email, `${p.tickets} ${p.tickets === 1 ? "Ticket" : "Tickets"}`, p.chips > 0 ? `${p.chips} ${p.chips === 1 ? "Bändchen" : "Bändchen"}` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" onClick={onCancel} className="h-12 w-full font-semibold sm:h-14">Zurück</Button>
    </div>
  );
}

function KontoForm({
  token,
  view,
  sellService,
  onCancel,
  onCreated,
}: {
  token: string;
  view: ChipView;
  sellService: ServiceData | null;
  onCancel: () => void;
  onCreated: (view: ChipView, sellServiceId: number | null) => void;
}) {
  const [firstName, setFirstName] = useState(view.lastName?.firstName ?? "");
  const [lastName, setLastName] = useState(view.lastName?.lastName ?? "");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [owner, setOwner] = useState<"KUNDE" | "BETRIEB">(view.owner === "BETRIEB" ? "BETRIEB" : "KUNDE");
  const [adopt, setAdopt] = useState(view.openTickets > 0 && view.owner !== "BETRIEB");
  const [sendLink, setSendLink] = useState(true);
  const [busy, setBusy] = useState<"sell" | "only" | null>(null);
  const [error, setError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const prefilled = !!view.lastName?.firstName;

  async function submit(sell: boolean) {
    setError("");
    if (!email.trim()) {
      setError("Die E-Mail-Adresse fehlt.");
      emailRef.current?.focus();
      return;
    }
    setBusy(sell ? "sell" : "only");
    try {
      const res = await fetch(`/api/checkin/public/${token}/kunde`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "konto",
          code: view.code,
          firstName,
          lastName,
          email,
          birthDate: birthDate || null,
          owner,
          adopt,
          sendLink,
        }),
      });
      const json = await safeJson(res);
      if (!res.ok || !json?.customer) {
        setError(typeof json?.error === "string" ? json.error : "Konto anlegen hat nicht geklappt.");
        return;
      }
      onCreated(json.customer as unknown as ChipView, sell && sellService ? sellService.id : null);
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    } finally {
      setBusy(null);
    }
  }

  const label = "text-[13px] font-medium text-muted-foreground";
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(sellService != null); }}
      className="space-y-4"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><UserPlus className="size-3.5" />Kundenkonto anlegen</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="konto-first" className={label}>Vorname</label>
          <Input id="konto-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" className="h-12" />
          {prefilled && <p className="text-xs text-muted-foreground">vom letzten Ticket übernommen</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="konto-last" className={label}>Nachname</label>
          <Input id="konto-last" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" className="h-12" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="konto-mail" className={label}>E-Mail</label>
          <Input id="konto-mail" ref={emailRef} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@beispiel.de" autoComplete="off" className="h-12" />
          <p className="text-xs text-muted-foreground">Pflicht. Gibt es die Adresse schon, kommt {firstName || "die Person"} als Person in dieses Konto.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="konto-birth" className={label}>Geburtsdatum</label>
          <Input id="konto-birth" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="h-12" />
          <p className="text-xs text-muted-foreground">freiwillig, für Geburtstag und Kids-Angebote</p>
        </div>
      </div>
      {view.code && (
        <div className="space-y-1.5">
          <p className={label}>Wem gehört das Bändchen?</p>
          <Segmented
            aria-label="Eigentum des Bändchens"
            value={owner}
            onValueChange={setOwner}
            stretch
            options={[
              { value: "KUNDE", label: "Dem Gast" },
              { value: "BETRIEB", label: "Dem Betrieb (geliehen)" },
            ]}
          />
        </div>
      )}
      <div className="space-y-2 rounded-tile border border-border p-3">
        {view.openTickets > 0 && view.owner !== "BETRIEB" && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
            <Checkbox checked={adopt} onCheckedChange={(v) => setAdopt(v === true)} />
            <span>{view.openTickets} {view.openTickets === 1 ? "Besuch" : "Besuche"} mit diesem Bändchen übernehmen{view.stats.starts > 0 ? ` · ${view.stats.starts} Starts` : ""}</span>
          </label>
        )}
        <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
          <Checkbox checked={sendLink} onCheckedChange={(v) => setSendLink(v === true)} />
          <span>Link zur App per Mail schicken · Awards und Statistik sieht {firstName || "der Gast"} dort</span>
        </label>
      </div>
      {error && <Notice tone="danger" compact title={error} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        {sellService && (
          <Button type="submit" disabled={busy != null} className="h-12 flex-1 text-base font-semibold sm:h-14">
            {busy === "sell" ? <Loader2 className="animate-spin" /> : <Ticket />}
            Konto anlegen und {shortServiceName(sellService.name)} verkaufen
          </Button>
        )}
        <Button type={sellService ? "button" : "submit"} variant={sellService ? "outline" : "default"} disabled={busy != null} onClick={sellService ? () => void submit(false) : undefined} className="h-12 font-semibold sm:h-14 sm:min-w-36">
          {busy === "only" && <Loader2 className="animate-spin" />}
          Nur Konto
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} className="h-12 font-semibold sm:h-14">Zurück</Button>
      </div>
    </form>
  );
}

function AnnyCard({
  token,
  view,
  busy,
  onCheckin,
  onChanged,
  menuButton,
  menu,
}: {
  token: string;
  view: ChipView;
  busy: string | null;
  onCheckin: (ticketIds: number[]) => void;
  onChanged: () => Promise<void>;
  menuButton: React.ReactNode;
  menu: React.ReactNode;
}) {
  const anny = view.anny!;
  const [scanFor, setScanFor] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ticketId: number; text: string } | null>(null);
  const open = anny.tickets.filter((t) => !t.checkedIn && t.status !== "CANCELED");
  const n = anny.tickets.length;

  async function saveChip(ticketId: number, value: string) {
    if (!value.trim()) return;
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/checkin/public/${token}/update`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, rfidCode: value.trim() }),
      });
      const json = await safeJson(res);
      if (res.status === 409 && json?.conflict) {
        setNote({ ticketId, text: typeof json.message === "string" ? json.message : "Bändchen bereits vergeben." });
        return;
      }
      if (!res.ok) {
        setNote({ ticketId, text: typeof json?.error === "string" ? json.error : "Speichern hat nicht geklappt." });
        return;
      }
      setScanFor(null);
      setCode("");
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Ticket className="size-3.5" />Gebucht über anny</p>
      <div className="rounded-card border border-primary/30 bg-primary/[0.06] p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-tile bg-primary/10 text-primary"><Check className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-foreground sm:text-lg">{anny.label}{n > 1 ? ` · ${n} Personen` : ""}</p>
            <p className="text-sm text-muted-foreground">{[anny.slot, `Buchung ${anny.orderId}`].filter(Boolean).join(" · ")}</p>
          </div>
          <Badge variant={anny.paymentOpen ? "warning" : "live"}>{anny.paymentOpen ? "Zahlung offen" : "bezahlt"}</Badge>
        </div>
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-tile border border-border bg-popover">
          {anny.tickets.map((t, i) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {t.booker && view.person ? initials(view.person.firstName, view.person.lastName) : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{t.booker ? (view.person?.firstName ?? t.firstName ?? "Bucher") : "Begleitung"}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.rfidCode ? <><Nfc className="mr-1 inline size-3 align-[-2px]" />Bändchen {codeTail(t.rfidCode)}{t.booker && view.person ? ` · gehört ${view.person.firstName ?? "dem Bucher"}` : ""}</> : "noch kein Bändchen"}
                  {t.checkedIn ? " · eingecheckt" : ""}
                </span>
              </span>
              {t.rfidCode
                ? <Badge variant="live">bereit</Badge>
                : scanFor === t.id
                  ? null
                  : <Button type="button" variant="outline" onClick={() => { setScanFor(t.id); setCode(""); setNote(null); }} className="h-11 font-semibold"><Nfc />Bändchen scannen</Button>}
              {scanFor === t.id && (
                <form
                  className="flex w-full gap-2"
                  onSubmit={(e) => { e.preventDefault(); void saveChip(t.id, code); }}
                >
                  <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Bändchen an den Leser halten" aria-label="Bändchen-Code" autoComplete="off" className="h-11 flex-1 font-mono" />
                  <Button type="submit" disabled={saving || !code.trim()} className="h-11 font-semibold">{saving ? <Loader2 className="animate-spin" /> : "Speichern"}</Button>
                  <Button type="button" variant="ghost" onClick={() => setScanFor(null)} className="h-11">Abbrechen</Button>
                </form>
              )}
              {note?.ticketId === t.id && (
                <Notice tone="warning" compact title={note.text} className="w-full">
                  {t.booker ? null : "Die Begleitung braucht ein eigenes Bändchen."}
                </Notice>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={() => onCheckin(open.map((t) => t.id))}
            disabled={open.length === 0 || busy != null}
            className="h-12 flex-1 text-base font-semibold sm:h-14"
          >
            {busy === "checkin" ? <Loader2 className="animate-spin" /> : <LogIn />}
            {open.length === 0 ? "Alle eingecheckt" : open.length === 1 ? "Einchecken" : open.length === 2 ? "Beide einchecken" : `Alle ${open.length} einchecken`}
          </Button>
          {menuButton}
        </div>
        {menu}
      </div>
      {n > 1 && (
        <p className="text-xs text-muted-foreground">
          Das Konto kommt über die E-Mail aus anny. Das Bändchen der Begleitung hängt nur an diesem Ticket, bis sie selbst ein Konto hat.
        </p>
      )}
    </div>
  );
}
