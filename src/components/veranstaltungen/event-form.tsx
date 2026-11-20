"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  extraLineCents,
  formatEuro,
  UNIT_LABEL,
  type VenueExtraUnit,
} from "@/lib/venue-event-rules";

export interface VenueOption {
  id: number;
  name: string;
  bufferMinutes: number;
  capacity: number | null;
}

export interface ExtraOption {
  id: number;
  areaId: number;
  name: string;
  description: string | null;
  priceCents: number;
  unit: VenueExtraUnit;
  /** Nur Backoffice: ausgeblendete Leistungen bleiben auswählbar, wenn schon gebucht. */
  active?: boolean;
}

/** Bereits gebuchte Zeile (Preis-Schnappschuss) zum Vorbelegen. */
export interface BookedExtra {
  extraId: number | null;
  name: string;
  unit: VenueExtraUnit;
  unitPriceCents: number;
  quantity: number;
}

export interface EventFormState {
  areaId: string;
  title: string;
  hostName: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount: string;
  note: string;
  /** extraId → Stückzahl */
  extras: Record<number, number>;
}

export function emptyEventForm(areaId: number | undefined, date: string): EventFormState {
  return {
    areaId: areaId ? String(areaId) : "",
    title: "",
    hostName: "",
    date,
    startTime: "18:00",
    endTime: "23:00",
    guestCount: "",
    note: "",
    extras: {},
  };
}

export function eventFormFrom(e: {
  areaId: number; title: string; hostName: string | null; date: string; startTime: string; endTime: string;
  guestCount: number; note: string | null; extras: BookedExtra[];
}): EventFormState {
  return {
    areaId: String(e.areaId),
    title: e.title,
    hostName: e.hostName ?? "",
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    guestCount: String(e.guestCount),
    note: e.note ?? "",
    extras: Object.fromEntries(e.extras.filter((x) => x.extraId != null).map((x) => [x.extraId!, x.quantity])),
  };
}

/** Body fuer die APIs. */
export function eventFormBody(f: EventFormState) {
  return {
    areaId: Number(f.areaId),
    title: f.title.trim(),
    hostName: f.hostName.trim() || null,
    date: f.date,
    startTime: f.startTime,
    endTime: f.endTime,
    guestCount: Number(f.guestCount),
    note: f.note.trim() || null,
    extras: Object.entries(f.extras).map(([extraId, quantity]) => ({ extraId: Number(extraId), quantity })),
  };
}

/** Kurze Pruefung vor dem Absenden; der Server prueft alles noch einmal. */
export function eventFormError(f: EventFormState, venue: VenueOption | undefined): string | null {
  if (!f.areaId) return "Bitte einen Raum wählen.";
  if (!f.title.trim()) return "Bitte einen Titel angeben.";
  if (!f.date) return "Bitte ein Datum wählen.";
  if (!f.startTime || !f.endTime) return "Bitte Beginn und Ende angeben.";
  const guests = Number(f.guestCount);
  if (!Number.isInteger(guests) || guests < 1) return "Bitte die Personenzahl angeben.";
  if (venue?.capacity != null && guests > venue.capacity) return `In ${venue.name} passen höchstens ${venue.capacity} Personen.`;
  return null;
}

/**
 * Felder eines Termins: Raum, Titel, Veranstalter, Zeit, Personen,
 * Zusatzleistungen mit Summe und Bemerkung. Von Backoffice und
 * Partner-Portal gemeinsam genutzt.
 */
export function EventFormFields({
  idPrefix,
  form,
  onChange,
  venues,
  extras,
  booked = [],
  disabled = false,
}: {
  idPrefix: string;
  form: EventFormState;
  onChange: (next: EventFormState) => void;
  venues: VenueOption[];
  extras: ExtraOption[];
  booked?: BookedExtra[];
  disabled?: boolean;
}) {
  const set = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) => onChange({ ...form, [key]: value });
  const areaId = Number(form.areaId);
  const venue = venues.find((v) => v.id === areaId);
  const bookedById = new Map(booked.filter((b) => b.extraId != null).map((b) => [b.extraId!, b]));
  // Katalog des Raums; gebuchte, inzwischen ausgeblendete Leistungen bleiben sichtbar.
  const list = extras.filter((x) => x.areaId === areaId && (x.active !== false || bookedById.has(x.id) || x.id in form.extras));
  const guests = Number(form.guestCount) || 0;
  const total = list.reduce((sum, x) => {
    const qty = form.extras[x.id];
    if (qty == null) return sum;
    const b = bookedById.get(x.id);
    return sum + extraLineCents({ unit: b?.unit ?? x.unit, unitPriceCents: b?.unitPriceCents ?? x.priceCents, quantity: qty }, guests);
  }, 0);
  const overnight = form.startTime && form.endTime && form.endTime <= form.startTime;

  function toggleExtra(id: number, on: boolean) {
    const next = { ...form.extras };
    if (on) next[id] = next[id] ?? 1; else delete next[id];
    set("extras", next);
  }

  return (
    <div className="space-y-4">
      {venues.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-area`}>Raum</Label>
          <NativeSelect id={`${idPrefix}-area`} value={form.areaId} disabled={disabled}
            onChange={(e) => onChange({ ...form, areaId: e.target.value, extras: {} })}>
            <option value="">Bitte wählen</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </NativeSelect>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-title`}>Titel *</Label>
        <Input id={`${idPrefix}-title`} value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={120}
          placeholder="z. B. Firmenfeier, Hochzeit" className="max-sm:h-11" disabled={disabled} required aria-required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-host`}>Veranstalter (optional)</Label>
        <Input id={`${idPrefix}-host`} value={form.hostName} onChange={(e) => set("hostName", e.target.value)} maxLength={120}
          placeholder="Firma oder Name" className="max-sm:h-11" disabled={disabled} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor={`${idPrefix}-date`}>Datum *</Label>
          <Input id={`${idPrefix}-date`} type="date" value={form.date} onChange={(e) => set("date", e.target.value)}
            className="max-sm:h-11" disabled={disabled} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-start`}>Beginn *</Label>
          <Input id={`${idPrefix}-start`} type="time" step={900} value={form.startTime} onChange={(e) => set("startTime", e.target.value)}
            className="max-sm:h-11" disabled={disabled} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-end`}>Ende *</Label>
          <Input id={`${idPrefix}-end`} type="time" step={900} value={form.endTime} onChange={(e) => set("endTime", e.target.value)}
            className="max-sm:h-11" disabled={disabled} required />
        </div>
      </div>
      {(overnight || (venue && venue.bufferMinutes > 0)) && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {overnight && "Endet am Folgetag. "}
          {venue && venue.bufferMinutes > 0 && `Zwischen zwei Veranstaltungen bleiben ${venue.bufferMinutes} Min. für Auf- und Abbau frei.`}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-guests`}>Personen (geplant) *</Label>
        <Input id={`${idPrefix}-guests`} type="number" inputMode="numeric" min={1} max={venue?.capacity ?? undefined}
          value={form.guestCount} onChange={(e) => set("guestCount", e.target.value)} className="max-sm:h-11" disabled={disabled} required />
        {venue?.capacity != null && <p className="text-xs text-muted-foreground">Höchstens {venue.capacity} Personen.</p>}
      </div>

      {list.length > 0 && (
        <div className="space-y-2">
          <Label>Zusatzleistungen</Label>
          <div className="glass-tile divide-y divide-border">
            {list.map((x) => {
              const qty = form.extras[x.id];
              const checked = qty != null;
              const b = bookedById.get(x.id);
              const price = b?.unitPriceCents ?? x.priceCents;
              const unit = b?.unit ?? x.unit;
              return (
                <div key={x.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <Checkbox id={`${idPrefix}-x-${x.id}`} checked={checked} disabled={disabled} onCheckedChange={(v) => toggleExtra(x.id, !!v)} />
                  <Label htmlFor={`${idPrefix}-x-${x.id}`} className="min-w-0 flex-1 cursor-pointer text-sm font-normal">
                    <span className={cn("block", !checked && "text-muted-foreground")}>{x.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatEuro(price)} {UNIT_LABEL[unit]}{x.description ? ` · ${x.description}` : ""}
                    </span>
                  </Label>
                  {checked && unit === "PER_PIECE" && (
                    <div className="ml-auto flex items-center gap-1">
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`${x.name} weniger`} disabled={disabled || qty <= 1}
                        onClick={() => set("extras", { ...form.extras, [x.id]: Math.max(1, qty - 1) })}>
                        <Minus />
                      </Button>
                      <Input aria-label={`Anzahl ${x.name}`} inputMode="numeric" value={String(qty)} disabled={disabled}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(10_000, Number(e.target.value.replace(/\D/g, "")) || 1));
                          set("extras", { ...form.extras, [x.id]: n });
                        }}
                        className="h-8 w-14 text-center tabular-nums" />
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`${x.name} mehr`} disabled={disabled}
                        onClick={() => set("extras", { ...form.extras, [x.id]: qty + 1 })}>
                        <Plus />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between px-1 text-sm">
            <span className="text-muted-foreground">Zusatzleistungen netto{guests ? ` bei ${guests} Pers.` : ""}</span>
            <span className="font-semibold tabular-nums">{formatEuro(total)}</span>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-note`}>Bemerkung (optional)</Label>
        <Textarea id={`${idPrefix}-note`} value={form.note} onChange={(e) => set("note", e.target.value)} rows={3} maxLength={1000}
          placeholder="Ablauf, Wünsche, Aufbau" disabled={disabled} />
      </div>
    </div>
  );
}
