"use client";

/**
 * Dashboard-Karte "Info-Anfragen": verschickt Gaeste-Formulare per Mail
 * (z. B. Ferienkurs: Wasserski/Wakeboard, Schuhgroesse, Level, Neopren).
 * Eine Mail pro Email-Adresse, gebuendelt ueber alle Kursplaetze; die
 * Antworten landen am Ticket und erscheinen im Check-in-Monitor.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ServiceRef {
  id: number;
  name: string;
}

interface TemplateDto {
  id: number;
  name: string;
  introText: string | null;
  fields: { key: string; label: string; type: string; options?: string[] }[];
  askParticipantName: boolean;
}

interface RecentRequest {
  id: number;
  email: string;
  status: string;
  sentAt: string;
  completedAt: string | null;
  ticketCount: number;
  template: { id: number; name: string };
}

interface PreviewPlace {
  range: string;
  start: string | null;
  ticketIds: number[];
  answered: boolean;
}

interface PreviewRecipient {
  email: string;
  firstName: string | null;
  lastName: string | null;
  ticketIds: number[];
  places: PreviewPlace[];
}

/** Montag (Berlin) der Woche eines ISO-Datums als YYYY-MM-DD. */
function mondayOf(iso: string): string {
  const d = new Date(iso);
  const berlin = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  const day = (berlin.getDay() + 6) % 7; // Mo=0
  berlin.setDate(berlin.getDate() - day);
  const y = berlin.getFullYear();
  const m = String(berlin.getMonth() + 1).padStart(2, "0");
  const dd = String(berlin.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function fmtWeek(monday: string): string {
  const start = new Date(`${monday}T12:00:00`);
  const end = new Date(start.getTime() + 4 * 86_400_000);
  const f = (x: Date) =>
    x.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return `${f(start)} – ${f(end)}${start.getFullYear() !== new Date().getFullYear() ? ` ${start.getFullYear()}` : ""}`;
}

export function InfoRequestsCard({ services }: { services: ServiceRef[] }) {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [recent, setRecent] = useState<RecentRequest[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<string>("all");
  const [recipients, setRecipients] = useState<PreviewRecipient[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [sending, setSending] = useState(false);
  const [resend, setResend] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/email/info-requests");
    if (!res.ok) return;
    const json = await res.json();
    setTemplates(json.templates ?? []);
    setRecent(json.recentRequests ?? []);
    if (json.templates?.length === 1) setTemplateId(String(json.templates[0].id));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Empfaenger-Vorschau, sobald ein Service gewaehlt ist (ohne Wochen-Filter;
  // die Wochen-Optionen werden aus den Plaetzen abgeleitet).
  useEffect(() => {
    if (!serviceId) {
      setRecipients(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    (async () => {
      try {
        const res = await fetch(`/api/email/info-requests?serviceId=${serviceId}`);
        const json = await res.json();
        if (!cancelled) setRecipients(json.preview?.recipients ?? []);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const weekOptions = useMemo(() => {
    const weeks = new Set<string>();
    for (const r of recipients ?? []) {
      for (const p of r.places) {
        if (p.start) weeks.add(mondayOf(p.start));
      }
    }
    return [...weeks].sort();
  }, [recipients]);

  // Client-seitige Filterung fuer die Statistik (der Versand filtert
  // serverseitig mit demselben Wochen-Fenster).
  const filtered = useMemo(() => {
    if (!recipients) return null;
    if (weekStart === "all") return recipients;
    return recipients
      .map((r) => ({
        ...r,
        places: r.places.filter((p) => p.start && mondayOf(p.start) === weekStart),
      }))
      .filter((r) => r.places.length > 0);
  }, [recipients, weekStart]);

  const stats = useMemo(() => {
    if (!filtered) return null;
    const places = filtered.flatMap((r) => r.places);
    return {
      recipients: filtered.length,
      places: places.length,
      answered: places.filter((p) => p.answered).length,
    };
  }, [filtered]);

  const selectedTemplate = templates.find((t) => String(t.id) === templateId) ?? null;

  const createFerienkursTemplate = async () => {
    setCreatingTemplate(true);
    try {
      const res = await fetch("/api/email/info-requests/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: "ferienkurs" }),
      });
      const json = await res.json();
      if (res.ok && json.template) {
        await load();
        setTemplateId(String(json.template.id));
      }
    } finally {
      setCreatingTemplate(false);
    }
  };

  const handleSend = async (emailFilter?: string) => {
    if (!templateId || !serviceId) return;
    if (!emailFilter) {
      const n = stats?.recipients ?? 0;
      if (!window.confirm(`Info-Anfrage jetzt an bis zu ${n} Empfänger senden?`)) return;
    }
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/email/info-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: Number(templateId),
          serviceId: Number(serviceId),
          weekStart: weekStart === "all" ? null : weekStart,
          // Test-Sends immer zustellen, auch wenn schon eine Anfrage existiert.
          resend: emailFilter ? true : resend,
          ...(emailFilter ? { emailFilter } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult({ ok: false, text: typeof json.error === "string" ? json.error : "Versand fehlgeschlagen." });
        return;
      }
      const parts = [`${json.sent} gesendet`];
      if (json.skipped) parts.push(`${json.skipped} übersprungen`);
      if (json.failed) parts.push(`${json.failed} fehlgeschlagen`);
      setResult({
        ok: json.failed === 0,
        text: parts.join(", ") + (json.errors?.length ? ` – ${json.errors[0]}` : ""),
      });
      load();
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-teal-600" />
              Info-Anfragen
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Fragt Zusatzinfos per Mail-Formular ab (z. B. Ferienkurs: Wasserski/Wakeboard,
              Schuhgröße, Level, Neopren). Antworten erscheinen im Check-in-Monitor am Ticket.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 shrink-0"
            title="Aktualisieren"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Vorlage */}
        {templates.length === 0 ? (
          <button
            type="button"
            onClick={createFerienkursTemplate}
            disabled={creatingTemplate}
            className="w-full flex items-center justify-center gap-2 border border-dashed border-teal-300 dark:border-teal-800 text-teal-700 dark:text-teal-300 rounded-xl py-3 text-sm font-semibold hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-colors disabled:opacity-50"
          >
            {creatingTemplate ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Ferienkurs-Vorlage erstellen (Sport, Schuhgröße, Level, Neopren)
          </button>
        ) : (
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Vorlage</label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Vorlage wählen" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Service</label>
              <Select value={serviceId} onValueChange={(v) => { setServiceId(v); setWeekStart("all"); }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Service wählen" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Woche</label>
              <Select value={weekStart} onValueChange={setWeekStart} disabled={!serviceId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Wochen</SelectItem>
                  {weekOptions.map((w) => (
                    <SelectItem key={w} value={w}>
                      {fmtWeek(w)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Felder-Vorschau der Vorlage */}
        {selectedTemplate && (
          <div className="flex flex-wrap gap-1.5">
            {selectedTemplate.askParticipantName && (
              <Badge variant="outline" className="text-[11px] font-normal">Teilnehmername</Badge>
            )}
            {selectedTemplate.fields.map((f) => (
              <Badge key={f.key} variant="outline" className="text-[11px] font-normal">
                {f.label}
                {f.options ? ` (${f.options.slice(0, 3).join("/")}${f.options.length > 3 ? "/…" : ""})` : ""}
              </Badge>
            ))}
          </div>
        )}

        {/* Empfaenger-Statistik */}
        {serviceId && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
            {loadingPreview ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Lade Empfänger…
              </div>
            ) : stats ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span>
                  <strong className="text-slate-900 dark:text-slate-100">{stats.recipients}</strong>{" "}
                  <span className="text-slate-500">Empfänger</span>
                </span>
                <span>
                  <strong className="text-slate-900 dark:text-slate-100">{stats.places}</strong>{" "}
                  <span className="text-slate-500">Plätze</span>
                </span>
                <span>
                  <strong className={cn(stats.answered === stats.places && stats.places > 0 ? "text-emerald-600" : "text-slate-900 dark:text-slate-100")}>
                    {stats.answered}
                  </strong>{" "}
                  <span className="text-slate-500">beantwortet</span>
                </span>
              </div>
            ) : null}
          </div>
        )}

        {/* Versand */}
        {serviceId && templateId && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={resend}
                onChange={(e) => setResend(e.target.checked)}
                className="rounded border-slate-300"
              />
              Bereits angeschriebene Adressen erneut anschreiben
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={sending || !stats || stats.recipients === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-600 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                An {stats?.recipients ?? 0} Empfänger senden
              </button>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="test@adresse.de"
                  className="flex-1 sm:w-48 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                />
                <button
                  type="button"
                  onClick={() => testEmail && handleSend(testEmail)}
                  disabled={sending || !testEmail.includes("@")}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                  title="Nur an diese Adresse senden (muss Empfänger des Service sein)"
                >
                  Test
                </button>
              </div>
            </div>
            {result && (
              <div
                className={cn(
                  "flex items-center gap-2 text-sm rounded-xl px-3 py-2",
                  result.ok
                    ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                    : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300",
                )}
              >
                {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                {result.text}
              </div>
            )}
          </div>
        )}

        {/* Historie */}
        {recent.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Zuletzt versendet
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 text-xs border border-slate-100 dark:border-slate-800 rounded-lg px-2.5 py-1.5"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      r.status === "COMPLETED"
                        ? "bg-emerald-500"
                        : r.status === "FAILED"
                          ? "bg-rose-500"
                          : "bg-amber-400",
                    )}
                  />
                  <span className="truncate flex-1">{r.email}</span>
                  <span className="text-slate-400 shrink-0">{r.template.name}</span>
                  <span
                    className={cn(
                      "shrink-0 font-semibold",
                      r.status === "COMPLETED"
                        ? "text-emerald-600"
                        : r.status === "FAILED"
                          ? "text-rose-500"
                          : "text-amber-500",
                    )}
                  >
                    {r.status === "COMPLETED" ? "beantwortet" : r.status === "FAILED" ? "fehlgeschlagen" : "offen"}
                  </span>
                  <span className="text-slate-400 shrink-0">
                    {new Date(r.sentAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
