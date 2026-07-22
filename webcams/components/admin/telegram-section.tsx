"use client";

import { useEffect, useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { TelegramConfig, TelegramEventToggles } from "@/lib/types";
import {
  Bell,
  CheckCircle2,
  Link2,
  Loader2,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";

interface TelegramSectionProps {
  value: TelegramConfig;
  onChange: (next: TelegramConfig) => void;
  /** Nach Server-seitigen Änderungen (z. B. Webhook-Secret) Settings neu laden. */
  onPersistedChange?: () => void | Promise<void>;
}

interface EventTile {
  key: keyof TelegramEventToggles;
  title: string;
  hint: string;
}

const EVENTS: EventTile[] = [
  {
    key: "doorOpen",
    title: "Tür geöffnet",
    hint: "UI-Klick oder ALPR — Snapshot vom Doorbird",
  },
  {
    key: "doorRing",
    title: "Es klingelt",
    hint: "Webhook von der Doorbird — Snapshot mit",
  },
  {
    key: "alprMatched",
    title: "Whitelist-Plate erkannt",
    hint: "Doppelt zu Tür-geöffnet. In der Regel AUS lassen.",
  },
  {
    key: "alprUnauthorized",
    title: "Unbekanntes Kennzeichen",
    hint: "Erkannte Plates, die NICHT auf der Whitelist sind",
  },
  {
    key: "alprCooldown",
    title: "Plate im Cooldown",
    hint: "Whitelist-Treffer, aber zu kurz nach letzter Öffnung",
  },
];

export function TelegramSection({
  value,
  onChange,
  onPersistedChange,
}: TelegramSectionProps) {
  const [testing, setTesting] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [webhookBase, setWebhookBase] = useState("");
  const [webhookBusy, setWebhookBusy] = useState<"register" | "delete" | null>(
    null,
  );
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window !== "undefined") {
      setWebhookBase(window.location.origin);
    }
  }, []);

  function update<K extends keyof TelegramConfig>(key: K, val: TelegramConfig[K]) {
    onChange({ ...value, [key]: val });
  }

  function toggleEvent(key: keyof TelegramEventToggles, v: boolean) {
    onChange({ ...value, events: { ...value.events, [key]: v } });
  }

  function addChat() {
    const id = chatInput.trim();
    if (!id) return;
    if (value.chatIds.includes(id)) {
      toast("Chat-ID bereits in der Liste", "info");
      return;
    }
    update("chatIds", [...value.chatIds, id]);
    setChatInput("");
  }

  function removeChat(id: string) {
    update(
      "chatIds",
      value.chatIds.filter((c) => c !== id),
    );
  }

  async function runTest() {
    if (value.chatIds.length === 0) {
      toast("Mind. eine Chat-ID nötig", "error");
      return;
    }
    setTesting(true);
    try {
      const r = await fetch("/api/notify/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // botToken === "" lässt die Server-Route den gespeicherten Token nehmen.
        // Falls der User gerade einen neuen Token eingegeben hat (kein "***"),
        // schicken wir den mit zum Testen — sonst muss erst gespeichert werden.
        body: JSON.stringify({
          botToken:
            value.botToken && value.botToken !== "***"
              ? value.botToken
              : undefined,
          chatIds: value.chatIds,
        }),
      });
      const j = (await r.json()) as {
        ok: boolean;
        error?: string;
        bot?: { username?: string };
        perChat?: { chatId: string; ok: boolean; error?: string }[];
      };
      if (!r.ok || !j.ok) {
        const failing = j.perChat?.filter((p) => !p.ok) ?? [];
        if (failing.length) {
          toast(
            `Fehler bei ${failing.length} Chat-IDs: ${failing[0].error ?? "unbekannt"}`,
            "error",
          );
        } else {
          toast(j.error ?? "Test fehlgeschlagen", "error");
        }
        return;
      }
      toast(
        `Bot ${j.bot?.username ? `@${j.bot.username} ` : ""}OK · ${
          j.perChat?.length ?? 0
        } Chats erreicht`,
        "success",
      );
    } catch (e) {
      toast(`Fehler: ${(e as Error).message}`, "error");
    } finally {
      setTesting(false);
    }
  }

  async function registerWebhook() {
    const base = webhookBase.trim();
    if (!base) {
      toast("Öffentliche Basis-URL fehlt", "error");
      return;
    }
    if (!base.startsWith("https://")) {
      toast(
        "Nur HTTPS ist möglich (Telegram-Vorgabe). Öffentliche URL eintragen — nicht http://localhost.",
        "error",
      );
      return;
    }
    setWebhookBusy("register");
    try {
      const r = await fetch("/api/telegram/set-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicBaseUrl: base,
          botToken:
            value.botToken && value.botToken !== "***"
              ? value.botToken
              : undefined,
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        error?: string;
        webhookUrl?: string;
      };
      if (!r.ok || !j.ok) {
        toast(j.error ?? "Webhook konnte nicht gesetzt werden", "error");
        return;
      }
      toast(
        j.webhookUrl
          ? `Webhook aktiv: ${j.webhookUrl}`
          : "Webhook bei Telegram registriert",
        "success",
      );
      await onPersistedChange?.();
    } catch (e) {
      toast(`Fehler: ${(e as Error).message}`, "error");
    } finally {
      setWebhookBusy(null);
    }
  }

  async function deleteWebhook() {
    setWebhookBusy("delete");
    try {
      const r = await fetch("/api/telegram/set-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delete: true,
          botToken:
            value.botToken && value.botToken !== "***"
              ? value.botToken
              : undefined,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        toast(j.error ?? "Webhook konnte nicht gelöscht werden", "error");
        return;
      }
      toast("Webhook bei Telegram entfernt", "success");
      await onPersistedChange?.();
    } catch (e) {
      toast(`Fehler: ${(e as Error).message}`, "error");
    } finally {
      setWebhookBusy(null);
    }
  }

  const tokenSet = value.botToken === "***" || (value.botToken?.length ?? 0) > 10;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Telegram-Benachrichtigungen</CardTitle>
          <CardDescription>
            Schickt Push-Nachrichten mit Snapshot bei ausgewählten Ereignissen.
            Funktioniert mit einem Telegram-Bot von BotFather.
          </CardDescription>
        </div>
        {value.enabled ? (
          <Badge variant="success">
            <Bell className="size-3" />
            aktiv
          </Badge>
        ) : (
          <Badge variant="default">deaktiviert</Badge>
        )}
      </CardHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Aktiv">
          <div className="flex h-10 items-center">
            <Switch
              checked={value.enabled}
              onChange={(v) => update("enabled", v)}
            />
          </div>
        </Field>
        <Field label="Bilder mitschicken" hint="Snapshot vom Doorbird/ALPR">
          <div className="flex h-10 items-center">
            <Switch
              checked={value.includeSnapshot}
              onChange={(v) => update("includeSnapshot", v)}
            />
          </div>
        </Field>
      </div>

      <div className="mt-4 grid gap-4">
        <Field
          label="Bot-Token"
          hint="Von BotFather (z.B. 123456:ABC-DEF...). Leer = unverändert."
        >
          <Input
            type="password"
            value={value.botToken === "***" ? "" : value.botToken}
            onChange={(e) => update("botToken", e.target.value)}
            placeholder={value.botToken === "***" ? "(gesetzt)" : "123456:ABC..."}
          />
        </Field>

        <div>
          <p className="mb-2 block text-xs font-medium uppercase tracking-wider text-foreground/60">
            Chat-IDs
          </p>
          <p className="mb-2 text-xs text-foreground/50">
            Numerische User- oder Gruppen-IDs (-100… für Kanäle).{" "}
            <b>Mit Webhook unten:</b> „/start“ im Chat — der Bot antwortet mit
            deiner Chat-ID.{" "}
            <b>Ohne Webhook:</b> in der Telegram-API{" "}
            <code className="rounded bg-tile-accent px-1 py-0.5 font-mono text-[11px]">
              …/bot&lt;TOKEN&gt;/getUpdates
            </code>{" "}
            die <code className="font-mono text-[11px]">chat.id</code> ablesen.
          </p>

          <div className="flex gap-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addChat();
                }
              }}
              placeholder="z.B. 123456789 oder -1001234567890"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={addChat}
              disabled={!chatInput.trim()}
            >
              <Plus className="size-4" />
              Hinzufügen
            </Button>
          </div>

          {value.chatIds.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {value.chatIds.map((id) => (
                <li
                  key={id}
                  className="inline-flex items-center gap-2 rounded-full bg-tile-accent px-3 py-1 text-xs ring-1 ring-border"
                >
                  <code className="font-mono">{id}</code>
                  <button
                    type="button"
                    onClick={() => removeChat(id)}
                    className="text-foreground/60 hover:text-red-400"
                    aria-label={`${id} entfernen`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-foreground/50">
              Noch keine Chat-ID. Mind. eine ist nötig, damit Nachrichten ankommen.
            </p>
          )}
        </div>

        <div className="rounded-lg bg-tile-accent/50 p-3 ring-1 ring-border">
          <div className="mb-2 flex items-center gap-2">
            <Link2 className="size-4 opacity-70" />
            <span className="text-sm font-medium">Telegram-Webhook („/start“)</span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-foreground/55">
            Diese App hat vorher nur <i>ausgehend</i> Nachrichten geschickt — auf
            „/start“ konnte der Bot nicht reagieren. Mit registriertem Webhook (HTTPS,
            aus dem Internet erreichbar) antwortet er auf „/start“ und schickt dir
            die Chat-ID zum Kopieren.
          </p>
          {value.webhookSecret === "***" ? (
            <p className="mb-3 text-xs text-emerald-700/90 dark:text-emerald-400/90">
              Webhook-Secret ist in der Konfiguration gespeichert.
            </p>
          ) : (
            <p className="mb-3 text-xs text-foreground/50">
              Beim ersten erfolgreichen Eintragen wird ein Secret erzeugt und
              gespeichert (unter „Einstellungen speichern“ nicht nötig).
            </p>
          )}
          <Field
            label="Öffentliche Basis-URL"
            hint="Muss mit https:// beginnen und zu dieser Next-App zeigen (z. B. Reverse-Proxy)."
          >
            <Input
              value={webhookBase}
              onChange={(e) => setWebhookBase(e.target.value)}
              placeholder="https://deine-domain.example"
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={registerWebhook}
              disabled={webhookBusy !== null || !tokenSet}
            >
              {webhookBusy === "register" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Webhook eintragen
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={deleteWebhook}
              disabled={webhookBusy !== null || !tokenSet}
            >
              {webhookBusy === "delete" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Webhook entfernen
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-2 block text-xs font-medium uppercase tracking-wider text-foreground/60">
            Ereignisse
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {EVENTS.map((ev) => (
              <label
                key={ev.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg bg-tile-accent p-3 ring-1 ring-border hover:ring-focus/50"
              >
                <Switch
                  checked={value.events[ev.key]}
                  onChange={(v) => toggleEvent(ev.key, v)}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{ev.title}</p>
                  <p className="text-xs text-foreground/60">{ev.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-tile-accent/50 p-3 ring-1 ring-border">
          <Button
            variant="secondary"
            size="sm"
            onClick={runTest}
            disabled={testing || (!tokenSet && !value.botToken) || value.chatIds.length === 0}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Test-Nachricht schicken
          </Button>
          <p className="flex-1 text-xs text-foreground/60">
            Sendet eine Bestätigung an alle Chat-IDs. Vorher „/start“ oder Chat-ID
            eintragen — bei registriertem Webhook liefert „/start“ die ID automatisch.
          </p>
          {tokenSet ? (
            <Badge variant="success">
              <CheckCircle2 className="size-3" />
              Token gesetzt
            </Badge>
          ) : (
            <Badge variant="default">
              <XCircle className="size-3" />
              kein Token
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
