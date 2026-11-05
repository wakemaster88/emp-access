"use client";

/**
 * Dashboard-Karte "Info-Anfragen": verschickt Gaeste-Formulare per Mail
 * (z. B. Ferienkurs: Wasserski/Wakeboard, Schuhgroesse, Level, Neopren).
 * Eine Mail pro Email-Adresse, gebuendelt ueber alle Kursplaetze; die
 * Antworten landen am Ticket und erscheinen im Check-in-Monitor.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Notice } from "@/components/ui/notice";
import { StatusDot } from "@/components/ui/status-dot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

// Auswahlfelder: auf dem Handy 44 px hoch, ab sm 36 px (docs/design-regeln.md, Abschnitt 16).
const SELECT_FIELD = "w-full data-[size=default]:h-11 sm:data-[size=default]:h-9";

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
  // Rückfrage vor dem Massenversand als AlertDialog statt window.confirm (Abschnitt 16).
  const [confirmSend, setConfirmSend] = useState(false);
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

  // Massenversand nur nach Bestätigung im AlertDialog (siehe unten); Test-Sends gehen direkt.
  const handleSend = async (emailFilter?: string) => {
    if (!templateId || !serviceId) return;
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
      <CardHeader>
        <CardTitle>
          <h3 className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Info-Anfragen
          </h3>
        </CardTitle>
        <CardDescription>
          Fragt Zusatzinfos per Mail-Formular ab (z. B. Ferienkurs: Wasserski/Wakeboard,
          Schuhgröße, Level, Neopren). Antworten erscheinen im Check-in-Monitor am Ticket.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={load}
            className="text-muted-foreground max-sm:size-11"
            title="Aktualisieren"
            aria-label="Aktualisieren"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Vorlage */}
        {templates.length === 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={createFerienkursTemplate}
            disabled={creatingTemplate}
            className="h-auto min-h-11 w-full whitespace-normal border-dashed border-primary/40 py-3 font-semibold text-primary hover:bg-primary/10 hover:text-primary"
          >
            {creatingTemplate ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Ferienkurs-Vorlage erstellen (Sport, Schuhgröße, Level, Neopren)
          </Button>
        ) : (
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Vorlage</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className={SELECT_FIELD}>
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
            <div className="space-y-1.5">
              <Label className="text-[13px]">Service</Label>
              <Select value={serviceId} onValueChange={(v) => { setServiceId(v); setWeekStart("all"); }}>
                <SelectTrigger className={SELECT_FIELD}>
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
            <div className="space-y-1.5">
              <Label className="text-[13px]">Woche</Label>
              <Select value={weekStart} onValueChange={setWeekStart} disabled={!serviceId}>
                <SelectTrigger className={cn(SELECT_FIELD, "tabular-nums")}>
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
              <Badge variant="neutral" className="text-[11px] font-normal">Teilnehmername</Badge>
            )}
            {selectedTemplate.fields.map((f) => (
              <Badge key={f.key} variant="neutral" className="text-[11px] font-normal">
                {f.label}
                {f.options ? ` (${f.options.slice(0, 3).join("/")}${f.options.length > 3 ? "/…" : ""})` : ""}
              </Badge>
            ))}
          </div>
        )}

        {/* Empfaenger-Statistik */}
        {serviceId && (
          <div className="glass-tile p-3">
            {loadingPreview ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Lade Empfänger…
              </div>
            ) : stats ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm tabular-nums">
                <span>
                  <strong className="text-foreground">{stats.recipients}</strong>{" "}
                  <span className="text-muted-foreground">Empfänger</span>
                </span>
                <span>
                  <strong className="text-foreground">{stats.places}</strong>{" "}
                  <span className="text-muted-foreground">Plätze</span>
                </span>
                <span>
                  <strong className={cn(stats.answered === stats.places && stats.places > 0 ? "text-success" : "text-foreground")}>
                    {stats.answered}
                  </strong>{" "}
                  <span className="text-muted-foreground">beantwortet</span>
                </span>
              </div>
            ) : null}
          </div>
        )}

        {/* Versand */}
        {serviceId && templateId && (
          <div className="space-y-3">
            {/* Kästchen (Abschnitt 16): Option für diesen Versand, wirkt erst mit „Senden“.
                Die Beschriftung füllt die Zeile, so ist die ganze Zeile Tippfläche. */}
            <div className="flex items-center gap-3">
              <Checkbox
                id="ir-resend"
                checked={resend}
                onCheckedChange={(checked) => setResend(checked === true)}
              />
              <Label
                htmlFor="ir-resend"
                className="min-h-11 flex-1 cursor-pointer text-[13px] font-normal leading-snug text-muted-foreground sm:min-h-0"
              >
                Bereits angeschriebene Adressen erneut anschreiben
              </Label>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                onClick={() => setConfirmSend(true)}
                disabled={sending || !stats || stats.recipients === 0}
                className="h-11 flex-1 gap-2 font-semibold tabular-nums sm:h-9"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                An {stats?.recipients ?? 0} Empfänger senden
              </Button>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="test@adresse.de"
                  className="h-11 min-w-0 flex-1 sm:h-9 sm:w-48 sm:flex-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => testEmail && handleSend(testEmail)}
                  disabled={sending || !testEmail.includes("@")}
                  className="h-11 font-semibold sm:h-9"
                  title="Nur an diese Adresse senden (muss Empfänger des Service sein)"
                >
                  Test
                </Button>
              </div>
            </div>
            {result && (
              <Notice
                tone={result.ok ? "success" : "danger"}
                icon={result.ok ? CheckCircle2 : XCircle}
                compact
                title={result.text}
              />
            )}
            <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
              <AlertDialogContent aria-describedby={undefined}>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Info-Anfrage jetzt an bis zu {stats?.recipients ?? 0} Empfänger senden?
                  </AlertDialogTitle>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-11 sm:h-9">Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleSend()} className="h-11 gap-2 sm:h-9">
                    <Send className="h-4 w-4" />
                    Senden
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {/* Historie */}
        {recent.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-label flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Zuletzt versendet
            </p>
            <div className="glass-tile max-h-48 divide-y divide-border overflow-y-auto overscroll-contain scrollbar-thin">
              {recent.map((r) => (
                // Handy: E-Mail füllt die erste Zeile, Vorlage, Status und Datum stehen darunter.
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs px-3 py-2"
                >
                  <StatusDot
                    size="xs"
                    tone={
                      r.status === "COMPLETED"
                        ? "success"
                        : r.status === "FAILED"
                          ? "danger"
                          : "warning"
                    }
                  />
                  <span className="truncate flex-1">{r.email}</span>
                  <span className="flex min-w-0 items-center gap-2 max-sm:basis-full max-sm:pl-3.5">
                    <span className="min-w-0 truncate text-muted-foreground" title={r.template.name}>{r.template.name}</span>
                    <span
                      className={cn(
                        "shrink-0 font-semibold",
                        r.status === "COMPLETED"
                          ? "text-success"
                          : r.status === "FAILED"
                            ? "text-destructive"
                            : "text-warning",
                      )}
                    >
                      {r.status === "COMPLETED" ? "beantwortet" : r.status === "FAILED" ? "fehlgeschlagen" : "offen"}
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {new Date(r.sentAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                    </span>
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
