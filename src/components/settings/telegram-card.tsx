"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TelegramCardProps {
  initialConfig: {
    id: number;
    chatId: string;
    isActive: boolean;
    dailyReport: boolean;
    dailyReportTime: string;
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
    finally { setLoading(false); }
  };

  if (step === "done" && config) {
    return (
      <Card className="border-slate-200 dark:border-slate-800">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Status</span>
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">Verbunden</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Chat-ID</span>
            <Badge variant="outline" className="font-mono text-xs">{config.chatId}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Tagesbericht</span>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {config.dailyReport ? `Täglich um ${config.dailyReportTime}` : "Deaktiviert"}
            </span>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={loading} className="flex-1">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
              Testnachricht
            </Button>
            <Button variant="outline" size="sm" onClick={handleDelete} disabled={loading} className="text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {testResult && (
            <div className={cn(
              "flex items-center gap-2 p-2.5 rounded-lg text-xs font-medium",
              testResult === "ok" ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400" : "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400",
            )}>
              {testResult === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {testResult === "ok" ? "Nachricht erfolgreich gesendet!" : "Fehler beim Senden"}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="pt-5 space-y-4">
        {step === "idle" && (
          <>
            <p className="text-sm text-slate-500">
              Erstelle einen Telegram Bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">@BotFather</a>,
              fuege ihn zu einer Gruppe hinzu und sende dort eine Nachricht. Dann gib hier den Bot-Token ein.
            </p>
            <Button size="sm" onClick={() => setStep("token")}>Bot einrichten</Button>
          </>
        )}

        {step === "token" && (
          <>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Bot Token</label>
              <input
                type="text"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleValidate} disabled={!botToken || loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Validieren
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setStep("idle"); setError(""); }}>Abbrechen</Button>
            </div>
          </>
        )}

        {step === "chat" && (
          <>
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Bot @{botUsername} verbunden
            </div>

            {chats.length > 0 ? (
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Chat auswählen</label>
                <div className="mt-1 space-y-1.5">
                  {chats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => setSelectedChat(String(chat.id))}
                      className={cn(
                        "w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors",
                        selectedChat === String(chat.id)
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-500"
                          : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600",
                      )}
                    >
                      <span className="font-medium">{chat.title}</span>
                      <span className="ml-2 text-xs text-slate-400">{chat.type} · {chat.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Chat-ID manuell eingeben</label>
                <input
                  type="text"
                  value={selectedChat}
                  onChange={(e) => setSelectedChat(e.target.value)}
                  placeholder="-1001234567890"
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Sende eine Nachricht in den Chat und klicke dann &quot;Aktualisieren&quot;, oder gib die Chat-ID manuell ein.
                </p>
                <Button size="sm" variant="outline" className="mt-2" onClick={handleValidate} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Aktualisieren
                </Button>
              </div>
            )}

            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Tagesbericht</label>
                <button
                  onClick={() => setDailyReport(!dailyReport)}
                  className={cn(
                    "relative h-6 w-11 rounded-full transition-colors",
                    dailyReport ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700",
                  )}
                >
                  <span className={cn(
                    "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                    dailyReport && "translate-x-5",
                  )} />
                </button>
              </div>
              {dailyReport && (
                <div>
                  <label className="text-xs text-slate-500">Uhrzeit (Berlin)</label>
                  <select
                    value={reportTime}
                    onChange={(e) => setReportTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t} Uhr</option>)}
                  </select>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={!selectedChat || loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Speichern
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setStep("idle"); setError(""); }}>Abbrechen</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
