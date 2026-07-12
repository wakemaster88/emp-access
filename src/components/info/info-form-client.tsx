"use client";

/**
 * Oeffentliches Gaeste-Formular fuer Info-Anfragen (/info/<token>).
 * Ein Link deckt alle Kursplaetze einer Email-Adresse ab: pro Platz wird
 * ein Fragenblock gerendert (Felder kommen aus dem InfoFormTemplate).
 *
 * Design angelehnt an www.tuttenbrocksee.com: Petrol #1a6d73 als Primary,
 * weisse Cards auf Grau-50, grosszuegige Radien (rounded-2xl/3xl),
 * Uppercase-Eyebrows in Grau, fette dunkle Headlines, Pill-Buttons.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Hash, Loader2, PartyPopper } from "lucide-react";
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

// Tuttenbrocksee-Website-Palette (www.tuttenbrocksee.com).
const BRAND = "#1a6d73";
const BRAND_DARK = "#155a60";

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
      <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: BRAND }} />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-gray-900">Link nicht gefunden</h1>
          <p className="text-sm text-gray-500 mt-3 leading-relaxed">
            Dieser Info-Link ist ungültig oder wurde entfernt. Bitte melde dich bei uns,
            falls du deine Angaben ändern möchtest.
          </p>
        </div>
      </div>
    );
  }

  const websiteHost = data.branding.websiteUrl
    ? data.branding.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;

  if (submitted) {
    return (
      <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center">
          <div
            className="mx-auto h-16 w-16 rounded-full flex items-center justify-center"
            style={{ background: `${BRAND}1a` }}
          >
            <PartyPopper className="h-8 w-8" style={{ color: BRAND }} />
          </div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mt-6">Alles erledigt</p>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">Danke!</h1>
          <p className="text-sm text-gray-600 mt-3 leading-relaxed">
            Deine Angaben sind gespeichert – damit geht der Check-in vor Ort deutlich schneller.
            Du kannst diesen Link jederzeit wieder öffnen, um etwas zu ändern.
          </p>
          {websiteHost && (
            <a
              href={data.branding.websiteUrl!}
              className="inline-block mt-6 px-6 py-3 rounded-2xl text-white text-sm font-semibold transition-transform hover:scale-105"
              style={{ background: BRAND }}
            >
              Zurück zu {websiteHost}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gray-50 text-gray-900">
      {/* Header im Website-Stil: Petrol-Fläche, Logo/Name, Eyebrow + fette Headline */}
      <div
        className="px-6 pt-10 pb-16 text-center text-white"
        style={{ background: `linear-gradient(160deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
      >
        {data.branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.branding.logoUrl}
            alt={data.accountName}
            className="h-12 mx-auto mb-4 object-contain"
          />
        ) : (
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] opacity-80 mb-3">
            {data.accountName}
          </p>
        )}
        <p className="text-xs uppercase tracking-wider text-white/70">
          Schneller einchecken
        </p>
        <h1 className="text-3xl md:text-4xl font-bold mt-2 leading-tight">
          {data.serviceName ? `Infos für deinen ${data.serviceName}` : data.template.name}
        </h1>
        {data.template.introText && (
          <p className="text-sm text-white/85 mt-4 max-w-md mx-auto leading-relaxed">
            {data.template.introText}
          </p>
        )}
      </div>

      <div className="max-w-lg mx-auto p-4 pb-32 space-y-3 -mt-8">
        {data.places.map((place) => {
          const values = answers.get(place.primaryTicketId) ?? {};
          const complete = placeComplete(place.primaryTicketId);
          const isOpen = openPlace === place.primaryTicketId;
          return (
            <div
              key={place.primaryTicketId}
              className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenPlace(isOpen ? null : place.primaryTicketId)}
                className="w-full flex items-center gap-3 p-4 md:p-5 text-left"
              >
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold",
                    complete ? "text-white" : "text-gray-500 bg-gray-100",
                  )}
                  style={complete ? { background: BRAND } : undefined}
                >
                  {complete ? <CheckCircle2 className="h-5 w-5" /> : place.index}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">
                    Kursplatz {place.index}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {values[data.participantNameLabel] || place.bookedName || `Kursplatz ${place.index}`}
                  </p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {place.range}
                    {place.bookingNumber && (
                      <span className="inline-flex items-center gap-0.5 ml-2 text-gray-400">
                        <Hash className="h-3 w-3" />
                        {place.bookingNumber}
                      </span>
                    )}
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-gray-400 transition-transform shrink-0",
                    isOpen && "rotate-180",
                  )}
                />
              </button>

              {isOpen && (
                <div className="px-4 md:px-5 pb-6 space-y-5 border-t border-gray-100 pt-5">
                  {place.bookingNumber && (
                    <p className="text-xs text-gray-400 -mt-1">
                      Buchungsnummer: <span className="font-medium text-gray-500">{place.bookingNumber}</span>
                    </p>
                  )}
                  {data.template.askParticipantName && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                        Wer nimmt teil?
                        <span className="text-red-500 ml-0.5">*</span>
                      </label>
                      <input
                        type="text"
                        value={values[data.participantNameLabel] ?? ""}
                        onChange={(e) =>
                          setValue(place.primaryTicketId, data.participantNameLabel, e.target.value)
                        }
                        placeholder="Vor- und Nachname des Teilnehmers"
                        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 transition-shadow"
                        style={{ ["--tw-ring-color" as string]: BRAND }}
                      />
                    </div>
                  )}

                  {data.template.fields.map((field) => {
                    if (!fieldVisible(field, values, data.template.fields)) return null;
                    const value = values[field.label] ?? "";
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>

                        {field.type === "choice" && (
                          <div className="flex flex-wrap gap-2">
                            {(field.options ?? []).map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setValue(place.primaryTicketId, field.label, opt)}
                                className={cn(
                                  "px-4 py-2.5 rounded-2xl text-sm font-semibold border transition-all duration-200",
                                  value === opt
                                    ? "text-white border-transparent shadow-sm"
                                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:scale-[1.02]",
                                )}
                                style={value === opt ? { background: BRAND } : undefined}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}

                        {field.type === "boolean" && (
                          <div className="flex gap-2">
                            {["Ja", "Nein"].map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setValue(place.primaryTicketId, field.label, opt)}
                                className={cn(
                                  "flex-1 px-4 py-2.5 rounded-2xl text-sm font-semibold border transition-all duration-200",
                                  value === opt
                                    ? "text-white border-transparent shadow-sm"
                                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-300",
                                )}
                                style={value === opt ? { background: BRAND } : undefined}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}

                        {field.type === "number" && (
                          <input
                            type="number"
                            inputMode="decimal"
                            value={value}
                            onChange={(e) =>
                              setValue(place.primaryTicketId, field.label, e.target.value)
                            }
                            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 transition-shadow"
                            style={{ ["--tw-ring-color" as string]: BRAND }}
                          />
                        )}

                        {field.type === "text" && (
                          <input
                            type="text"
                            value={value}
                            onChange={(e) =>
                              setValue(place.primaryTicketId, field.label, e.target.value)
                            }
                            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 transition-shadow"
                            style={{ ["--tw-ring-color" as string]: BRAND }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-4 py-3">
            {error}
          </div>
        )}

        {websiteHost && (
          <p className="text-center text-xs text-gray-400 pt-2">
            <a href={data.branding.websiteUrl!} className="hover:text-gray-600 transition-colors">
              {websiteHost}
            </a>
          </p>
        )}
      </div>

      {/* Sticky Submit im Website-Button-Stil */}
      <div className="fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur border-t border-gray-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-lg mx-auto">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !allComplete}
            className="w-full py-3.5 rounded-2xl text-white text-sm font-semibold transition-all duration-300 disabled:opacity-40 hover:shadow-lg hover:scale-[1.01] active:scale-100 disabled:hover:scale-100 disabled:hover:shadow-none"
            style={{ background: allComplete ? BRAND : BRAND_DARK }}
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            ) : allComplete ? (
              "Angaben absenden"
            ) : (
              "Bitte alle Pflichtfelder ausfüllen"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
