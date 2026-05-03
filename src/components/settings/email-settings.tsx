"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRESET_TEMPLATES, type PresetTemplate } from "@/lib/email-templates";

type RuleTrigger =
  | "SUBSCRIPTION_EXPIRING"
  | "SUBSCRIPTION_EXPIRED"
  | "DAY_VISIT_FOLLOWUP"
  | "TICKET_WELCOME";

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

const TRIGGER_META: Record<
  RuleTrigger,
  { label: string; helper: string; icon: typeof CalendarClock; color: string }
> = {
  SUBSCRIPTION_EXPIRING: {
    label: "Abo läuft aus",
    helper: "Tage VOR endDate",
    icon: CalendarClock,
    color: "text-amber-600 dark:text-amber-400",
  },
  SUBSCRIPTION_EXPIRED: {
    label: "Abo abgelaufen",
    helper: "Tage NACH endDate",
    icon: CalendarX,
    color: "text-rose-600 dark:text-rose-400",
  },
  DAY_VISIT_FOLLOWUP: {
    label: "Tagesgast Followup",
    helper: "Tage NACH erstem Scan",
    icon: Smile,
    color: "text-emerald-600 dark:text-emerald-400",
  },
  TICKET_WELCOME: {
    label: "Welcome",
    helper: "Tage NACH Ticket-Anlage",
    icon: Sparkles,
    color: "text-indigo-600 dark:text-indigo-400",
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
    <div className="space-y-4">
      <EmailConfigCard config={config} onConfigChange={setConfig} />

      {config && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Automatische Mails</h3>
                <p className="text-xs text-slate-500">
                  Regelbasierte Mails zu Aboablauf, Followups und Welcome-Nachrichten.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => setPresetPickerOpen(true)} className="gap-1.5">
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  Aus Vorlage
                </Button>
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-1.5" onClick={handleNewBlank}>
                  <Plus className="h-4 w-4" />
                  Neue Regel
                </Button>
              </div>
            </div>

            {rulesLoading && rules == null ? (
              <div className="py-6 text-center text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
              </div>
            ) : rules && rules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 text-center">
                <Mail className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Noch keine Regeln</p>
                <p className="text-xs text-slate-400 mt-1">
                  Lege jetzt deine erste automatische Mail an – am schnellsten geht es mit einer Vorlage.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 gap-1.5"
                  onClick={() => setPresetPickerOpen(true)}
                >
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  Vorlage wählen
                </Button>
              </div>
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
    if (!confirm("Email-Konfiguration wirklich löschen? Aktive Regeln werden nicht ausgelöst.")) return;
    setSaving(true);
    try {
      await fetch("/api/email/config", { method: "DELETE" });
      onConfigChange(null);
    } finally {
      setSaving(false);
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
      <Card className="border-slate-200 dark:border-slate-800">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-indigo-500" />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Versand-Konfiguration</span>
            </div>
            <Badge
              className={cn(
                "text-xs",
                config.isActive && config.hasApiKey
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
              )}
            >
              {config.isActive && config.hasApiKey ? "Aktiv" : config.hasApiKey ? "Deaktiviert" : "Kein API-Key"}
            </Badge>
          </div>
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
                config.hasApiKey ? config.apiKey ?? "•••" : <span className="text-rose-500">fehlt</span>
              }
              mono
            />
          </div>
          <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
            <Label htmlFor="email-test-to" className="text-xs text-slate-500">
              Test-Mail senden an
            </Label>
            <div className="flex gap-2">
              <Input
                id="email-test-to"
                type="email"
                placeholder="dein@verein.de"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                className="h-9"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || !testTo.trim() || !config.hasApiKey}
                className="gap-1.5 shrink-0"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Senden
              </Button>
            </div>
            {testResult && (
              <div
                className={cn(
                  "flex items-start gap-2 p-2.5 rounded-lg text-xs font-medium",
                  testResult === "ok"
                    ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400"
                    : "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400",
                )}
              >
                {testResult === "ok" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{testMessage}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4 mr-1.5" />
              Bearbeiten
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={saving}
              className="text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300 ml-auto"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {config ? "Konfiguration bearbeiten" : "Email-Versand einrichten"}
          </span>
        </div>
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2.5 text-xs text-slate-700 dark:text-slate-300 space-y-1">
          <p className="font-medium text-indigo-700 dark:text-indigo-300">So richtest du Gmail ein:</p>
          <ol className="list-decimal list-inside space-y-0.5 text-slate-600 dark:text-slate-400">
            <li>2-Faktor-Authentifizierung im Google-Konto aktivieren</li>
            <li>
              Unter{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener"
                className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
              >
                myaccount.google.com/apppasswords
              </a>{" "}
              ein App-Passwort erzeugen
            </li>
            <li>App-Passwort + Gmail-Adresse hier eintragen</li>
          </ol>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="email-from">
              Gmail-Adresse <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="email-from"
              type="email"
              placeholder="dein-account@gmail.com"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <p className="text-[11px] text-slate-400">
              Auch erlaubt: in Gmail verifizierter Alias (z. B. eigene Domain).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-api-key">Gmail App-Passwort <span className="text-rose-500">*</span></Label>
            <Input
              id="email-api-key"
              type="password"
              autoComplete="new-password"
              placeholder={keepKey ? "•••• gespeichert (leer = unverändert)" : "16-stelliges App-Passwort"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {keepKey && (
              <p className="text-[11px] text-slate-400">
                <button type="button" onClick={() => setKeepKey(false)} className="underline hover:text-rose-500">
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
                className="h-9 w-12 p-1 shrink-0 cursor-pointer"
              />
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                placeholder="#4F46E5"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-between sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Versand aktiv</p>
              <p className="text-xs text-slate-400">Wenn aus, werden keine automatischen Mails versendet.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving || !fromEmail.trim()} className="bg-indigo-600 hover:bg-indigo-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Speichern
          </Button>
          {config && (
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Abbrechen
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={cn("text-slate-800 dark:text-slate-200 truncate", mono && "font-mono text-xs")}>
        {value}
      </span>
    </div>
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
  const [busy, setBusy] = useState<"toggle" | "delete" | "run" | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const meta = TRIGGER_META[rule.trigger];
  const Icon = meta.icon;

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
    if (!confirm(`Regel "${rule.name}" löschen?`)) return;
    setBusy("delete");
    try {
      await fetch(`/api/email/rules/${rule.id}`, { method: "DELETE" });
      await onChanged();
    } finally {
      setBusy(null);
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

  return (
    <li
      className={cn(
        "rounded-lg border bg-white dark:bg-slate-950 transition-colors",
        rule.isActive
          ? "border-slate-200 dark:border-slate-800"
          : "border-slate-200 dark:border-slate-800 opacity-60",
      )}
    >
      <div className="flex items-center gap-3 p-3 flex-wrap">
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 shrink-0")}>
          <Icon className={cn("h-4 w-4", meta.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{rule.name}</p>
            {rule.createVoucher && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] gap-1">
                <GiftIcon className="h-3 w-3" />
                {rule.voucherDiscountPercent ?? 0}%
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">
            <span className={meta.color}>{meta.label}</span>
            <span className="text-slate-300 mx-1.5">·</span>
            {rule.daysOffset} Tage <span className="text-slate-400">({meta.helper})</span>
            <span className="text-slate-300 mx-1.5">·</span>
            <Clock className="h-3 w-3 inline mb-0.5" /> Cooldown {rule.cooldownDays}d
            <span className="text-slate-300 mx-1.5">·</span>
            {rule.sentCount} versendet
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Switch checked={rule.isActive} onCheckedChange={toggle} disabled={busy !== null} size="sm" />
          <Button variant="ghost" size="icon" onClick={runNow} disabled={busy !== null} title="Jetzt ausführen">
            {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onEdit} disabled={busy !== null} title="Bearbeiten">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={remove}
            disabled={busy !== null}
            className="text-rose-500 hover:text-rose-600"
            title="Löschen"
          >
            {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {runMsg && (
        <div className="border-t border-slate-100 dark:border-slate-800 px-3 py-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 rounded-b-lg">
          {runMsg}
        </div>
      )}
    </li>
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
            <Sparkles className="h-5 w-5 text-indigo-600" />
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
                className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 p-3 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 shrink-0">
                    <Icon className={cn("h-4 w-4", meta.color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{p.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{p.description}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {meta.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {p.defaults.daysOffset}d {p.defaults.trigger.startsWith("SUBSCRIPTION_EXPIRING") ? "vor" : "nach"}
                      </Badge>
                      {p.defaults.createVoucher && (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] gap-1">
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

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setTrigger(rule.trigger);
      setDaysOffset(rule.daysOffset);
      setCooldownDays(rule.cooldownDays);
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

  const showVoucherFields = createVoucher;
  const showRenewUrl = trigger === "SUBSCRIPTION_EXPIRING";
  const filterRelevant = trigger === "SUBSCRIPTION_EXPIRING" || trigger === "SUBSCRIPTION_EXPIRED" || trigger === "DAY_VISIT_FOLLOWUP" || trigger === "TICKET_WELCOME";

  const variableHints = useMemo(() => {
    const base = ["{{firstName}}", "{{lastName}}", "{{accountName}}"];
    if (trigger === "SUBSCRIPTION_EXPIRING" || trigger === "SUBSCRIPTION_EXPIRED") {
      base.push("{{subscriptionName}}", "{{endDate}}", "{{daysUntilExpiry}}");
    }
    if (trigger === "DAY_VISIT_FOLLOWUP") base.push("{{daysSinceVisit}}", "{{ticketTypeName}}");
    if (createVoucher) base.push("{{voucherCode}}", "{{voucherDiscountPercent}}", "{{voucherExpiresAt}}");
    if (trigger === "SUBSCRIPTION_EXPIRING") base.push("{{renewUrl}}");
    return base;
  }, [trigger, createVoucher]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-indigo-600" />
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
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Trigger</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TRIGGER_META) as RuleTrigger[]).map((t) => {
                  const m = TRIGGER_META[t];
                  const Icon = m.icon;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTrigger(t)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-all",
                        trigger === t
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", m.color)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{m.label}</p>
                        <p className="text-xs text-slate-400 truncate">{m.helper}</p>
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
              />
              <p className="text-xs text-slate-400">{triggerInfo.helper}</p>
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
              />
              <p className="text-xs text-slate-400">Mindestabstand pro Empfänger.</p>
            </div>

            {filterRelevant && (
              <>
                <div className="space-y-1.5">
                  <Label>Nur für Abo</Label>
                  <Select value={subscriptionId} onValueChange={setSubscriptionId}>
                    <SelectTrigger className="h-9 text-sm">
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
                    <SelectTrigger className="h-9 text-sm">
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

            {showRenewUrl && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rule-renew">Renew-URL</Label>
                <Input
                  id="rule-renew"
                  type="url"
                  placeholder="https://verein.de/abo-verlaengern"
                  value={renewUrl}
                  onChange={(e) => setRenewUrl(e.target.value)}
                />
                <p className="text-xs text-slate-400">
                  Verfügbar im Template als <code className="font-mono">{"{{renewUrl}}"}</code>.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GiftIcon className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">Rabatt-Voucher erzeugen</span>
              </div>
              <Switch checked={createVoucher} onCheckedChange={setCreateVoucher} />
            </div>
            {showVoucherFields && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="vd" className="text-xs">Rabatt %</Label>
                  <Input
                    id="vd"
                    type="number"
                    min={1}
                    max={100}
                    value={voucherDiscount}
                    onChange={(e) => setVoucherDiscount(Number(e.target.value) || 0)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="vv" className="text-xs">Gültig (Tage)</Label>
                  <Input
                    id="vv"
                    type="number"
                    min={1}
                    max={730}
                    value={voucherDays}
                    onChange={(e) => setVoucherDays(Number(e.target.value) || 0)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label htmlFor="vt" className="text-xs">Voucher-Bezeichnung</Label>
                  <Input
                    id="vt"
                    value={voucherTypeName}
                    onChange={(e) => setVoucherTypeName(e.target.value)}
                    placeholder="z. B. Folgebesuch"
                    className="h-9"
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
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-body">HTML-Body</Label>
            <textarea
              id="rule-body"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              rows={9}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            <div className="flex flex-wrap gap-1">
              {variableHints.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setBodyHtml((prev) => prev + v)}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-100 dark:bg-slate-800 dark:hover:bg-indigo-900/40 text-slate-600 dark:text-slate-300 transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Regel aktiv</p>
              <p className="text-xs text-slate-400">Inaktive Regeln werden vom Cron ignoriert.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {error && <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/20 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 min-w-32">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
