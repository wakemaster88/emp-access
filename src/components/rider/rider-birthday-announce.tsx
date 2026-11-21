"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Geburtstags-Durchsage am Lift: Hinweis auf der Geburtstagskarte mit
 * Schalter, damit die Person sie für sich abschalten kann (Datenschutz).
 */
export function RiderBirthdayAnnounce({ token, on }: { token: string; on: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/rider/${encodeURIComponent(token)}/birthday`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announce: !value }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Hat nicht geklappt.");
        return;
      }
      setValue(!value);
      router.refresh();
    } catch {
      setError("Keine Verbindung.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rd-between" style={{ gap: 12, marginTop: 6 }}>
      <span className="rd-muted" style={{ fontSize: 13 }}>
        {value
          ? "Beim ersten Scan am Lift gratulieren wir dir per Durchsage."
          : "Keine Durchsage am Lift."}
        {error && <><br /><span role="alert">{error}</span></>}
      </span>
      <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" onClick={toggle} disabled={busy} aria-pressed={!value}>
        <span>{value ? "Lieber nicht" : "Doch gern"}</span>
      </button>
    </div>
  );
}
