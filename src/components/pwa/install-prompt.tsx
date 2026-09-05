"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Download, Share, SquarePlus, X, CheckCircle2, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Installationshinweis fuer die Web-App.
 *
 *  - Android/Chrome: `beforeinstallprompt` abfangen und einen echten
 *    "Installieren"-Knopf anbieten.
 *  - iPhone/iPad: Safari kennt keinen Prompt – die zwei Schritte
 *    "Teilen → Zum Home-Bildschirm" werden angezeigt. Erst als installierte
 *    App gibt es auf iOS Push-Nachrichten, Vollbild und Splash-Screen.
 *  - Bereits installiert (standalone): Banner verschwindet, die Karte zeigt
 *    den Haken.
 *
 * `banner` klebt unten (Safe-Area beachtet) und laesst sich 14 Tage lang
 * wegklicken; `card` passt auf die Einstellungsseite; `inline` ist nur der
 * Text, z. B. unter der Push-Karte.
 */
type Variant = "banner" | "card" | "inline";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "emp-install-dismissed-at";
const DISMISS_MS = 14 * 24 * 60 * 60_000;

function detect() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  let dismissed = false;
  try {
    dismissed = Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_MS;
  } catch {
    /* Speicher gesperrt (Privatmodus) – Hinweis einfach zeigen */
  }
  return { standalone, ios, safari, dismissed };
}

const subscribeNoop = () => () => {};

export function InstallPrompt({ variant = "card", appName = "EMP Access" }: { variant?: Variant; appName?: string }) {
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const info = useMemo(() => (isClient ? detect() : null), [isClient]);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const ev = promptRef.current;
    if (!ev) return;
    await ev.prompt();
    const choice = await ev.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    if (choice.outcome === "accepted") setInstalled(true);
    promptRef.current = null;
    setCanPrompt(false);
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setHidden(true);
  }, []);

  if (!info) return null;
  const isStandalone = info.standalone || installed;

  if (variant === "banner") {
    if (isStandalone || hidden || info.dismissed) return null;
    if (!info.ios && !canPrompt) return null;
    return (
      <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pointer-events-none">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-xl p-3.5 pointer-events-auto text-slate-900 dark:text-slate-100">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Smartphone className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold leading-tight">{appName} als App</p>
              {info.ios ? (
                <p className="mt-1 text-slate-600 dark:text-slate-300 leading-snug">
                  Unten <Share className="inline h-3.5 w-3.5 -mt-0.5" aria-label="Teilen" /> <span className="font-medium">Teilen</span> antippen,
                  dann <SquarePlus className="inline h-3.5 w-3.5 -mt-0.5" aria-label="Plus" /> <span className="font-medium">Zum Home-Bildschirm</span>.
                  {!info.safari && " Dafür die Seite in Safari öffnen."}
                </p>
              ) : (
                <p className="mt-1 text-slate-600 dark:text-slate-300 leading-snug">Startet im Vollbild und liegt als Symbol auf dem Startbildschirm.</p>
              )}
              {canPrompt && !info.ios && (
                <button
                  type="button"
                  onClick={install}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  <Download className="h-3.5 w-3.5" /> Installieren
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Hinweis ausblenden"
              className="h-8 w-8 shrink-0 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const body = isStandalone ? (
    <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4" /> Läuft als installierte App.
    </p>
  ) : info.ios ? (
    <div className="text-sm text-slate-600 dark:text-slate-300 space-y-1.5">
      <p>
        Auf iPhone und iPad: in Safari unten <Share className="inline h-4 w-4 -mt-0.5" aria-label="Teilen" />{" "}
        <span className="font-medium">Teilen</span> antippen, dann{" "}
        <SquarePlus className="inline h-4 w-4 -mt-0.5" aria-label="Plus" /> <span className="font-medium">Zum Home-Bildschirm</span> wählen.
      </p>
      <p className="text-xs text-slate-500">Erst als installierte App gibt es Push-Benachrichtigungen, Vollbild und ein Startbild.</p>
    </div>
  ) : canPrompt ? (
    <button
      type="button"
      onClick={install}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white"
    >
      <Download className="h-4 w-4" /> App installieren
    </button>
  ) : (
    <p className="text-sm text-slate-600 dark:text-slate-300">
      In Chrome oder Edge über das Menü <span className="font-medium">„App installieren“</span> wählen; auf Android erscheint der Hinweis automatisch.
    </p>
  );

  if (variant === "inline") return body;

  return (
    <div className={cn("rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2")}>
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-indigo-600" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{appName} auf dem Handy</h3>
      </div>
      {body}
    </div>
  );
}
