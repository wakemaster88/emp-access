"use client";

import { useCallback, useEffect, useState } from "react";

function keyBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "checking" | "hidden" | "needs-install" | "unsupported" | "off" | "on";

/** Benachrichtigungen auf diesem Gerät ein- und ausschalten. */
export function RiderPush({ token }: { token: string }) {
  const [state, setState] = useState<State>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/rider/${encodeURIComponent(token)}/push`;

  const refresh = useCallback(async () => {
    // iPhone und iPad können Push nur als App auf dem Home-Bildschirm.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    try {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let endpoint: string | null = null;
      if (supported && !(ios && !standalone)) {
        const registration = await navigator.serviceWorker.ready;
        endpoint = (await registration.pushManager.getSubscription())?.endpoint ?? null;
      }
      const res = await fetch(endpoint ? `${url}?endpoint=${encodeURIComponent(endpoint)}` : url);
      const json = (await res.json().catch(() => ({}))) as { configured?: boolean; publicKey?: string | null; subscribed?: boolean };
      // Nicht eingerichtet: die Karte gar nicht erst zeigen.
      if (!res.ok || !json.configured || !json.publicKey) return setState("hidden");
      if (ios && !standalone) return setState("needs-install");
      if (!supported) return setState("unsupported");
      setPublicKey(json.publicKey);
      setState(json.subscribed && Notification.permission === "granted" ? "on" : "off");
    } catch {
      setState("hidden");
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Zustand kommt vom Browser und vom Server
    void refresh();
  }, [refresh]);

  async function enable() {
    if (!publicKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setError("Benachrichtigungen sind für diese Seite gesperrt. Erlaube sie in den Einstellungen deines Browsers.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey) as BufferSource,
        }));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof json.error === "string" ? json.error : "Einschalten fehlgeschlagen.");
        return;
      }
      setState("on");
    } catch {
      setError("Einschalten fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      // Nur beim Server abmelden: das Abo des Browsers kann auch zum Dashboard gehören.
      if (sub) {
        const res = await fetch(url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (!res.ok) throw new Error();
      }
      setState("off");
    } catch {
      setError("Ausschalten fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking" || state === "hidden") return null;

  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <div className="rd-between">
        <b>Benachrichtigungen</b>
        {(state === "on" || state === "off") && (
          <span className={`rd-pill ${state === "on" ? "rd-pill-open" : "rd-pill-off"}`}>{state === "on" ? "an" : "aus"}</span>
        )}
      </div>
      {state === "needs-install" && (
        <span className="rd-muted">
          Auf iPhone und iPad nur in der App: in Safari Teilen, dann „Zum Home-Bildschirm“.
        </span>
      )}
      {state === "unsupported" && <span className="rd-muted">Dieser Browser kann keine Benachrichtigungen.</span>}
      {(state === "on" || state === "off") && (
        <>
          <span className="rd-muted">Wir melden uns auf diesem Gerät nur, wenn ein neuer Gutschein auf dich wartet.</span>
          <button type="button" className={`rd-btn rd-btn-wide ${state === "on" ? "rd-btn-ghost" : ""}`} disabled={busy} onClick={state === "on" ? disable : enable}>
            <span>{state === "on" ? "Ausschalten" : "Einschalten"}</span>
          </button>
        </>
      )}
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
    </div>
  );
}
