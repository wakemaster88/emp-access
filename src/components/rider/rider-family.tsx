"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearRiderLocalData } from "@/lib/rider-local";

export interface FamilyMemberItem {
  profileId: number;
  token: string;
  name: string;
  adult: boolean;
  hasLogin: boolean;
}

interface Props {
  /** Link der angemeldeten Person. */
  token: string;
  selfId: number;
  /** Mitglieder der Familie; leer, solange es keine gibt. */
  members: FamilyMemberItem[];
  /** Die angemeldete Person gehört als Kind zu einer Familie. */
  childOfFamily: boolean;
}

type Msg = { ok: boolean; text: string } | null;

/** Familie im eigenen Profil: Mitglieder, Kind hinzufügen, Partner einladen, verlassen. */
export function RiderFamily({ token, selfId, members, childOfFamily }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [invite, setInvite] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<number | "leave" | null>(null);
  const url = `/api/rider/${encodeURIComponent(token)}/family`;
  const others = members.filter((m) => m.profileId !== selfId);

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      setBusy(false);
      if (res.ok) return json;
      setMsg({ ok: false, text: typeof json.error === "string" ? json.error : "Das hat nicht geklappt." });
    } catch {
      setBusy(false);
      setMsg({ ok: false, text: "Keine Verbindung." });
    }
    return null;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (await call({ action: "add", code, birthDate })) {
      setAdding(false);
      setCode("");
      setBirthDate("");
      setMsg({ ok: true, text: "Hinzugefügt. Oben wechselst du zwischen den Mitgliedern." });
      router.refresh();
    }
  }

  async function makeInvite() {
    const json = await call({ action: "invite" });
    if (json && typeof json.path === "string") {
      setInvite(`${window.location.origin}${json.path}`);
      setCopied(false);
      router.refresh();
    }
  }

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Einladung in unsere Familie", url: invite });
        return;
      } catch {
        // abgebrochen: dann eben kopieren
      }
    }
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch {
      setMsg({ ok: false, text: "Kopieren geht hier nicht. Markiere den Link und kopiere ihn von Hand." });
    }
  }

  async function remove(memberId: number) {
    if (await call({ action: "remove", memberId })) {
      setConfirm(null);
      router.refresh();
    }
  }

  async function leave() {
    if (await call({ action: "leave" })) {
      setConfirm(null);
      setInvite("");
      router.refresh();
    }
  }

  if (childOfFamily) {
    return (
      <div className="rd-card" style={{ gap: 10 }}>
        <b>Familie</b>
        <span className="rd-muted">
          Du gehörst zu einer Familie. Die Erwachsenen der Familie sehen dein Abo, deine Statistik und deine Gutscheine.
        </span>
        {msg && <div className={`rd-msg ${msg.ok ? "rd-msg-ok" : "rd-msg-err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
        {confirm === "leave" ? (
          <div className="rd-row">
            <button type="button" className="rd-btn rd-btn-danger rd-grow" onClick={leave} disabled={busy}><span>Wirklich verlassen</span></button>
            <button type="button" className="rd-btn rd-btn-ghost rd-grow" onClick={() => setConfirm(null)} disabled={busy}><span>Abbrechen</span></button>
          </div>
        ) : (
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={() => setConfirm("leave")}><span>Familie verlassen</span></button>
        )}
      </div>
    );
  }

  return (
    <div className="rd-card" style={{ gap: 12 }}>
      <b>Familie</b>
      {others.length === 0 ? (
        <span className="rd-muted">
          Verwalte die Abos deiner Familie in einer App. Kinder brauchen keinen eigenen Zugang, dein Partner behält seinen eigenen.
        </span>
      ) : (
        <ul className="rd-family-list">
          {others.map((m) => (
            <li key={m.profileId}>
              <span className="rd-grow">
                <b>{m.name}</b>
                <br />
                <span className="rd-muted">
                  {m.adult ? "Partner, eigener Zugang" : m.hasLogin ? "Kind, mit eigenem Zugang" : "Kind, ohne eigenen Zugang"}
                </span>
              </span>
              {!m.adult &&
                (confirm === m.profileId ? (
                  <>
                    <button type="button" className="rd-btn rd-btn-danger rd-btn-sm" onClick={() => remove(m.profileId)} disabled={busy}><span>Ja</span></button>
                    <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setConfirm(null)} disabled={busy}><span>Nein</span></button>
                  </>
                ) : (
                  <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setConfirm(m.profileId)} aria-label={`${m.name} aus der Familie entfernen`}>
                    <span>Entfernen</span>
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}

      {msg && <div className={`rd-msg ${msg.ok ? "rd-msg-ok" : "rd-msg-err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}

      {adding ? (
        <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="rd-field">
            <label htmlFor="rd-fam-code">Kartennummer des Kindes</label>
            <input id="rd-fam-code" className="rd-input" value={code} onChange={(e) => setCode(e.target.value)} required minLength={3} maxLength={100} autoComplete="off" autoCapitalize="characters" />
            <span className="rd-muted">Steht auf der Abo-Karte.</span>
          </div>
          <div className="rd-field">
            <label htmlFor="rd-fam-birth">Geburtsdatum des Kindes</label>
            <input id="rd-fam-birth" className="rd-input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
          </div>
          <div className="rd-row">
            <button type="submit" className="rd-btn rd-grow" disabled={busy}><span>{busy ? "Einen Moment …" : "Hinzufügen"}</span></button>
            <button type="button" className="rd-btn rd-btn-ghost rd-grow" onClick={() => setAdding(false)} disabled={busy}><span>Abbrechen</span></button>
          </div>
        </form>
      ) : (
        <button type="button" className="rd-btn rd-btn-wide" onClick={() => { setAdding(true); setMsg(null); }}><span>Kind hinzufügen</span></button>
      )}

      {invite ? (
        <div className="rd-field">
          <label htmlFor="rd-fam-invite">Einladung für deinen Partner</label>
          <input id="rd-fam-invite" className="rd-input" readOnly value={invite} onFocus={(e) => e.currentTarget.select()} />
          <span className="rd-muted">Gilt 7 Tage. Dein Partner öffnet den Link, meldet sich mit seinem eigenen Zugang an und tritt bei.</span>
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={share}><span>{copied ? "Kopiert" : "Link teilen"}</span></button>
        </div>
      ) : (
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={makeInvite} disabled={busy}><span>Partner einladen</span></button>
      )}

      {members.length > 0 &&
        (confirm === "leave" ? (
          <div className="rd-row">
            <button type="button" className="rd-btn rd-btn-danger rd-grow" onClick={leave} disabled={busy}><span>Wirklich verlassen</span></button>
            <button type="button" className="rd-btn rd-btn-ghost rd-grow" onClick={() => setConfirm(null)} disabled={busy}><span>Abbrechen</span></button>
          </div>
        ) : (
          <button type="button" className="rd-btn rd-btn-danger rd-btn-wide" onClick={() => setConfirm("leave")}><span>Familie verlassen</span></button>
        ))}
    </div>
  );
}

/** Auf der Seite hinter dem Einladungslink: der Familie beitreten. */
export function RiderFamilyJoin({ inviteKey }: { inviteKey: string }) {
  return <FamilyAction url="/api/rider/family/join" body={{ key: inviteKey }} label="Familie beitreten" />;
}

/** Beim Einrichten: dieses Abo als Kind in die eigene Familie holen, statt einen Zugang anzulegen. */
export function RiderFamilyClaim({ token }: { token: string }) {
  return (
    <FamilyAction
      url={`/api/rider/${encodeURIComponent(token)}/family/claim`}
      body={{}}
      label="Zu meiner Familie hinzufügen"
      fallback={`/app/${encodeURIComponent(token)}`}
    />
  );
}

function FamilyAction({ url, body, label, fallback }: { url: string; body: Record<string, unknown>; label: string; fallback?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok) {
        // Familie hat sich geändert: lokal gespeicherte Seiten der Mitglieder verwerfen.
        await clearRiderLocalData();
        window.location.assign(typeof json.url === "string" ? json.url : fallback ?? "/app");
        return;
      }
      setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt.");
    } catch {
      setError("Keine Verbindung.");
    }
    setBusy(false);
  }

  return (
    <>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="button" className="rd-btn rd-btn-wide" onClick={run} disabled={busy}><span>{busy ? "Einen Moment …" : label}</span></button>
    </>
  );
}
