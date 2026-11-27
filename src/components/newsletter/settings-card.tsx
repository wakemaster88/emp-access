"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface NewsletterSettings {
  enabled: boolean;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  configurationSet: string;
  snsTopicArn: string;
  linkBaseUrl: string;
  consentText: string;
  brandColor: string;
  accentColor: string;
  logoUrl: string;
}

type TextKey = Exclude<keyof NewsletterSettings, "enabled">;

const FIELDS: Array<{ key: TextKey; label: string; hint: string; placeholder?: string; type?: string; max: number }> = [
  { key: "fromEmail", label: "Absender-Adresse", hint: "Muss zur Domain gehören, die in SES bestätigt ist.", placeholder: "newsletter@tuttenbrocksee.com", type: "email", max: 180 },
  { key: "fromName", label: "Absender-Name", hint: "So steht es im Postfach.", max: 80 },
  { key: "replyTo", label: "Antwort an", hint: "Wohin Antworten auf den Newsletter gehen. Leer: an die Absender-Adresse.", type: "email", max: 180 },
  { key: "configurationSet", label: "Konfigurationssatz", hint: "Name des Konfigurationssatzes in SES, der Rückläufer an SNS meldet.", placeholder: "newsletter", max: 64 },
  { key: "snsTopicArn", label: "SNS-Thema (ARN)", hint: "Nur Meldungen von diesem Thema nimmt emp-access an.", placeholder: "arn:aws:sns:eu-central-1:123456789012:newsletter-events", max: 300 },
  { key: "linkBaseUrl", label: "Adresse der Links", hint: "Wo Bestätigen und Abmelden liegen. Leer: diese App unter /nl.", placeholder: "https://www.tuttenbrocksee.com/newsletter", max: 300 },
];

/** Aussehen der Mails und der Seiten Bestätigen/Abmelden; leer = wie die Website. */
const DESIGN_FIELDS: typeof FIELDS = [
  { key: "brandColor", label: "Farbe", hint: "Tasten und Links, als #RRGGBB. Leer: Petrol #1a6d73 wie die Website.", placeholder: "#1a6d73", max: 7 },
  { key: "accentColor", label: "Akzentfarbe", hint: "Linie unter dem Logo und „Newsletter abbestellen“ im dunklen Fuß. Leer: Gelb #fbbf24.", placeholder: "#fbbf24", max: 7 },
  { key: "logoUrl", label: "Logo", hint: "https-Adresse eines PNG oder JPG, etwa 5:1 und 600 px breit. Dunkle Schrift braucht einen weißen Grund im Bild, sonst ist sie im Dunkelmodus nicht lesbar. Leer: Logo aus den E-Mail-Einstellungen, sonst der Name.", placeholder: "https://…/logo.png", max: 2000 },
];
const ALL_FIELDS = [...FIELDS, ...DESIGN_FIELDS];

function Swatch({ value }: { value: string }) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
  return <span aria-hidden className="inline-block h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-glass-border" style={{ background: value }} />;
}

/** Absender, AWS-Anbindung, Links, Einwilligungstext und Aussehen. */
export function NewsletterSettingsCard({
  config,
  defaultFromName,
  defaultConsent,
  linkBase,
  hasCredentials,
}: {
  config: NewsletterSettings;
  defaultFromName: string;
  defaultConsent: string;
  /** Aktuelle Basis der Links. */
  linkBase: string;
  hasCredentials: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState(config);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = ALL_FIELDS.some((f) => form[f.key] !== config[f.key]) || form.consentText !== config.consentText;
  const canEnable = hasCredentials && !!config.fromEmail;

  async function put(body: Partial<NewsletterSettings>): Promise<Record<string, unknown> | null> {
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/newsletter/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return null;
      }
      router.refresh();
      return json;
    } catch {
      setError("Netzwerkfehler");
      return null;
    }
  }

  async function save() {
    setSaving(true);
    const { enabled: _enabled, ...fields } = form;
    void _enabled;
    const result = await put(fields);
    if (result) {
      // Gespeicherte Schreibweise übernehmen (Adressen klein, Links ohne Schrägstrich am Ende).
      setForm((f) => {
        const next = { ...f };
        for (const { key } of ALL_FIELDS) next[key] = typeof result[key] === "string" ? (result[key] as string) : "";
        next.consentText = typeof result.consentText === "string" ? result.consentText : "";
        return next;
      });
      setSaved(true);
    }
    setSaving(false);
  }

  async function toggle(enabled: boolean) {
    setSwitching(true);
    setForm((f) => ({ ...f, enabled }));
    if (!(await put({ enabled }))) setForm((f) => ({ ...f, enabled: !enabled }));
    setSwitching(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-4 w-4 shrink-0 text-primary" />
          Einstellungen
        </CardTitle>
        <CardDescription>Versand über Amazon SES. Die Anleitung für AWS steht im Projekt.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="glass-tile flex min-h-11 items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <Label htmlFor="nl-enabled">Versand eingeschaltet</Label>
            <p className="text-xs text-muted-foreground">
              {canEnable
                ? "Aus: keine Bestätigungsmails und keine Aussendungen. Testmails gehen trotzdem."
                : "Geht erst mit SES-Zugangsdaten in Vercel und gespeicherter Absender-Adresse."}
            </p>
          </div>
          <Switch
            id="nl-enabled"
            checked={form.enabled}
            disabled={switching || (!form.enabled && !canEnable)}
            onCheckedChange={(v) => void toggle(v)}
          />
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`nl-${f.key}`}>{f.label}</Label>
              <Input
                id={`nl-${f.key}`}
                type={f.type ?? "text"}
                value={form[f.key]}
                maxLength={f.max}
                placeholder={f.key === "fromName" ? defaultFromName : f.placeholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                className="max-sm:h-11"
              />
              <p className="text-xs text-muted-foreground">
                {f.hint}
                {f.key === "linkBaseUrl" && (
                  <>
                    <span className="block break-all">Jetzt: {linkBase}/bestaetigen</span>
                    <span className="block break-all">Abmelden ohne Mail, zum Verlinken auf der Website: {linkBase}/abmelden</span>
                  </>
                )}
              </p>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="nl-consent">Einwilligungstext</Label>
            <Textarea
              id="nl-consent"
              value={form.consentText}
              maxLength={2000}
              rows={4}
              placeholder={defaultConsent}
              onChange={(e) => setForm((s) => ({ ...s, consentText: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Wird mit jeder Anmeldung gespeichert, wenn die Website keinen eigenen Text schickt. Leer: der Text oben in Grau.
            </p>
          </div>

          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Aussehen</p>
              <p className="text-xs text-muted-foreground">Für alle Mails des Newsletters und die Seiten zum Bestätigen und Abmelden.</p>
            </div>
            {DESIGN_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`nl-${f.key}`} className="flex items-center gap-2">
                  {f.label}
                  {f.key !== "logoUrl" && <Swatch value={form[f.key] || (f.placeholder ?? "")} />}
                </Label>
                <Input
                  id={`nl-${f.key}`}
                  type={f.key === "logoUrl" ? "url" : "text"}
                  value={form[f.key]}
                  maxLength={f.max}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="max-sm:h-11"
                />
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </div>

          {error && <Notice tone="danger" compact title={error} />}
          {saved && !dirty && <Notice tone="success" compact title="Gespeichert." />}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !dirty} className="min-w-28 max-sm:h-11 max-sm:w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" />Speichern</>}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
