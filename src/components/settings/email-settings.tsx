"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { SearchInput } from "@/components/ui/search-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
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
  Loader2,
  Send,
  Trash2,
  CheckCircle2,
  XCircle,
  Mail,
  Plus,
  Pencil,
  Sparkles,
  Clock,
  CalendarClock,
  CalendarX,
  Smile,
  GiftIcon,
  PlayCircle,
  TestTube2,
  X,
  History,
  AlertTriangle,
  FlaskConical,
  RefreshCw,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRESET_TEMPLATES, type PresetTemplate } from "@/lib/email-templates";

type RuleTrigger =
  | "SUBSCRIPTION_EXPIRING"
  | "SUBSCRIPTION_EXPIRED"
  | "DAY_VISIT_FOLLOWUP"
  | "TICKET_WELCOME";

const LAST_TEST_TO_KEY = "emp:lastEmailTestTo";

function getLastTestTo(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_TEST_TO_KEY) ?? "";
  } catch {
    return "";
  }
}

function setLastTestTo(value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_TEST_TO_KEY, value);
  } catch {
    // ignore
  }
}

interface EmailConfigDTO {
  id: number;
  provider: string;
  apiKey: string | null;
  hasApiKey: boolean;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  isActive: boolean;
  brandColor: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
}

interface DiagnoseResult {
  rule: {
    id: number;
    name: string;
    trigger: RuleTrigger;
    daysOffset: number;
    lookbackDays: number;
    cooldownDays: number;
  };
  now: string;
  triggerField: "endDate" | "firstScanAt" | "createdAt";
  triggerWindow: { from: string; to: string };
  funnel: {
    ticketsTotal: number;
    ticketsWithEmail: number;
    ticketsValidStatus: number;
    ticketsWithTriggerField: number;
    ticketsScopeMatch: number;
    ticketsInWindow: number;
    cooldownBlocked: number;
    ticketsWouldSend: number;
  };
  samplesInWindow: {
    id: number;
    name: string | null;
    email: string | null;
    ticketTypeName: string | null;
    triggerDate: string | null;
    cooldownBlocked: boolean;
  }[];
  upcomingSample: {
    id: number;
    name: string | null;
    email: string | null;
    triggerDate: string | null;
  }[];
  lastSend: { sentAt: string; status: string; to: string; errorMessage: string | null } | null;
}

interface EmailRuleDTO {
  id: number;
  name: string;
  trigger: RuleTrigger;
  daysOffset: number;
  subscriptionId: number | null;
  serviceId: number | null;
  subject: string;
  bodyHtml: string;
  createVoucher: boolean;
  voucherDiscountPercent: number | null;
  voucherValidDays: number | null;
  voucherTicketTypeName: string | null;
  renewUrl: string | null;
  isActive: boolean;
  cooldownDays: number;
  lookbackDays: number;
  sentCount: number;
  createdAt: string;
}

interface NamedRef {
  id: number;
  name: string;
}

interface EmailSettingsProps {
  initialConfig: EmailConfigDTO | null;
  subscriptions?: NamedRef[];
  services?: NamedRef[];
}

// Felder und Tasten: auf dem Handy 44 px hoch, ab sm 36 px bzw. 32 px (docs/design-regeln.md, Abschnitt 16).
const FIELD = "h-11 sm:h-9";
const SELECT_FIELD = "w-full data-[size=default]:h-11 sm:data-[size=default]:h-9";
const TOUCH_SM = "h-11 sm:h-8";

// Regeltypen unterscheiden sich am Symbol, nicht an der Farbe: ein Typ ist kein
// Zustand (Abschnitt 3, keine Farbe als Dekoration).
const TRIGGER_META: Record<
  RuleTrigger,
  { label: string; helper: string; icon: typeof CalendarClock }
> = {
  SUBSCRIPTION_EXPIRING: {
    label: "Abo läuft aus",
    helper: "Tage VOR endDate",
    icon: CalendarClock,
  },
  SUBSCRIPTION_EXPIRED: {
    label: "Abo abgelaufen",
    helper: "Tage NACH endDate",
    icon: CalendarX,
  },
  DAY_VISIT_FOLLOWUP: {
    label: "Tagesgast Followup",
    helper: "Tage NACH erstem Scan",
    icon: Smile,
  },
  TICKET_WELCOME: {
    label: "Welcome",
    helper: "Tage NACH Ticket-Anlage",
    icon: Sparkles,
  },
};

export function EmailSettings({ initialConfig, subscriptions = [], services = [] }: EmailSettingsProps) {
  const [config, setConfig] = useState<EmailConfigDTO | null>(initialConfig);
  const [rules, setRules] = useState<EmailRuleDTO[] | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [editing, setEditing] = useState<EmailRuleDTO | "new" | null>(null);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [presetForNew, setPresetForNew] = useState<PresetTemplate | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRulesLoading(true);
      try {
        const res = await fetch("/api/email/rules");
        if (!res.ok) return;
        const data = (await res.json()) as { rules: EmailRuleDTO[] };
        if (!cancelled) setRules(data.rules);
      } finally {
        if (!cancelled) setRulesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadRules() {
    setRulesLoading(true);
    try {
      const res = await fetch("/api/email/rules");
      if (res.ok) {
        const data = (await res.json()) as { rules: EmailRuleDTO[] };
        setRules(data.rules);
      }
    } finally {
      setRulesLoading(false);
    }
  }

  function handleNewFromPreset(preset: PresetTemplate) {
    setPresetForNew(preset);
    setPresetPickerOpen(false);
    setEditing("new");
  }

  function handleNewBlank() {
    setPresetForNew(null);
    setEditing("new");
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <EmailConfigCard config={config} onConfigChange={setConfig} />

      {config && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h3>Automatische Mails</h3>
            </CardTitle>
            <CardDescription>
              Regelbasierte Mails zu Aboablauf, Followups und Welcome-Nachrichten.
            </CardDescription>
            {/* Kopf der Karte (docs/design-regeln.md, Abschnitt 13): die Primärhandlung oben rechts,
                „Aus Vorlage“ als weitere Handlung in der Zeile darunter. */}
            <CardAction>
              <Button size="sm" className={cn("gap-1.5", TOUCH_SM)} onClick={handleNewBlank}>
                <Plus className="h-4 w-4" />
                Neue Regel
              </Button>
            </CardAction>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setPresetPickerOpen(true)} className={cn("gap-1.5", TOUCH_SM)}>
                <Sparkles className="h-4 w-4 text-primary" />
                Aus Vorlage
              </Button>
            </div>
            {rulesLoading && rules == null ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lädt …
              </div>
            ) : rules && rules.length === 0 ? (
              <EmptyState
                compact
                icon={Mail}
                title="Noch keine Regeln"
                description="Lege jetzt deine erste automatische Mail an – am schnellsten geht es mit einer Vorlage."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn("gap-1.5", TOUCH_SM)}
                    onClick={() => setPresetPickerOpen(true)}
                  >
                    <Sparkles className="h-4 w-4 text-primary" />
                    Vorlage wählen
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {rules?.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    onEdit={() => setEditing(r)}
                    onChanged={reloadRules}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {config && <EmailHistoryCard rules={rules ?? []} />}

      <PresetPickerDialog
        open={presetPickerOpen}
        onOpenChange={setPresetPickerOpen}
        onPick={handleNewFromPreset}
      />

      <RuleDialog
        open={editing !== null}
        rule={editing === "new" ? null : editing}
        preset={editing === "new" ? presetForNew : null}
        subscriptions={subscriptions}
        services={services}
        onClose={() => {
          setEditing(null);
          setPresetForNew(null);
        }}
        onSaved={async () => {
          setEditing(null);
          setPresetForNew(null);
          await reloadRules();
        }}
      />
    </div>
  );
}

// ── History Card ─────────────────────────────────────────────────────────────

interface EmailSendDTO {
  id: number;
  to: string;
  subject: string;
  status: "SENT" | "FAILED" | "TEST" | string;
  errorMessage: string | null;
  sentAt: string;
  rule: { id: number; name: string; trigger: RuleTrigger } | null;
  ticket: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    name: string | null;
    email: string | null;
    ticketTypeName: string | null;
  } | null;
  voucher: { id: number; code: string } | null;
}

type StatusFilter = "ALL" | "SENT" | "FAILED" | "TEST";

function EmailHistoryCard({ rules }: { rules: EmailRuleDTO[] }) {
  const [sends, setSends] = useState<EmailSendDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [ruleFilter, setRuleFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 280);
    return () => window.clearTimeout(t);
  }, [search]);

  const buildQuery = (cursor: number | null) => {
    const params = new URLSearchParams();
    params.set("limit", "50");
    if (cursor) params.set("cursor", String(cursor));
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (ruleFilter !== "ALL") params.set("ruleId", ruleFilter);
    if (searchDebounced) params.set("q", searchDebounced);
    return params.toString();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/email/sends?${buildQuery(null)}`);
        if (!res.ok) {
          if (!cancelled) setSends([]);
          return;
        }
        const data = (await res.json()) as {
          sends: EmailSendDTO[];
          nextCursor: number | null;
          hasMore: boolean;
        };
        if (!cancelled) {
          setSends(data.sends);
          setNextCursor(data.nextCursor);
          setHasMore(data.hasMore);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, ruleFilter, searchDebounced]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/email/sends?${buildQuery(nextCursor)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        sends: EmailSendDTO[];
        nextCursor: number | null;
        hasMore: boolean;
      };
      setSends((prev) => [...(prev ?? []), ...data.sends]);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/email/sends?${buildQuery(null)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        sends: EmailSendDTO[];
        nextCursor: number | null;
        hasMore: boolean;
      };
      setSends(data.sends);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3 className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Mail-Historie
          </h3>
        </CardTitle>
        <CardDescription>
          Wer hat wann welche Mail bekommen – inkl. Cron, manuell ausgeloester Sends und Tests.
        </CardDescription>
        {/* Wie bei den Info-Anfragen: die Kopf-Taste sitzt im CardAction-Platz. Auf dem Handy nur als
            Symbol (44 px, Name bleibt für Screenreader), damit die Beschreibung daneben Platz hat. */}
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className={cn("gap-1.5 max-sm:w-11", TOUCH_SM)}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="max-sm:sr-only">Aktualisieren</span>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Handy: Suche in voller Breite, darunter beide Filter nebeneinander. */}
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="E-Mail, Name oder Betreff…"
            onClear={() => setSearch("")}
            containerClassName="w-full sm:w-auto sm:min-w-[200px] sm:flex-1"
            className={FIELD}
          />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="min-w-0 flex-1 data-[size=default]:h-11 sm:w-[140px] sm:flex-none sm:data-[size=default]:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Status</SelectItem>
              <SelectItem value="SENT">Versendet</SelectItem>
              <SelectItem value="FAILED">Fehler</SelectItem>
              <SelectItem value="TEST">Test</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ruleFilter} onValueChange={setRuleFilter}>
            <SelectTrigger className="min-w-0 flex-1 data-[size=default]:h-11 sm:w-[200px] sm:flex-none sm:data-[size=default]:h-9">
              <SelectValue placeholder="Alle Regeln" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Regeln</SelectItem>
              {rules.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && sends == null ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lädt …
          </div>
        ) : sends && sends.length === 0 ? (
          <EmptyState
            compact
            icon={Mail}
            title="Noch keine Sends"
            description="Sobald der Cron oder ein Test eine Mail verschickt, taucht sie hier auf."
          />
        ) : (
          <>
            <ul className="glass-tile divide-y divide-border overflow-hidden">
              {sends?.map((s) => <EmailSendRow key={s.id} send={s} />)}
            </ul>
            {hasMore && (
              <div className="text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className={cn("gap-1.5", TOUCH_SM)}
                >
                  {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Mehr laden
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "SENT") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" />
        Versendet
      </Badge>
    );
  }
  if (status === "FAILED") {
    return (
      <Badge variant="danger">
        <AlertTriangle className="h-3 w-3" />
        Fehler
      </Badge>
    );
  }
  if (status === "TEST") {
    return (
      <Badge variant="warning">
        <FlaskConical className="h-3 w-3" />
        Test
      </Badge>
    );
  }
  return <Badge variant="neutral">{status}</Badge>;
}

function EmailSendRow({ send }: { send: EmailSendDTO }) {
  const dt = new Date(send.sentAt);
  const dateLabel = dt.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const recipientName =
    [send.ticket?.firstName, send.ticket?.lastName].filter(Boolean).join(" ") ||
    send.ticket?.name ||
    null;

  return (
    <li className="px-3 py-2.5 transition-colors hover:bg-glass-tile">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={send.status} />
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3" />
              {dateLabel}
            </span>
            {send.rule && (
              // Handy: der Regelname bricht in eine eigene Zeile, dort ohne führenden Mittelpunkt.
              <span className="text-xs text-muted-foreground inline-flex min-w-0 items-center gap-1 max-w-[200px]">
                <span aria-hidden className="max-sm:hidden">·</span>
                <span className="truncate">{send.rule.name}</span>
              </span>
            )}
          </div>
          <div className="mt-1.5 text-sm font-medium text-foreground truncate">
            {send.subject}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {recipientName ? (
                <>
                  <span className="text-foreground/80 font-medium">{recipientName}</span>
                  <span className="text-muted-foreground"> · {send.to}</span>
                </>
              ) : (
                send.to
              )}
            </span>
            {send.voucher && (
              // Gutschein ist kein Hinweis: Code in Vordergrundfarbe, Symbol gedämpft.
              <span className="inline-flex items-center gap-1 text-foreground/80 font-mono">
                <GiftIcon className="h-3 w-3 text-muted-foreground" />
                {send.voucher.code}
              </span>
            )}
          </div>
          {send.status === "FAILED" && send.errorMessage && (
            // Historischer Fehler: `status` statt `alert`, damit der Screenreader nicht jede Zeile ansagt.
            <Notice tone="danger" compact role="status" className="mt-1.5 break-words">
              {send.errorMessage}
            </Notice>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Config Card ──────────────────────────────────────────────────────────────

function EmailConfigCard({
  config,
  onConfigChange,
}: {
  config: EmailConfigDTO | null;
  onConfigChange: (c: EmailConfigDTO | null) => void;
}) {
  const [editing, setEditing] = useState(!config);
  const [apiKey, setApiKey] = useState<string>("");
  const [keepKey, setKeepKey] = useState(!!config?.hasApiKey);
  const [fromEmail, setFromEmail] = useState(config?.fromEmail ?? "");
  const [fromName, setFromName] = useState(config?.fromName ?? "");
  const [replyTo, setReplyTo] = useState(config?.replyTo ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(config?.websiteUrl ?? "");
  const [brandColor, setBrandColor] = useState(config?.brandColor ?? "#4F46E5");
  const [isActive, setIsActive] = useState<boolean>(config?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    if (config) {
      setFromEmail(config.fromEmail);
      setFromName(config.fromName ?? "");
      setReplyTo(config.replyTo ?? "");
      setWebsiteUrl(config.websiteUrl ?? "");
      setBrandColor(config.brandColor ?? "#4F46E5");
      setIsActive(config.isActive);
      setKeepKey(!!config.hasApiKey);
      setEditing(false);
    } else {
      setEditing(true);
    }
  }, [config]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        fromEmail,
        fromName: fromName || null,
        replyTo: replyTo || null,
        websiteUrl: websiteUrl || null,
        brandColor: brandColor || null,
        isActive,
      };
      if (apiKey.trim()) {
        payload.apiKey = apiKey.trim();
      } else if (!keepKey) {
        payload.apiKey = null;
      }

      const res = await fetch("/api/email/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          (typeof data?.error === "string" ? data.error : data?.error?.formErrors?.[0]) ??
            "Speichern fehlgeschlagen.",
        );
        return;
      }
      onConfigChange(data.config);
      setApiKey("");
      setEditing(false);
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await fetch("/api/email/config", { method: "DELETE" });
      onConfigChange(null);
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  async function handleTest() {
    if (!testTo.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestMessage("");
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestResult("ok");
        setTestMessage(`Mail an ${testTo} verschickt.`);
      } else {
        setTestResult("fail");
        setTestMessage(typeof data.error === "string" ? data.error : "Versand fehlgeschlagen.");
      }
    } catch {
      setTestResult("fail");
      setTestMessage("Netzwerkfehler.");
    } finally {
      setTesting(false);
    }
  }

  if (config && !editing) {
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              Versand-Konfiguration
            </CardTitle>
            <CardAction>
              <Badge variant={config.isActive && config.hasApiKey ? "success" : "neutral"}>
                {config.isActive && config.hasApiKey ? "Aktiv" : config.hasApiKey ? "Deaktiviert" : "Kein API-Key"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <Row
                label="Provider"
                value={config.provider === "GMAIL" ? "Gmail SMTP" : config.provider}
              />
              <Row label="Gmail-Adresse" value={config.fromEmail} />
              {config.fromName && <Row label="Name" value={config.fromName} />}
              {config.replyTo && <Row label="Reply-To" value={config.replyTo} />}
              {config.websiteUrl && <Row label="Website" value={config.websiteUrl} />}
              <Row
                label="App-Passwort"
                value={
                  config.hasApiKey ? config.apiKey ?? "•••" : <span className="text-destructive">fehlt</span>
                }
                mono
              />
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <Label htmlFor="email-test-to" className="text-[13px] text-muted-foreground">
                Test-Mail senden an
              </Label>
              <div className="flex gap-2">
                <Input
                  id="email-test-to"
                  type="email"
                  placeholder="dein@verein.de"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  className={cn("min-w-0", FIELD)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={testing || !testTo.trim() || !config.hasApiKey}
                  className={cn("gap-1.5 shrink-0", FIELD)}
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Senden
                </Button>
              </div>
              {testResult && (
                <Notice
                  tone={testResult === "ok" ? "success" : "danger"}
                  icon={testResult === "ok" ? CheckCircle2 : XCircle}
                  compact
                  title={testMessage}
                />
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} className={TOUCH_SM}>
                <Pencil className="h-4 w-4 mr-1.5" />
                Bearbeiten
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
                aria-label="Konfiguration löschen"
                title="Konfiguration löschen"
                className={cn("text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60 ml-auto", TOUCH_SM)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Email-Konfiguration wirklich löschen?"
          description="Aktive Regeln werden nicht ausgelöst."
          busy={saving}
          onConfirm={handleDelete}
        />
      </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          {config ? "Konfiguration bearbeiten" : "Email-Versand einrichten"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Notice tone="info" compact title="So richtest du Gmail ein:">
          <ol className="list-decimal list-inside space-y-0.5">
            <li>2-Faktor-Authentifizierung im Google-Konto aktivieren</li>
            <li>
              Unter{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener"
                className="text-primary font-medium hover:underline"
              >
                myaccount.google.com/apppasswords
              </a>{" "}
              ein App-Passwort erzeugen
            </li>
            <li>App-Passwort + Gmail-Adresse hier eintragen</li>
          </ol>
        </Notice>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="email-from">
              Gmail-Adresse <span className="text-destructive">*</span>
            </Label>
            <Input
              id="email-from"
              type="email"
              placeholder="dein-account@gmail.com"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              required
              autoComplete="email"
              className={FIELD}
            />
            <p className="text-[11px] text-muted-foreground">
              Auch erlaubt: in Gmail verifizierter Alias (z. B. eigene Domain).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-api-key">Gmail App-Passwort <span className="text-destructive">*</span></Label>
            <Input
              id="email-api-key"
              type="password"
              autoComplete="new-password"
              placeholder={keepKey ? "•••• gespeichert (leer = unverändert)" : "16-stelliges App-Passwort"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={FIELD}
            />
            {keepKey && (
              <p className="text-[11px] text-muted-foreground">
                <button type="button" onClick={() => setKeepKey(false)} className="underline hover:text-destructive">
                  Gespeichertes Passwort entfernen
                </button>
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-from-name">Absender-Name</Label>
            <Input
              id="email-from-name"
              placeholder="Mein Verein"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              className={FIELD}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-reply">Reply-To</Label>
            <Input
              id="email-reply"
              type="email"
              placeholder="info@verein.de"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              className={FIELD}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-website">Website-URL</Label>
            <Input
              id="email-website"
              type="url"
              placeholder="https://verein.de"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className={FIELD}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-brand">Brand-Farbe</Label>
            <div className="flex items-center gap-2">
              <Input
                id="email-brand"
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className={cn("w-12 p-1 shrink-0 cursor-pointer", FIELD)}
              />
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#4F46E5"
                className={cn("font-mono", FIELD)}
              />
            </div>
          </div>
          <div className="glass-tile flex items-center justify-between gap-3 px-3 py-2.5 sm:col-span-2">
            <div>
              <p className="text-sm font-medium text-foreground">Versand aktiv</p>
              <p className="text-xs text-muted-foreground">Wenn aus, werden keine automatischen Mails versendet.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        {error && <Notice tone="danger" compact title={error} />}

        {/* Tasten rechts, „Abbrechen“ links von der Primärtaste; Handy: volle Breite, Primärtaste oben (Abschnitt 16). */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {config && (
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving} className={FIELD}>
              Abbrechen
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || !fromEmail.trim()} className={FIELD}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Speichern
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-foreground/90 truncate", mono && "font-mono text-xs")}>
        {value}
      </span>
    </div>
  );
}

/**
 * Rückfrage vor dem Löschen (Abschnitt 18): AlertDialog mit destruktiver Taste
 * statt Browser-confirm. Die Taste bleibt offen und zeigt den Ladezustand, bis
 * `onConfirm` fertig ist; schließen muss der Aufrufer.
 */
function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent {...(description ? {} : { "aria-describedby": undefined })}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className={FIELD}>
            Abbrechen
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className={cn("gap-1.5", FIELD)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Rule Row ─────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  onEdit,
  onChanged,
}: {
  rule: EmailRuleDTO;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<"toggle" | "delete" | "run" | "test" | "diagnose" | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const meta = TRIGGER_META[rule.trigger];
  const Icon = meta.icon;

  useEffect(() => {
    if (testOpen && !testTo) {
      setTestTo(getLastTestTo());
    }
  }, [testOpen, testTo]);

  async function toggle() {
    setBusy("toggle");
    try {
      await fetch(`/api/email/rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await fetch(`/api/email/rules/${rule.id}`, { method: "DELETE" });
      await onChanged();
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  async function runNow() {
    setBusy("run");
    setRunMsg(null);
    try {
      const res = await fetch(`/api/email/rules/${rule.id}`, { method: "POST" });
      const data = await res.json();
      const stats = data.ruleStats?.[0];
      if (stats) {
        setRunMsg(`${stats.sent} versendet, ${stats.skipped} übersprungen, ${stats.failed} fehlgeschlagen (${stats.considered} geprüft).`);
      } else if (data.error) {
        setRunMsg(`Fehler: ${data.error}`);
      } else {
        setRunMsg("Regel ausgeführt.");
      }
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function runDiagnose() {
    setBusy("diagnose");
    setDiagnose(null);
    try {
      const res = await fetch(`/api/email/rules/${rule.id}/diagnose`);
      if (!res.ok) return;
      const data = (await res.json()) as DiagnoseResult;
      setDiagnose(data);
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return;
    setBusy("test");
    setTestResult(null);
    try {
      const res = await fetch("/api/email/rules/test-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: testTo.trim(),
          subject: rule.subject,
          bodyHtml: rule.bodyHtml,
          trigger: rule.trigger,
          daysOffset: rule.daysOffset,
          createVoucher: rule.createVoucher,
          voucherDiscountPercent: rule.voucherDiscountPercent,
          voucherValidDays: rule.voucherValidDays,
          voucherTicketTypeName: rule.voucherTicketTypeName,
          renewUrl: rule.renewUrl,
          ruleId: rule.id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setLastTestTo(testTo.trim());
        setTestResult({ ok: true, msg: `Vorschau-Mail an ${testTo.trim()} verschickt.` });
      } else {
        setTestResult({
          ok: false,
          msg: typeof data.error === "string" ? data.error : "Versand fehlgeschlagen.",
        });
      }
    } catch {
      setTestResult({ ok: false, msg: "Netzwerkfehler." });
    } finally {
      setBusy(null);
    }
  }

  return (
    // Inaktive Regel: Text bleibt lesbar, das Badge sagt den Zustand, gedimmt wird nur der IconChip (Abschnitt 17).
    <li className="glass-tile overflow-hidden">
      <div className="flex items-center gap-3 p-3 flex-wrap">
        <IconChip icon={Icon} tone="neutral" className={cn(!rule.isActive && "opacity-60")} />
        {/* Mindestbreite für den Text: auf dem Handy rutschen die Tasten in eine eigene Zeile. */}
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">{rule.name}</p>
            {!rule.isActive && <Badge variant="neutral">Inaktiv</Badge>}
            {rule.createVoucher && (
              <Badge variant="secondary" className="tabular-nums">
                <GiftIcon className="h-3 w-3" />
                {rule.voucherDiscountPercent ?? 0}%
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums sm:truncate">
            <span>{meta.label}</span>
            <span className="text-muted-foreground/50 mx-1.5">·</span>
            {rule.daysOffset} Tage <span className="text-muted-foreground">({meta.helper})</span>
            <span className="text-muted-foreground/50 mx-1.5">·</span>
            <Clock className="h-3 w-3 inline mb-0.5" /> Cooldown {rule.cooldownDays}d
            <span className="text-muted-foreground/50 mx-1.5">·</span>
            {rule.sentCount} versendet
          </p>
        </div>
        {/* Darf umbrechen: auf sehr schmalen Handys schneidet die Kachel (overflow-hidden) sonst „Löschen“ ab. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          <Switch
            checked={rule.isActive}
            onCheckedChange={toggle}
            disabled={busy !== null}
            size="sm"
            aria-label="Regel aktiv"
            className="mr-1"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setTestOpen((v) => !v);
              setTestResult(null);
            }}
            disabled={busy !== null}
            title="Test-Mail mit Beispieldaten senden"
            aria-label="Test-Mail mit Beispieldaten senden"
            aria-pressed={testOpen}
            className={cn("max-sm:size-11", testOpen && "bg-primary/10 text-primary")}
          >
            <TestTube2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={runNow}
            disabled={busy !== null}
            title="Jetzt ausführen"
            aria-label="Jetzt ausführen"
            className="max-sm:size-11"
          >
            {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={runDiagnose}
            disabled={busy !== null}
            title="Diagnose: warum sendet die Regel (nichts)?"
            aria-label="Diagnose: warum sendet die Regel (nichts)?"
            aria-pressed={diagnose !== null}
            className={cn("max-sm:size-11", diagnose && "bg-primary/10 text-primary")}
          >
            {busy === "diagnose" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            disabled={busy !== null}
            title="Bearbeiten"
            aria-label="Bearbeiten"
            className="max-sm:size-11"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== null}
            className="text-destructive hover:text-destructive max-sm:size-11"
            title="Löschen"
            aria-label="Löschen"
          >
            {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Regel "${rule.name}" löschen?`}
        busy={busy === "delete"}
        onConfirm={remove}
      />
      {testOpen && (
        // Test ist kein Hinweis: neutrale Gruppe, Symbol gedämpft.
        <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <TestTube2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-foreground">
              Test-Mail mit Beispieldaten (Max Mustermann, fiktive Termine)
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setTestOpen(false)}
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground max-sm:size-9"
              aria-label="Test schließen"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="empfaenger@example.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && testTo.trim() && busy !== "test") {
                  e.preventDefault();
                  sendTest();
                }
              }}
              className={cn("min-w-0", FIELD)}
              autoFocus
            />
            <Button
              size="sm"
              variant="outline"
              onClick={sendTest}
              disabled={busy === "test" || !testTo.trim()}
              className={cn("gap-1.5 shrink-0", FIELD)}
            >
              {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Senden
            </Button>
          </div>
          {testResult && (
            <Notice
              tone={testResult.ok ? "success" : "danger"}
              icon={testResult.ok ? CheckCircle2 : XCircle}
              compact
              title={testResult.msg}
            />
          )}
        </div>
      )}
      {runMsg && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground tabular-nums">
          {runMsg}
        </div>
      )}
      {diagnose && (
        <DiagnoseBlock diagnose={diagnose} onClose={() => setDiagnose(null)} />
      )}
    </li>
  );
}

// ── Diagnose Block ──────────────────────────────────────────────────────────

function DiagnoseBlock({
  diagnose,
  onClose,
}: {
  diagnose: DiagnoseResult;
  onClose: () => void;
}) {
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const f = diagnose.funnel;

  async function runAnnySync() {
    setBackfillBusy(true);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/integrations/anny", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setBackfillResult(
          `Anny-Sync abgeschlossen: ${data.created ?? 0} neu, ${data.updated ?? 0} aktualisiert. ` +
            `Bitte Diagnose erneut ausführen.`,
        );
      } else {
        setBackfillResult(
          typeof data.error === "string"
            ? `Fehler: ${data.error}`
            : "Sync fehlgeschlagen.",
        );
      }
    } catch {
      setBackfillResult("Netzwerkfehler beim Sync.");
    } finally {
      setBackfillBusy(false);
    }
  }

  const wouldSend = f.ticketsWouldSend;

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // `blocksWhenPositive`: Cooldown hält nur auf, wenn er > 0 ist; alle anderen
  // Stufen stoppen den Versand bei 0. Nur diese Stellen tragen die Hinweisfarbe.
  const steps: { label: string; value: number; hint?: string; blocksWhenPositive?: boolean }[] = [
    { label: "Tickets gesamt", value: f.ticketsTotal },
    { label: "davon mit E-Mail", value: f.ticketsWithEmail, hint: "Ticket.email ist nicht NULL" },
    { label: "Status VALID/REDEEMED", value: f.ticketsValidStatus },
    {
      label: `Trigger-Feld (${diagnose.triggerField}) gesetzt`,
      value: f.ticketsWithTriggerField,
    },
    { label: "Filter (Abo/Service) passt", value: f.ticketsScopeMatch },
    {
      label: "Im Trigger-Fenster",
      value: f.ticketsInWindow,
      hint: `${formatDate(diagnose.triggerWindow.from)} – ${formatDate(diagnose.triggerWindow.to)}`,
    },
    { label: "Cooldown blockiert", value: f.cooldownBlocked, blocksWhenPositive: true },
  ];

  return (
    // Neutrale Gruppe; Farbe tragen nur die Stufen, die den Versand aufhalten, und das Ergebnis.
    <div className="space-y-3 border-t border-border bg-muted/30 px-3 py-3">
      <div className="flex items-center gap-2">
        <Stethoscope className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-foreground">
          Diagnose
        </span>
        {/* Bricht auf dem Handy um statt abzuschneiden: Lookback steht sonst nirgends. */}
        <span className="min-w-0 text-xs text-muted-foreground tabular-nums">
          Lookback {diagnose.rule.lookbackDays}d · Cooldown {diagnose.rule.cooldownDays}d
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground max-sm:size-9"
          aria-label="Diagnose schließen"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="grid gap-1.5 text-xs">
        {steps.map((s, idx) => (
          <div
            key={s.label}
            className={cn(
              "flex items-center justify-between gap-2 px-2 py-1 rounded-sm",
              idx === steps.length - 1 || s.value === 0
                ? "bg-glass-tile"
                : "bg-glass-tile/50",
            )}
          >
            <div className="min-w-0">
              <span className="text-foreground/80">{s.label}</span>
              {s.hint && (
                <span className="text-muted-foreground ml-1.5 tabular-nums">({s.hint})</span>
              )}
            </div>
            <span
              className={cn(
                "font-mono font-semibold tabular-nums shrink-0",
                (s.blocksWhenPositive ? s.value > 0 : s.value === 0) ? "text-warning" : "text-foreground",
              )}
            >
              {s.value}
            </span>
          </div>
        ))}
        <div
          className={cn(
            "flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm border",
            wouldSend > 0 ? "bg-success/10 border-success/30" : "bg-glass-tile border-glass-border",
          )}
        >
          <span className={cn("font-medium", wouldSend > 0 ? "text-success" : "text-foreground")}>
            Würde jetzt versenden
          </span>
          <span className={cn("font-mono font-bold tabular-nums", wouldSend > 0 ? "text-success" : "text-foreground")}>
            {wouldSend}
          </span>
        </div>
      </div>

      {diagnose.samplesInWindow.length > 0 && (
        <div className="space-y-1">
          <p className="text-label">
            Beispiele im Fenster
          </p>
          <ul className="space-y-0.5">
            {diagnose.samplesInWindow.slice(0, 5).map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 text-xs px-2 py-1 rounded-sm bg-glass-tile"
              >
                <span className="truncate flex-1">
                  {s.name ?? "—"} <span className="text-muted-foreground/70">·</span>{" "}
                  <span className="text-muted-foreground">{s.email ?? "kein Email"}</span>
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">{formatDate(s.triggerDate)}</span>
                {s.cooldownBlocked && (
                  <Badge variant="warning">
                    Cooldown
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {diagnose.samplesInWindow.length === 0 && diagnose.upcomingSample.length > 0 && (
        <div className="space-y-1">
          <p className="text-label">
            Nächste passende Tickets (außerhalb Fenster)
          </p>
          <ul className="space-y-0.5">
            {diagnose.upcomingSample.slice(0, 5).map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 text-xs px-2 py-1 rounded-sm bg-glass-tile"
              >
                <span className="truncate flex-1">
                  {s.name ?? "—"} <span className="text-muted-foreground/70">·</span>{" "}
                  <span className="text-muted-foreground">{s.email ?? "kein Email"}</span>
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">{formatDate(s.triggerDate)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {f.ticketsTotal > 0 && f.ticketsWithEmail < f.ticketsTotal && (
        <div className="space-y-2">
          <Notice tone="warning" compact icon={AlertTriangle}>
            <span>
              {f.ticketsWithEmail === 0
                ? `Keines der ${f.ticketsTotal} Tickets hat eine E-Mail-Adresse. `
                : `${f.ticketsTotal - f.ticketsWithEmail} von ${f.ticketsTotal} Tickets haben keine E-Mail-Adresse. `}
              Anny-Sync pflegt E-Mails bei jedem Lauf nach – stoße ihn jetzt manuell an, um
              Altdaten zu backfillen.
            </span>
          </Notice>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={runAnnySync}
              disabled={backfillBusy}
              className={cn("gap-1.5", TOUCH_SM)}
            >
              {backfillBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Anny-Sync jetzt starten
            </Button>
            {backfillResult && (
              <span className="text-xs text-muted-foreground">{backfillResult}</span>
            )}
          </div>
        </div>
      )}

      {f.ticketsScopeMatch > 0 && f.ticketsInWindow === 0 && (
        <Notice tone="info" compact icon={Clock}>
          <span>
            Es gibt {f.ticketsScopeMatch} grundsätzlich passende Tickets, aber gerade keines im
            Trigger-Fenster. Erhöhe „Nachhol-Fenster (Tage)“ in der Regel, wenn du verpasste Tage
            rückwirkend abdecken willst.
          </span>
        </Notice>
      )}

      {diagnose.lastSend && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Letzter Send: {formatDate(diagnose.lastSend.sentAt)} an {diagnose.lastSend.to} ·{" "}
          {diagnose.lastSend.status}
          {diagnose.lastSend.errorMessage ? ` · ${diagnose.lastSend.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}

// ── Preset Picker Dialog ────────────────────────────────────────────────────

function PresetPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (preset: PresetTemplate) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Vorlage wählen
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 mt-2">
          {PRESET_TEMPLATES.map((p) => {
            const meta = TRIGGER_META[p.defaults.trigger];
            const Icon = meta.icon;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p)}
                className="press glass-tile w-full text-left p-3 hover:border-primary/40 hover:bg-primary/10"
              >
                <div className="flex items-start gap-3">
                  {/* Kachel und Chip ohne eigene Flächen: in der Ebene getönt (Abschnitt 18). */}
                  <IconChip icon={Icon} tone="neutral" className="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{p.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant="outline">
                        {meta.label}
                      </Badge>
                      <Badge variant="outline" className="tabular-nums">
                        {p.defaults.daysOffset}d {p.defaults.trigger.startsWith("SUBSCRIPTION_EXPIRING") ? "vor" : "nach"}
                      </Badge>
                      {p.defaults.createVoucher && (
                        <Badge variant="secondary" className="tabular-nums">
                          <GiftIcon className="h-3 w-3" />
                          {p.defaults.voucherDiscountPercent}%
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Rule Edit Dialog ────────────────────────────────────────────────────────

function RuleDialog({
  open,
  rule,
  preset,
  subscriptions,
  services,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: EmailRuleDTO | null;
  preset: PresetTemplate | null;
  subscriptions: NamedRef[];
  services: NamedRef[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const isEdit = !!rule;
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<RuleTrigger>("SUBSCRIPTION_EXPIRING");
  const [daysOffset, setDaysOffset] = useState<number>(7);
  const [cooldownDays, setCooldownDays] = useState<number>(30);
  const [lookbackDays, setLookbackDays] = useState<number>(7);
  const [subscriptionId, setSubscriptionId] = useState<string>("any");
  const [serviceId, setServiceId] = useState<string>("any");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [createVoucher, setCreateVoucher] = useState(false);
  const [voucherDiscount, setVoucherDiscount] = useState<number>(10);
  const [voucherDays, setVoucherDays] = useState<number>(60);
  const [voucherTypeName, setVoucherTypeName] = useState("");
  const [renewUrl, setRenewUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setTrigger(rule.trigger);
      setDaysOffset(rule.daysOffset);
      setCooldownDays(rule.cooldownDays);
      setLookbackDays(rule.lookbackDays ?? 7);
      setSubscriptionId(rule.subscriptionId ? String(rule.subscriptionId) : "any");
      setServiceId(rule.serviceId ? String(rule.serviceId) : "any");
      setSubject(rule.subject);
      setBodyHtml(rule.bodyHtml);
      setCreateVoucher(rule.createVoucher);
      setVoucherDiscount(rule.voucherDiscountPercent ?? 10);
      setVoucherDays(rule.voucherValidDays ?? 60);
      setVoucherTypeName(rule.voucherTicketTypeName ?? "");
      setRenewUrl(rule.renewUrl ?? "");
      setIsActive(rule.isActive);
    } else if (preset) {
      const d = preset.defaults;
      setName(d.name);
      setTrigger(d.trigger);
      setDaysOffset(d.daysOffset);
      setCooldownDays(d.cooldownDays);
      setLookbackDays(7);
      setSubscriptionId("any");
      setServiceId("any");
      setSubject(d.subject);
      setBodyHtml(d.bodyHtml);
      setCreateVoucher(d.createVoucher);
      setVoucherDiscount(d.voucherDiscountPercent ?? 10);
      setVoucherDays(d.voucherValidDays ?? 60);
      setVoucherTypeName(d.voucherTicketTypeName ?? "");
      setRenewUrl(d.renewUrl ?? "");
      setIsActive(true);
    } else {
      setName("");
      setTrigger("SUBSCRIPTION_EXPIRING");
      setDaysOffset(7);
      setCooldownDays(30);
      setLookbackDays(7);
      setSubscriptionId("any");
      setServiceId("any");
      setSubject("");
      setBodyHtml("<p>Hallo {{firstName}},</p>\n<p>...</p>");
      setCreateVoucher(false);
      setVoucherDiscount(10);
      setVoucherDays(60);
      setVoucherTypeName("");
      setRenewUrl("");
      setIsActive(true);
    }
    setError("");
    setTestResult(null);
    setTestTo(getLastTestTo());
  }, [open, rule, preset]);

  const triggerInfo = TRIGGER_META[trigger];

  async function handleSave() {
    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) {
      setError("Name, Betreff und Body sind erforderlich.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        trigger,
        daysOffset: Number(daysOffset),
        cooldownDays: Number(cooldownDays),
        lookbackDays: Number(lookbackDays),
        subscriptionId: subscriptionId === "any" ? null : Number(subscriptionId),
        serviceId: serviceId === "any" ? null : Number(serviceId),
        subject: subject.trim(),
        bodyHtml,
        createVoucher,
        voucherDiscountPercent: createVoucher ? Number(voucherDiscount) : null,
        voucherValidDays: createVoucher ? Number(voucherDays) : null,
        voucherTicketTypeName: createVoucher ? (voucherTypeName.trim() || null) : null,
        renewUrl: renewUrl.trim() || null,
        isActive,
      };

      const res = isEdit
        ? await fetch(`/api/email/rules/${rule!.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/email/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(
          (typeof data?.error === "string" ? data.error : data?.error?.formErrors?.[0]) ??
            "Speichern fehlgeschlagen.",
        );
        return;
      }
      await onSaved();
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!testTo.trim()) return;
    if (!subject.trim() || !bodyHtml.trim()) {
      setTestResult({ ok: false, msg: "Betreff und HTML-Body müssen ausgefüllt sein." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email/rules/test-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: testTo.trim(),
          subject: subject.trim(),
          bodyHtml,
          trigger,
          daysOffset: Number(daysOffset),
          createVoucher,
          voucherDiscountPercent: createVoucher ? Number(voucherDiscount) : null,
          voucherValidDays: createVoucher ? Number(voucherDays) : null,
          voucherTicketTypeName: createVoucher ? (voucherTypeName.trim() || null) : null,
          renewUrl: renewUrl.trim() || null,
          ruleId: rule?.id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setLastTestTo(testTo.trim());
        setTestResult({ ok: true, msg: `Vorschau-Mail an ${testTo.trim()} verschickt.` });
      } else {
        setTestResult({
          ok: false,
          msg: typeof data.error === "string" ? data.error : "Versand fehlgeschlagen.",
        });
      }
    } catch {
      setTestResult({ ok: false, msg: "Netzwerkfehler." });
    } finally {
      setTesting(false);
    }
  }

  const showVoucherFields = createVoucher;
  const renewUrlLabel =
    trigger === "SUBSCRIPTION_EXPIRING"
      ? "Buchungs-Link für das neue Jahresabo"
      : trigger === "SUBSCRIPTION_EXPIRED"
        ? "Wiedereinstiegs-Link"
        : "CTA-Link";
  const renewUrlHelper =
    trigger === "SUBSCRIPTION_EXPIRING"
      ? "Wird im Template als {{renewUrl}} eingesetzt – Ziel ist die Buchungsseite des Jahresabos (technisch wird neu gebucht, nicht klick-verlängert)."
      : trigger === "SUBSCRIPTION_EXPIRED"
        ? "Wird im Template als {{renewUrl}} eingesetzt – idealerweise Wiedereinstiegs-Seite."
        : trigger === "DAY_VISIT_FOLLOWUP"
          ? "Wird im Template als {{renewUrl}} eingesetzt – z. B. Buchung des nächsten Besuchs."
          : "Wird im Template als {{renewUrl}} eingesetzt – z. B. die Startseite oder eine Begrüßungs-Landingpage.";
  const filterRelevant = trigger === "SUBSCRIPTION_EXPIRING" || trigger === "SUBSCRIPTION_EXPIRED" || trigger === "DAY_VISIT_FOLLOWUP" || trigger === "TICKET_WELCOME";

  const variableHints = useMemo(() => {
    const base = ["{{firstName}}", "{{lastName}}", "{{accountName}}"];
    if (trigger === "SUBSCRIPTION_EXPIRING" || trigger === "SUBSCRIPTION_EXPIRED") {
      base.push(
        "{{subscriptionName}}",
        "{{endDate}}",
        "{{daysUntilExpiry}}",
        "{{expiryHeadline}}",
        "{{expiryStatLabel}}",
        "{{expiryStatValue}}",
        "{{expiryStatSublabel}}",
      );
    }
    if (trigger === "DAY_VISIT_FOLLOWUP") base.push("{{daysSinceVisit}}", "{{ticketTypeName}}");
    if (trigger === "TICKET_WELCOME") base.push("{{ticketTypeName}}");
    if (createVoucher) base.push("{{voucherCode}}", "{{voucherDiscountPercent}}", "{{voucherExpiresAt}}");
    base.push("{{renewUrl}}");
    return base;
  }, [trigger, createVoucher]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            {isEdit ? "Regel bearbeiten" : "Neue Regel"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Abo-Erinnerung 7 Tage vor Ablauf"
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Trigger</Label>
              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
                {(Object.keys(TRIGGER_META) as RuleTrigger[]).map((t) => {
                  const m = TRIGGER_META[t];
                  const Icon = m.icon;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTrigger(t)}
                      aria-pressed={trigger === t}
                      className={cn(
                        "press flex items-center gap-2.5 rounded-tile border p-2.5 text-left",
                        // Auswahl in Akzentfarbe, sonst Glas-Kachel (in der Ebene getönt).
                        trigger === t
                          ? "border-primary/60 bg-primary/10"
                          : "glass-tile hover:border-primary/40",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", trigger === t ? "text-primary" : "text-muted-foreground")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{m.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.helper}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-days">Tage Offset</Label>
              <Input
                id="rule-days"
                type="number"
                min={0}
                max={365}
                value={daysOffset}
                onChange={(e) => setDaysOffset(Number(e.target.value) || 0)}
                className={cn("tabular-nums", FIELD)}
              />
              <p className="text-xs text-muted-foreground">{triggerInfo.helper}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-cooldown">Cooldown (Tage)</Label>
              <Input
                id="rule-cooldown"
                type="number"
                min={0}
                max={365}
                value={cooldownDays}
                onChange={(e) => setCooldownDays(Number(e.target.value) || 0)}
                className={cn("tabular-nums", FIELD)}
              />
              <p className="text-xs text-muted-foreground">Mindestabstand pro Empfänger.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-lookback">Nachhol-Fenster (Tage)</Label>
              <Input
                id="rule-lookback"
                type="number"
                min={0}
                max={365}
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value) || 0)}
                className={cn("tabular-nums", FIELD)}
              />
              <p className="text-xs text-muted-foreground">
                Holt verpasste Tage rückwirkend nach (0 = nur exakter Soll-Sendetag).
                Cooldown verhindert Doppel-Sends.
              </p>
            </div>

            {filterRelevant && (
              <>
                <div className="space-y-1.5">
                  <Label>Nur für Abo</Label>
                  <Select value={subscriptionId} onValueChange={setSubscriptionId}>
                    <SelectTrigger className={SELECT_FIELD}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Alle Abos</SelectItem>
                      {subscriptions.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Nur für Service</Label>
                  <Select value={serviceId} onValueChange={setServiceId}>
                    <SelectTrigger className={SELECT_FIELD}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Alle Services</SelectItem>
                      {services.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rule-renew">{renewUrlLabel}</Label>
              <Input
                id="rule-renew"
                type="url"
                placeholder="https://www.tuttenbrocksee.com"
                value={renewUrl}
                onChange={(e) => setRenewUrl(e.target.value)}
                className={FIELD}
              />
              <p className="text-xs text-muted-foreground">{renewUrlHelper}</p>
            </div>
          </div>

          <div className="glass-tile p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <GiftIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Rabatt-Voucher erzeugen</span>
              </div>
              <Switch checked={createVoucher} onCheckedChange={setCreateVoucher} />
            </div>
            {showVoucherFields && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="vd" className="text-[13px]">Rabatt %</Label>
                  <Input
                    id="vd"
                    type="number"
                    min={1}
                    max={100}
                    value={voucherDiscount}
                    onChange={(e) => setVoucherDiscount(Number(e.target.value) || 0)}
                    className={cn("tabular-nums", FIELD)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="vv" className="text-[13px]">Gültig (Tage)</Label>
                  <Input
                    id="vv"
                    type="number"
                    min={1}
                    max={730}
                    value={voucherDays}
                    onChange={(e) => setVoucherDays(Number(e.target.value) || 0)}
                    className={cn("tabular-nums", FIELD)}
                  />
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label htmlFor="vt" className="text-[13px]">Voucher-Bezeichnung</Label>
                  <Input
                    id="vt"
                    value={voucherTypeName}
                    onChange={(e) => setVoucherTypeName(e.target.value)}
                    placeholder="z. B. Folgebesuch"
                    className={FIELD}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-subject">Betreff</Label>
            <Input
              id="rule-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="z. B. Dein Abo läuft bald ab"
              className={FIELD}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-body">HTML-Body</Label>
            <Textarea
              id="rule-body"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              rows={9}
              className="font-mono"
            />
            <div className="flex flex-wrap gap-1.5">
              {variableHints.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setBodyHtml((prev) => prev + v)}
                  className="press inline-flex h-9 items-center rounded-full bg-muted px-2.5 font-mono text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary sm:h-7"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="glass-tile flex items-center justify-between gap-3 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Regel aktiv</p>
              <p className="text-xs text-muted-foreground">Inaktive Regeln werden vom Cron ignoriert.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="glass-tile p-3 space-y-2">
            <div className="flex items-center gap-2">
              <TestTube2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                Test-Mail mit Beispieldaten senden
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Rendert Betreff &amp; Body mit Platzhaltern wie <code className="font-mono">Max Mustermann</code> und
              fiktiven Daten – ohne dass die Regel gespeichert oder Empfänger ausgewählt werden müssen.
            </p>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="empfaenger@example.com"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !testing && testTo.trim()) {
                    e.preventDefault();
                    handleTest();
                  }
                }}
                className={cn("min-w-0", FIELD)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleTest}
                disabled={testing || !testTo.trim()}
                className={cn("gap-1.5 shrink-0", FIELD)}
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Test senden
              </Button>
            </div>
            {testResult && (
              <Notice
                tone={testResult.ok ? "success" : "danger"}
                icon={testResult.ok ? CheckCircle2 : XCircle}
                compact
                title={testResult.msg}
              />
            )}
          </div>

          {error && <Notice tone="danger" compact title={error} />}

          {/* Handy: Tasten in voller Breite, Primärtaste oben. */}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose} disabled={saving} className={FIELD}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={saving} className={cn("min-w-32", FIELD)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
