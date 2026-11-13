"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BUILD_ID, isKioskPath, isNewerBuild } from "@/lib/app-version";

/** Wie oft im Vordergrund nach einer neuen Version gefragt wird. */
const CHECK_EVERY_MS = 5 * 60_000;
/** „Später“ blendet den Hinweis so lange aus. */
const SNOOZE_MS = 30 * 60_000;
/** Kiosk lädt erst neu, wenn so lange niemand getippt hat. */
const KIOSK_IDLE_MS = 60_000;
/** Kam nach einem Neuladen trotzdem der alte Stand, so lange nicht erneut laden. */
const RELOAD_GUARD_MS = 10 * 60_000;
const RELOAD_KEY = "emp-update-reload";

async function servedBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: unknown };
    return typeof data.buildId === "string" ? data.buildId : null;
  } catch {
    return null;
  }
}

/** Wurde für diesen Stand schon neu geladen (und es kam trotzdem der alte)? */
function recentlyReloadedFor(target: string): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    if (!raw) return false;
    const { target: t, at } = JSON.parse(raw) as { target?: string; at?: number };
    return t === target && typeof at === "number" && Date.now() - at < RELOAD_GUARD_MS;
  } catch {
    return false;
  }
}

/** Liegt schon eine andere Ebene über der Seite? Dann wartet der Hinweis. */
function otherLayerOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
}

/**
 * Neuen Service Worker übernehmen und die Seite frisch laden. Seitenaufrufe
 * gehen im Service Worker immer ans Netz, das Neuladen holt also HTML und
 * Skripte der neuen Version – auch in der installierten PWA auf iOS, die
 * sonst beim Zurückholen aus dem Hintergrund den alten Stand weiterzeigt.
 */
async function applyUpdate(target: string | null) {
  try {
    if (target) sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ target, at: Date.now() }));
  } catch {
    // Privat-Modus: dann eben ohne Schleifenschutz.
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await Promise.race([reg.update(), new Promise((r) => setTimeout(r, 3_000))]);
      reg.waiting?.postMessage({ type: "SKIP_WAITING" });
    }
  } catch {
    // Ohne Service Worker reicht das Neuladen.
  }
  window.location.reload();
}

/**
 * Hinweis „Neue Version verfügbar“ nach einem Deployment.
 *
 * Vergleicht beim Zurückkehren in den Vordergrund, bei Fokus, nach dem
 * Wiederverbinden und alle 5 Minuten die eigene Build-ID mit `/api/version`.
 * Auf Seiten mit Person davor erscheint ein Dialog (Aktualisieren / Später),
 * aber nie über einer schon offenen Ebene. Kiosk-Seiten laden selbst neu,
 * sobald eine Minute lang niemand getippt hat.
 */
export function UpdatePrompt() {
  const [target, setTarget] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const snoozedUntil = useRef(0);
  const lastInput = useRef(0);

  const check = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const served = await servedBuildId();
    if (served && isNewerBuild(BUILD_ID, served)) setTarget(served);
  }, []);

  // Wann nachgefragt wird.
  useEffect(() => {
    lastInput.current = Date.now();
    const first = setTimeout(check, 10_000);
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);

    // Ein neuer Service Worker hat übernommen, obwohl schon einer lief: die
    // Seite stammt sicher aus dem alten Stand.
    const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;
    const hadController = !!sw?.controller;
    const onControllerChange = () => {
      if (hadController) void check();
    };
    sw?.addEventListener("controllerchange", onControllerChange);

    const onInput = () => {
      lastInput.current = Date.now();
    };
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("keydown", onInput);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      sw?.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
    };
  }, [check]);

  // Was passiert, sobald eine neue Version bereitsteht.
  useEffect(() => {
    if (!target) return;
    const kiosk = isKioskPath(window.location.pathname);
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (recentlyReloadedFor(target)) return;
      if (kiosk) {
        if (Date.now() - lastInput.current >= KIOSK_IDLE_MS) void applyUpdate(target);
        return;
      }
      if (Date.now() < snoozedUntil.current || otherLayerOpen()) return;
      setOpen(true);
    };
    tick();
    const timer = setInterval(tick, 5_000);
    return () => clearInterval(timer);
  }, [target]);

  if (!target) return null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) snoozedUntil.current = Date.now() + SNOOZE_MS;
        setOpen(next);
      }}
      title="Neue Version verfügbar"
      description="EMP Access wurde aktualisiert. Lade die App neu, um die neue Version zu nutzen. Nicht gespeicherte Eingaben auf dieser Seite gehen dabei verloren."
      confirmLabel="Jetzt aktualisieren"
      cancelLabel="Später"
      destructive={false}
      onConfirm={() => applyUpdate(target).then(() => new Promise<void>(() => {}))}
    />
  );
}
