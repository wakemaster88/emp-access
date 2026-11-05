"use client";

/**
 * Oeffentliches Gaeste-Formular fuer Info-Anfragen (/info/<token>).
 * Ein Link deckt alle Kursplaetze einer Email-Adresse ab: pro Platz wird
 * ein Fragenblock gerendert (Felder kommen aus dem InfoFormTemplate).
 *
 * Gestaltung nach docs/design-regeln.md und folgt Hell/Dunkel des Geraets:
 * Kopf als Akzentflaeche (das Logo des Betriebs steht wie im Kopf der
 * Gaeste-Mails auf Farbe), darunter je Kursplatz eine Glaskarte auf dem
 * Farbgrund, Felder und Tasten aus den Bausteinen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Hash, Loader2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";

interface FormField {
  key: string;
  label: string;
  type: "choice" | "text" | "number" | "boolean";
  options?: string[];
  required?: boolean;
  showIfKey?: string;
}

interface Place {
  index: number;
  primaryTicketId: number;
  range: string;
  bookedName: string | null;
  bookingNumber: string | null;
  answered: boolean;
  values: Record<string, string>;
}

interface FormData {
  accountName: string;
  serviceName: string | null;
  branding: { color: string | null; logoUrl: string | null; websiteUrl: string | null };
  status: string;
  template: {
    name: string;
    introText: string | null;
    fields: FormField[];
    askParticipantName: boolean;
  };
  participantNameLabel: string;
  places: Place[];
}

export function InfoFormClient({ token }: { token: string }) {
  const [data, setData] = useState<FormData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  // Antworten pro Platz (primaryTicketId -> label -> Wert).
  const [answers, setAnswers] = useState<Map<number, Record<string, string>>>(new Map());
  const [openPlace, setOpenPlace] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/info/${token}`);
        if (!res.ok) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const json: FormData = await res.json();
        if (cancelled) return;
        setData(json);
        const initial = new Map<number, Record<string, string>>();
        for (const p of json.places) {
          const values = { ...p.values };
          // Teilnehmername mit dem Buchungsnamen vorbelegen - bei den
          // meisten Buchungen ist Bucher = Teilnehmer, und Tippen entfaellt.
          if (
            json.template.askParticipantName &&
            !values[json.participantNameLabel] &&
            p.bookedName
          ) {
            values[json.participantNameLabel] = p.bookedName;
          }
          initial.set(p.primaryTicketId, values);
        }
        setAnswers(initial);
        const firstOpen = json.places.find((p) => !p.answered) ?? json.places[0];
        setOpenPlace(firstOpen?.primaryTicketId ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const setValue = useCallback((placeId: number, label: string, value: string) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      const entry = { ...(next.get(placeId) ?? {}) };
      if (value) entry[label] = value;
      else delete entry[label];
      next.set(placeId, entry);
      return next;
    });
  }, []);

  const fieldVisible = useCallback(
    (field: FormField, values: Record<string, string>, fields: FormField[]) => {
      if (!field.showIfKey) return true;
      const dep = fields.find((f) => f.key === field.showIfKey);
      return dep ? values[dep.label] === "Ja" : true;
    },
    [],
  );

  /** Platz gilt als vollstaendig, wenn alle sichtbaren Pflichtfelder gesetzt sind. */
  const placeComplete = useCallback(
    (placeId: number): boolean => {
      if (!data) return false;
      const values = answers.get(placeId) ?? {};
      const fields = data.template.fields;
      if (data.template.askParticipantName && !values[data.participantNameLabel]?.trim()) {
        return false;
      }
      return fields.every((f) => {
        if (!f.required) return true;
        if (!fieldVisible(f, values, fields)) return true;
        return !!values[f.label]?.trim();
      });
    },
    [data, answers, fieldVisible],
  );

  const allComplete = useMemo(
    () => (data ? data.places.every((p) => placeComplete(p.primaryTicketId)) : false),
    [data, placeComplete],
  );

  const handleSubmit = async () => {
    if (!data) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        answers: data.places.map((p) => ({
          primaryTicketId: p.primaryTicketId,
          values: answers.get(p.primaryTicketId) ?? {},
        })),
      };
      const res = await fetch(`/api/info/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen. Bitte erneut versuchen.");
        return;
      }
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-ambient min-h-[100dvh] flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Lädt …
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="page-ambient min-h-[100dvh] flex items-center justify-center p-6">
        <Card className="w-full max-w-md gap-3 px-6 py-10 sm:py-10 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Link nicht gefunden</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Dieser Info-Link ist ungültig oder wurde entfernt. Bitte melde dich bei uns,
            falls du deine Angaben ändern möchtest.
          </p>
        </Card>
      </div>
    );
  }

  const websiteHost = data.branding.websiteUrl
    ? data.branding.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;

  if (submitted) {
    return (
      <div className="page-ambient min-h-[100dvh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full items-center gap-0 px-6 py-10 sm:py-10 text-center">
          <IconChip icon={PartyPopper} tone="success" size="lg" className="size-14 rounded-tile [&_svg]:size-7" />
          <p className="text-label mt-6">Alles erledigt</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground mt-1">Danke!</h1>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
            Deine Angaben sind gespeichert – damit geht der Check-in vor Ort deutlich schneller.
            Du kannst diesen Link jederzeit wieder öffnen, um etwas zu ändern.
          </p>
          {websiteHost && (
            // Darf umbrechen: Host und Pfad können auf schmalen Handys breiter sein als die Karte.
            <Button asChild size="lg" className="mt-6 h-auto min-h-11 max-w-full whitespace-normal py-2 text-center wrap-anywhere">
              <a href={data.branding.websiteUrl!}>
                Zurück zu {websiteHost}
              </a>
            </Button>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="page-ambient min-h-[100dvh] text-foreground">
      {/* Kopf als Akzentfläche: Logo/Name, Eyebrow und Titel. Das Logo des
          Betriebs ist (wie im Kopf der Gäste-Mails) für eine Farbfläche gemacht.
          Im Dunkeln ist der Akzent heller; zu 60 % gedeckt behält Weiß darauf
          genug Kontrast. */}
      <div className="rounded-b-card bg-primary px-6 pt-10 pb-12 text-center text-primary-foreground dark:bg-primary/60">
        {data.branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.branding.logoUrl}
            alt={data.accountName}
            className="h-12 mx-auto mb-4 object-contain"
          />
        ) : (
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-primary-foreground/80 mb-3">
            {data.accountName}
          </p>
        )}
        <p className="text-xs uppercase tracking-wider text-primary-foreground/75">
          Schneller einchecken
        </p>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-balance mt-2 leading-tight">
          {data.serviceName ? `Infos für deinen ${data.serviceName}` : data.template.name}
        </h1>
        {data.template.introText && (
          <p className="text-sm text-primary-foreground/85 mt-4 max-w-md mx-auto leading-relaxed">
            {data.template.introText}
          </p>
        )}
      </div>

      <div className="max-w-lg mx-auto p-4 pb-32 space-y-4">
        {data.places.map((place) => {
          const values = answers.get(place.primaryTicketId) ?? {};
          const complete = placeComplete(place.primaryTicketId);
          const isOpen = openPlace === place.primaryTicketId;
          return (
            <Card
              key={place.primaryTicketId}
              className="gap-0 py-0 sm:py-0 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenPlace(isOpen ? null : place.primaryTicketId)}
                aria-expanded={isOpen}
                // Fokusring nach innen: die Karte schneidet alles außerhalb ab.
                className="w-full flex items-center gap-3 p-4 md:p-5 text-left rounded-card outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                {/* Kursplatz vollständig: Haken in der Erfolgsfarbe, sonst die Nummer. */}
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold tabular-nums",
                    complete ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {complete ? <CheckCircle2 className="h-5 w-5" /> : place.index}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-label">
                    Kursplatz {place.index}
                  </p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {values[data.participantNameLabel] || place.bookedName || `Kursplatz ${place.index}`}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {place.range}
                    {place.bookingNumber && (
                      <span className="inline-flex items-center gap-0.5 ml-2">
                        <Hash className="h-3 w-3" />
                        {place.bookingNumber}
                      </span>
                    )}
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                    isOpen && "rotate-180",
                  )}
                />
              </button>

              {isOpen && (
                <div className="px-4 md:px-5 pb-6 space-y-5 border-t border-border pt-5">
                  {data.template.askParticipantName && (
                    <div className="space-y-2">
                      <Label className="gap-0 leading-snug">
                        Wer nimmt teil?
                        <span className="text-destructive ml-0.5">*</span>
                      </Label>
                      <Input
                        type="text"
                        value={values[data.participantNameLabel] ?? ""}
                        onChange={(e) =>
                          setValue(place.primaryTicketId, data.participantNameLabel, e.target.value)
                        }
                        placeholder="Vor- und Nachname des Teilnehmers"
                        className="h-11"
                      />
                    </div>
                  )}

                  {data.template.fields.map((field) => {
                    if (!fieldVisible(field, values, data.template.fields)) return null;
                    const value = values[field.label] ?? "";
                    return (
                      <div key={field.key} className="space-y-2">
                        <Label className="gap-0 leading-snug">
                          {field.label}
                          {field.required && <span className="text-destructive ml-0.5">*</span>}
                        </Label>

                        {/* Auswahl als Tasten: gewählt in Akzentfarbe, sonst Glas mit Haarlinie. */}
                        {field.type === "choice" && (
                          <div className="flex flex-wrap gap-2">
                            {(field.options ?? []).map((opt) => (
                              <Button
                                key={opt}
                                type="button"
                                variant={value === opt ? "default" : "secondary"}
                                aria-pressed={value === opt}
                                onClick={() => setValue(place.primaryTicketId, field.label, opt)}
                                className={cn(
                                  "h-auto min-h-11 max-w-full whitespace-normal px-4 py-2 font-semibold",
                                  value !== opt && "ring-border dark:ring-glass-border",
                                )}
                              >
                                {opt}
                              </Button>
                            ))}
                          </div>
                        )}

                        {field.type === "boolean" && (
                          <div className="flex gap-2">
                            {["Ja", "Nein"].map((opt) => (
                              <Button
                                key={opt}
                                type="button"
                                variant={value === opt ? "default" : "secondary"}
                                aria-pressed={value === opt}
                                onClick={() => setValue(place.primaryTicketId, field.label, opt)}
                                className={cn(
                                  "flex-1 h-11 px-4 font-semibold",
                                  value !== opt && "ring-border dark:ring-glass-border",
                                )}
                              >
                                {opt}
                              </Button>
                            ))}
                          </div>
                        )}

                        {field.type === "number" && (
                          <Input
                            type="number"
                            inputMode="decimal"
                            value={value}
                            onChange={(e) =>
                              setValue(place.primaryTicketId, field.label, e.target.value)
                            }
                            className="h-11"
                          />
                        )}

                        {field.type === "text" && (
                          <Input
                            type="text"
                            value={value}
                            onChange={(e) =>
                              setValue(place.primaryTicketId, field.label, e.target.value)
                            }
                            className="h-11"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}

        {error && <Notice tone="danger" compact title={error} />}

        {websiteHost && (
          <p className="text-center text-xs text-muted-foreground pt-2">
            <a href={data.branding.websiteUrl!} className="inline-flex min-h-11 items-center hover:text-foreground transition-colors">
              {websiteHost}
            </a>
          </p>
        )}
      </div>

      {/* Absenden als klebende Glasleiste unten, Primärtaste in voller Breite.
          Der Seitenrand steckt wie bei den Karten in der schmalen Spalte, so
          ist die Taste auch auf breiten Bildschirmen so breit wie die Karten. */}
      <div className="glass-bar fixed bottom-0 inset-x-0 border-t border-border pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-lg mx-auto px-4">
          {/* Warum die Taste gesperrt ist, steht lesbar darüber – nicht blass in der Taste. */}
          {!allComplete && (
            <p className="mb-2 text-center text-xs text-muted-foreground">Bitte alle Pflichtfelder ausfüllen</p>
          )}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !allComplete}
            size="lg"
            className="h-12 w-full text-[15px] font-semibold"
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Angaben absenden"}
          </Button>
        </div>
      </div>
    </div>
  );
}
