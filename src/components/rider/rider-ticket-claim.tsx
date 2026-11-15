"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

const VIEWPORT_ID = "rd-ticket-scanner";

/**
 * Tagesticket anmelden: QR-Code mit der Kamera scannen oder den Code tippen.
 * Neue Gäste landen danach beim Einrichten, angemeldete sammeln im selben Profil weiter.
 */
export function RiderTicketClaim({ label = "Ticket anmelden" }: { label?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const scanner = useRef<Html5Qrcode | null>(null);

  async function stop() {
    const s = scanner.current;
    scanner.current = null;
    setScanning(false);
    if (!s) return;
    try {
      await s.stop();
      s.clear();
    } catch {
      // Kamera war schon aus.
    }
  }

  useEffect(() => () => void stop(), []);

  async function claim(value: string) {
    const clean = value.trim();
    if (busy || clean.length < 3) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rider/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clean }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && typeof json.url === "string") {
        window.location.assign(json.url);
        return;
      }
      setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt.");
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    }
    setBusy(false);
  }

  async function scan() {
    setError("");
    setScanning(true);
    try {
      const mod = await import("html5-qrcode");
      const s = new mod.Html5Qrcode(VIEWPORT_ID);
      scanner.current = s;
      await s.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: (w: number, h: number) => { const size = Math.floor(Math.min(w, h) * 0.7); return { width: size, height: size }; } },
        (text) => {
          void stop();
          setCode(text);
          void claim(text);
        },
        () => {},
      );
    } catch {
      await stop();
      setError("Die Kamera lässt sich nicht öffnen. Tippe den Code vom Ticket ein.");
    }
  }

  return (
    <form className="rd-card" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void claim(code); }}>
      <div id={VIEWPORT_ID} style={{ display: scanning ? "block" : "none", width: "100%", borderRadius: 6, overflow: "hidden" }} />
      <button type="button" className="rd-btn rd-btn-wide" disabled={busy} onClick={scanning ? stop : scan}>
        <span>{scanning ? "Kamera schließen" : "Ticket scannen"}</span>
      </button>
      <div className="rd-field">
        <label htmlFor="rd-ticket-code">Oder Code vom Ticket</label>
        <input id="rd-ticket-code" className="rd-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" minLength={3} />
      </div>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="submit" className="rd-btn rd-btn-ghost rd-btn-wide" disabled={busy || code.trim().length < 3}>
        <span>{busy ? "Einen Moment …" : label}</span>
      </button>
    </form>
  );
}
