"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Send, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TelegramCardProps {
  initialConfig: {
    id: number;
    chatId: string;
    isActive: boolean;
    dailyReport: boolean;
    dailyReportTime: string;
    notifyNewDevices?: boolean;
    notifyOutages?: boolean;
  } | null;
}

const TIME_OPTIONS = [
  "08:00", "09:00", "10:00", "12:00", "14:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00",
];

export function TelegramCard({ initialConfig }: TelegramCardProps) {
  const [step, setStep] = useState<"idle" | "token" | "chat" | "done">(initialConfig ? "done" : "idle");
  const [botToken, setBotToken] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [chats, setChats] = useState<{ id: number; title: string; type: string }[]>([]);
  const [selectedChat, setSelectedChat] = useState("");
  const [dailyReport, setDailyReport] = useState(initialConfig?.dailyReport ?? true);
  const [reportTime, setReportTime] = useState(initialConfig?.dailyReportTime ?? "20:00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [config, setConfig] = useState(initialConfig);
  const [notifyNewDevices, setNotifyNewDevices] = useState(initialConfig?.notifyNewDevices ?? true);
  const [notifyOutages, setNotifyOutages] = useState(initialConfig?.notifyOutages ?? true);
  // Rückfrage vor dem Entfernen der Verbindung (docs/design-regeln.md, Abschnitt 18).
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleNotifyOutages = async () => {
    const next = !notifyOutages;
    setNotifyOutages(next);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "settings", notifyOutages: next }),
      });
      if (!res.ok) setNotifyOutages(!next);
    } catch {
      setNotifyOutages(!next);
    }
  };

  const toggleNotifyNewDevices = async () => {
    const next = !notifyNewDevices;
    setNotifyNewDevices(next);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "settings", notifyNewDevices: next }),
      });
      if (!res.ok) setNotifyNewDevices(!next);
    } catch {
      setNotifyNewDevices(!next);
    }
  };

  const handleValidate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", botToken }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error); return; }
      setBotUsername(json.botUsername);
      setChats(json.chats);
      setStep("chat");
    } catch { setError("Verbindung fehlgeschlagen"); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!selectedChat) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", botToken, chatId: selectedChat, dailyReport, dailyReportTime: reportTime }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error); return; }
      setConfig({ id: 0, chatId: selectedChat, isActive: true, dailyReport, dailyReportTime: reportTime });
      setStep("done");
    } catch { setError("Speichern fehlgeschlagen"); }
    finally { setLoading(false); }
  };

  const handleTest = async () => {
    setTestResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const json = await res.json();
      setTestResult(json.ok ? "ok" : "fail");
    } catch { setTestResult("fail"); }
    finally { setLoading(false); }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      setConfig(null);
      setStep("idle");
      setBotToken("");
      setBotUsername("");
      setChats([]);
      setSelectedChat("");
    } catch { /* ignore */ }
    finally {
      setLoading(false);
      setConfirmDelete(false);
    }
  };

  if (step === "done" && config) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge variant="success">Verbunden</Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Chat-ID</span>
            <Badge variant="mono">{config.chatId}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Tagesbericht</span>
            <span className="text-sm font-medium text-foreground tabular-nums">
              {config.dailyReport ? `Täglich um ${config.dailyReportTime}` : "Deaktiviert"}
            </span>
          </div>
          {/* Schalter wirken sofort (Baustein Switch); die Beschriftung ist mit dem Schalter verbunden und vergrößert die Tippfläche. */}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tg-notify-new-devices" className="flex-1 font-normal leading-snug text-muted-foreground cursor-pointer max-sm:min-h-11">
              Neue Geräte im Netz melden
            </Label>
            <Switch
              id="tg-notify-new-devices"
              checked={notifyNewDevices}
              onCheckedChange={toggleNotifyNewDevices}
              aria-label="Neue Geräte im Netz melden"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tg-notify-outages" className="flex-1 font-normal leading-snug text-muted-foreground cursor-pointer max-sm:min-h-11">
              Ausfälle melden (Hub, Kameras, Switch-Prüfung)
            </Label>
            <Switch
              id="tg-notify-outages"
              checked={notifyOutages}
              onCheckedChange={toggleNotifyOutages}
              aria-label="Ausfälle melden"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={loading} className="flex-1 max-sm:h-11">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Bericht testen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={loading}
              className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60 max-sm:size-11"
              title="Verbindung entfernen"
              aria-label="Verbindung entfernen"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {testResult && (
            <Notice
              tone={testResult === "ok" ? "success" : "danger"}
              icon={testResult === "ok" ? CheckCircle2 : XCircle}
              compact
              title={testResult === "ok" ? "Tagesbericht erfolgreich gesendet!" : "Fehler beim Senden"}
            />
          )}
        </CardContent>

        <AlertDialog open={confirmDelete} onOpenChange={(o) => { if (!loading) setConfirmDelete(o); }}>
          <AlertDialogContent aria-describedby={undefined}>
            <AlertDialogHeader>
              <AlertDialogTitle>Verbindung entfernen?</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={loading}>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={loading}
                onClick={(e) => {
                  // Offen lassen, bis das Entfernen fertig ist; handleDelete schließt den Dialog.
                  e.preventDefault();
                  void handleDelete();
                }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Verbindung entfernen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        {step === "idle" && (
          <>
            <p className="text-sm text-muted-foreground">
              Erstelle einen Telegram Bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-primary font-medium hover:underline">@BotFather</a>,
              fuege ihn zu einer Gruppe hinzu und sende dort eine Nachricht. Dann gib hier den Bot-Token ein.
            </p>
            <Button size="sm" onClick={() => setStep("token")} className="max-sm:h-11">Bot einrichten</Button>
          </>
        )}

        {step === "token" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="tg-bot-token">Bot Token</Label>
              <Input
                id="tg-bot-token"
                type="text"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              />
            </div>
            {error && <Notice tone="danger" compact title={error} />}
            {/* Primärtaste rechts, Abbrechen links davon; auf dem Handy volle Breite, Primärtaste oben (Abschnitt 16). */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button size="sm" variant="ghost" onClick={() => { setStep("idle"); setError(""); }} className="max-sm:h-11">Abbrechen</Button>
              <Button size="sm" onClick={handleValidate} disabled={!botToken || loading} className="max-sm:h-11">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Validieren
              </Button>
            </div>
          </>
        )}

        {step === "chat" && (
          <>
            <Notice tone="success" compact title={`Bot @${botUsername} verbunden`} />

            {chats.length > 0 ? (
              <div className="space-y-1.5">
                <Label>Chat auswählen</Label>
                {/* Auswahl in Akzentfarbe (docs/design-regeln.md, Abschnitt 17). */}
                <div className="space-y-1.5">
                  {chats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => setSelectedChat(String(chat.id))}
                      aria-pressed={selectedChat === String(chat.id)}
                      className={cn(
                        "glass-tile press w-full text-left px-3 py-2 text-sm max-sm:min-h-11",
                        selectedChat === String(chat.id)
                          ? "border-primary/60 bg-primary/10"
                          : "hover:bg-glass-strong",
                      )}
                    >
                      <span className="font-medium">{chat.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">{chat.type} · {chat.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="tg-chat-id">Chat-ID manuell eingeben</Label>
                <Input
                  id="tg-chat-id"
                  type="text"
                  value={selectedChat}
                  onChange={(e) => setSelectedChat(e.target.value)}
                  placeholder="-1001234567890"
                />
                <p className="text-xs text-muted-foreground">
                  Sende eine Nachricht in den Chat und klicke dann &quot;Aktualisieren&quot;, oder gib die Chat-ID manuell ein.
                </p>
                <Button size="sm" variant="outline" className="mt-2 max-sm:h-11" onClick={handleValidate} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Aktualisieren
                </Button>
              </div>
            )}

            <div className="space-y-3 pt-2 border-t border-border">
              {/* Option im Formular, wirkt erst beim Speichern: Kästchen statt Schalter (Abschnitt 14). */}
              <div className="flex items-center gap-2 max-sm:min-h-11">
                <Checkbox
                  id="tg-daily-report"
                  checked={dailyReport}
                  onCheckedChange={() => setDailyReport(!dailyReport)}
                />
                <Label htmlFor="tg-daily-report" className="cursor-pointer">Tagesbericht</Label>
              </div>
              {dailyReport && (
                <div className="space-y-1.5">
                  <Label htmlFor="tg-report-time">Uhrzeit (Berlin)</Label>
                  <NativeSelect
                    id="tg-report-time"
                    value={reportTime}
                    onChange={(e) => setReportTime(e.target.value)}
                    className="tabular-nums max-sm:h-11"
                  >
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t} Uhr</option>)}
                  </NativeSelect>
                </div>
              )}
            </div>

            {error && <Notice tone="danger" compact title={error} />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button size="sm" variant="ghost" onClick={() => { setStep("idle"); setError(""); }} className="max-sm:h-11">Abbrechen</Button>
              <Button size="sm" onClick={handleSave} disabled={!selectedChat || loading} className="max-sm:h-11">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Speichern
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
