"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/**
 * Zustand des Installationshinweises ohne eigene Darstellung. Liegt in einer
 * eigenen Datei ohne UI-Bausteine, damit die Kunden-App (rider-install-hint)
 * nur den Hook lädt und nicht Button, Card und Icons der Verwaltung.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "emp-install-dismissed-at";
const DISMISS_MS = 14 * 24 * 60 * 60_000;

function detect(dismissKey: string) {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  let dismissed = false;
  try {
    dismissed = Date.now() - Number(localStorage.getItem(dismissKey) || 0) < DISMISS_MS;
  } catch {
    /* Speicher gesperrt (Privatmodus) – Hinweis einfach zeigen */
  }
  return { standalone, ios, safari, dismissed };
}

const subscribeNoop = () => () => {};

/**
 * Zustand des Installationshinweises, auch für eigene Darstellungen (Kunden-App):
 * Plattform, ob schon installiert, ob Chrome einen echten Installieren-Dialog
 * anbietet, und Wegklicken für 14 Tage unter `dismissKey`.
 */
export function useInstallState(dismissKey: string = DISMISS_KEY) {
  const isClient = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const info = useMemo(() => (isClient ? detect(dismissKey) : null), [isClient, dismissKey]);
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
      localStorage.setItem(dismissKey, String(Date.now()));
    } catch {
      /* ignore */
    }
    setHidden(true);
  }, [dismissKey]);

  const standalone = !!info && (info.standalone || installed);
  /** Banner zeigen: nicht installiert, nicht weggeklickt, und es gibt einen Weg (iOS-Anleitung oder Chrome-Dialog). */
  const showBanner = !!info && !standalone && !hidden && !info.dismissed && (info.ios || canPrompt);
  return { info, canPrompt, install, dismiss, standalone, showBanner };
}
