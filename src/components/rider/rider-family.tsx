"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearRiderLocalData } from "@/lib/rider-local";

export interface FamilyMemberItem {
  profileId: number;
  token: string;
  name: string;
  adult: boolean;
  hasLogin: boolean;
  /** Kundenkonto der Person; Personen aus dem eigenen Konto bleiben in der Familie. */
  customerId: number | null;
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

/** Familie im eigenen Profil: Mitglieder, per E-Mail einladen, Einladungslink teilen, verlassen. */
export function RiderFamily({ token, selfId, members, childOfFamily }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [who, setWho] = useState<"adult" | "child">("adult");
  const [invite, setInvite] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<number | "leave" | null>(null);
  const url = `/api/rider/${encodeURIComponent(token)}/family`;
  const others = members.filter((m) => m.profileId !== selfId);
  const ownKonto = members.find((m) => m.profileId === selfId)?.customerId ?? null;

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
    const address = email.trim();
    const json = await call({ action: who === "adult" ? "mail" : "link", email: address });
    if (!json) return;
    setAdding(false);
    setEmail("");
    setMsg({
      ok: true,
      text: who === "child"
        ? "Wenn zu der Adresse ein Abo gehört, ist dorthin jetzt ein Link unterwegs. Sobald er bestätigt ist, siehst du das Abo hier. Der Link gilt 7 Tage."
        : json.result === "member"
          ? `${address} gehört schon zu deiner Familie.`
          : `Die Einladung an ${address} ist unterwegs. Wer den Link öffnet, ist gleich in der App und in deiner Familie. Er gilt 7 Tage.`,
    });
    router.refresh();
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
          Verwalte die Abos deiner Familie in einer App. Lade Erwachsene per E-Mail ein, sie behalten ihren eigenen Zugang; Kinder brauchen keinen.
          Abos, die du mit deiner Adresse für andere buchst, kommen von selbst dazu.
        </span>
      ) : (
        <ul className="rd-family-list">
          {others.map((m) => (
            <li key={m.profileId}>
              <span className="rd-grow">
                <b>{m.name}</b>
                <br />
                <span className="rd-muted">
                  {m.adult
                    ? "Partner, eigener Zugang"
                    : ownKonto != null && m.customerId === ownKonto
                      ? "Aus deinem Kundenkonto, von dir verwaltet"
                      : m.hasLogin ? "Kind, mit eigenem Zugang" : "Kind, ohne eigenen Zugang"}
                </span>
              </span>
              {!m.adult && (ownKonto == null || m.customerId !== ownKonto) &&
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
            <label htmlFor="rd-fam-mail">E-Mail-Adresse</label>
            <input id="rd-fam-mail" className="rd-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={180} autoComplete="off" inputMode="email" />
          </div>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <legend style={{ marginBottom: 4 }}>Wen lädst du ein?</legend>
            <label className="rd-check">
              <span className="rd-grow"><b>Erwachsene Person</b><br /><span className="rd-muted">Partner oder andere Erwachsene, mit eigenem Zugang zur App</span></span>
              <input type="radio" name="rd-fam-who" checked={who === "adult"} onChange={() => setWho("adult")} />
            </label>
            <label className="rd-check">
              <span className="rd-grow"><b>Kind mit eigener Adresse</b><br /><span className="rd-muted">Das Abo ist mit dieser Adresse gebucht</span></span>
              <input type="radio" name="rd-fam-who" checked={who === "child"} onChange={() => setWho("child")} />
            </label>
          </fieldset>
          <span className="rd-muted">
            {who === "adult"
              ? "Wir schicken eine Einladung an die Adresse. Wer den Link öffnet, ist angemeldet und gleich in deiner Familie."
              : "Dorthin schicken wir einen Link; erst wenn er bestätigt ist, gehört das Abo zur Familie. Kinder ohne eigene Adresse verknüpft die Kasse: zeig dort den Code unter „Abo fehlt?“."}
          </span>
          <div className="rd-row">
            <button type="submit" className="rd-btn rd-grow" disabled={busy}><span>{busy ? "Einen Moment …" : who === "adult" ? "Einladung schicken" : "Link schicken"}</span></button>
            <button type="button" className="rd-btn rd-btn-ghost rd-grow" onClick={() => setAdding(false)} disabled={busy}><span>Abbrechen</span></button>
          </div>
        </form>
      ) : (
        <button type="button" className="rd-btn rd-btn-wide" onClick={() => { setAdding(true); setMsg(null); }}><span>Per E-Mail einladen</span></button>
      )}

      {invite ? (
        <div className="rd-field">
          <label htmlFor="rd-fam-invite">Einladungslink</label>
          <input id="rd-fam-invite" className="rd-input" readOnly value={invite} onFocus={(e) => e.currentTarget.select()} />
          <span className="rd-muted">Gilt 7 Tage. Wer den Link öffnet, meldet sich mit seinem eigenen Zugang an und tritt bei.</span>
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={share}><span>{copied ? "Kopiert" : "Link teilen"}</span></button>
        </div>
      ) : (
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={makeInvite} disabled={busy}><span>Stattdessen Link teilen</span></button>
      )}

      {/* Mit Personen aus dem eigenen Konto gibt es nichts zu verlassen: sie gehören dazu. */}
      {members.length > 0 && !others.some((m) => !m.adult && ownKonto != null && m.customerId === ownKonto) &&
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

export interface FamilyConfirmPerson {
  id: number;
  name: string;
  /** Gehört schon zur Familie. */
  joined: boolean;
}

/** Hinter dem Link aus der Mail: Personen wählen und in die Familie bestätigen. */
export function RiderFamilyConfirm({ confirmKey, persons, inviterName }: { confirmKey: string; persons: FamilyConfirmPerson[]; inviterName: string }) {
  const [chosen, setChosen] = useState<number[]>(persons.filter((p) => !p.joined).map((p) => p.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || chosen.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rider/family/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: confirmKey, personIds: chosen }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setDone(true);
      } else {
        setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt.");
      }
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <>
        <div className="rd-msg rd-msg-ok" role="status">Bestätigt. Das Abo gehört jetzt zur Familie von {inviterName}.</div>
        <Link href="/app" className="rd-btn rd-btn-ghost rd-btn-wide"><span>Zur App</span></Link>
      </>
    );
  }

  return (
    <form className="rd-card" style={{ gap: 10 }} onSubmit={submit}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <legend style={{ marginBottom: 4 }}>Wer gehört zur Familie?</legend>
        {persons.map((p) => (
          <label key={p.id} className="rd-check">
            <span className="rd-grow"><b>{p.name}</b>{p.joined && <><br /><span className="rd-muted">Schon in der Familie</span></>}</span>
            <input
              type="checkbox"
              checked={p.joined || chosen.includes(p.id)}
              disabled={p.joined}
              onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((id) => id !== p.id)))}
            />
          </label>
        ))}
      </fieldset>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="submit" className="rd-btn rd-btn-wide" disabled={busy || chosen.length === 0}>
        <span>{busy ? "Einen Moment …" : "Bestätigen"}</span>
      </button>
    </form>
  );
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
