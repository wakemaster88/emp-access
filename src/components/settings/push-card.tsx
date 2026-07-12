"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bell, BellOff, Send, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

type Support = "checking" | "supported" | "unsupported" | "not-configured";

export function PushCard() {
  const [support, setSupport] = useState<Support>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [deviceCount, setDeviceCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupport("unsupported");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      const params = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";
      const res = await fetch(`/api/push${params}`);
      const json = await res.json();
      if (!json.configured) {
        setSupport("not-configured");
        return;
      }
      setPublicKey(json.publicKey);
      setSubscribed(!!sub && json.subscribed);
      setDeviceCount(json.deviceCount ?? 0);
      setSupport("supported");
    } catch {
      setSupport("unsupported");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubscribe = async () => {
    if (!publicKey) return;
    setLoading(true);
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Benachrichtigungen wurden im Browser nicht erlaubt.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Speichern fehlgeschlagen");
        return;
      }
      await refresh();
    } catch {
      setError("Abonnieren fehlgeschlagen. Auf iPhone/iPad muss die App zuerst zum Home-Bildschirm hinzugefügt werden.");
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setLoading(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      await refresh();
    } catch {
      setError("Abmelden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const json = await res.json();
      setTestResult(res.ok && json.sent > 0 ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardContent className="pt-5 space-y-3">
        {support === "checking" && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Prüfe Browser-Unterstützung …
          </div>
        )}

        {support === "unsupported" && (
          <p className="text-sm text-slate-500">
            Dieser Browser unterstützt keine Push-Benachrichtigungen. Auf iPhone/iPad:
            Seite über Safari zum Home-Bildschirm hinzufügen und die App von dort öffnen.
          </p>
        )}

        {support === "not-configured" && (
          <p className="text-sm text-slate-500">
            Web-Push ist auf dem Server nicht konfiguriert. Es fehlen die Env-Variablen{" "}
            <code className="text-xs font-mono">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> und{" "}
            <code className="text-xs font-mono">VAPID_PRIVATE_KEY</code>{" "}
            (erzeugen mit <code className="text-xs font-mono">npx web-push generate-vapid-keys</code>).
          </p>
        )}

        {support === "supported" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Dieses Gerät</span>
              {subscribed ? (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">Aktiv</Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">Nicht aktiviert</Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Registrierte Geräte (Account)</span>
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{deviceCount}</span>
            </div>
            <p className="text-xs text-slate-400">
              Du erhältst eine Push-Benachrichtigung, sobald ein Gerät offline geht
              und wenn es wieder online ist. Geprüft wird alle 5 Minuten. Welche
              Geräte überwacht werden, stellst du pro Gerät unter „Bearbeiten“ →
              „Offline-Benachrichtigung“ ein (Standard: aus).
            </p>

            <div className="flex gap-2 pt-1">
              {subscribed ? (
                <>
                  <Button variant="outline" size="sm" onClick={handleTest} disabled={loading} className="flex-1">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                    Test senden
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleUnsubscribe} disabled={loading} className="text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300">
                    <BellOff className="h-4 w-4 mr-1.5" />
                    Deaktivieren
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={handleSubscribe} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Bell className="h-4 w-4 mr-1.5" />}
                  Auf diesem Gerät aktivieren
                </Button>
              )}
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}
            {testResult && (
              <div className={cn(
                "flex items-center gap-2 p-2.5 rounded-lg text-xs font-medium",
                testResult === "ok"
                  ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400"
                  : "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400",
              )}>
                {testResult === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {testResult === "ok" ? "Testbenachrichtigung gesendet!" : "Senden fehlgeschlagen"}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
