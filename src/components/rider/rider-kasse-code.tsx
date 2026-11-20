"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Shown {
  code: string;
  svg: string;
  expiresAt: number;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Profil › „Abo fehlt?“: QR-Code, mit dem die Kasse ein Abo mit dieser App
 * verknüpft (lib/rider-kasse-link). Der Code gilt 15 Minuten und kommt erst
 * auf Knopfdruck vom Server, nie aus dem Zwischenspeicher.
 */
export function RiderKasseCode({ token }: { token: string }) {
  const router = useRouter();
  const [shown, setShown] = useState<Shown | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shown) return;
    const wait = shown.expiresAt - Date.now();
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, wait));
    return () => window.clearTimeout(timer);
  }, [shown]);

  async function show() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rider/${encodeURIComponent(token)}/kasse-code`, { method: "POST", cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { code?: string; svg?: string; expiresAt?: string; error?: string };
      if (!res.ok || !json.code || !json.svg || !json.expiresAt) {
        setError(typeof json.error === "string" ? json.error : "Der Code ließ sich nicht laden. Bitte versuch es noch einmal.");
        return;
      }
      setExpired(false);
      setShown({ code: json.code, svg: json.svg, expiresAt: new Date(json.expiresAt).getTime() });
    } catch {
      setError("Keine Verbindung. Bitte versuch es noch einmal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <b>Abo fehlt?</b>
      <span className="rd-muted">
        Steht ein Abo nicht in deiner App, etwa weil es unter einer anderen E-Mail-Adresse läuft, oder fährt dein Kind
        mit einem Abo? Zeig an der Kasse diesen Code, dann verknüpfen wir das Abo mit deiner App.
      </span>
      {shown && !expired ? (
        <div className="rd-center" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="rd-qr" role="img" aria-label="QR-Code für die Kasse" dangerouslySetInnerHTML={{ __html: shown.svg }} />
          <div className="rd-kasse-code">{shown.code}</div>
          <span className="rd-muted">Gilt bis {clock(shown.expiresAt)} Uhr. Hat die Kasse verknüpft, tipp auf Fertig, dann erscheint das Abo.</span>
          <button
            type="button"
            className="rd-btn rd-btn-wide rd-btn-ghost"
            onClick={() => {
              setShown(null);
              // Holt die Seite frisch vom Server (nicht aus dem Zwischenspeicher).
              router.refresh();
            }}
          >
            <span>Fertig</span>
          </button>
        </div>
      ) : (
        <>
          {shown && expired && <span className="rd-muted">Der Code ist abgelaufen.</span>}
          <button type="button" className="rd-btn rd-btn-wide" disabled={busy} onClick={show}>
            <span>{shown ? "Neuen Code zeigen" : "Code für die Kasse zeigen"}</span>
          </button>
        </>
      )}
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
    </div>
  );
}
