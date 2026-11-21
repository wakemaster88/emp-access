"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Pencil } from "lucide-react";

interface Props {
  token: string;
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD` oder null. */
  birthDate: string | null;
  photo: string | null;
  /** Zweite Zeile unter dem Namen (Spitzname, Adresse). */
  subtitle: string | null;
  /** Darf ändern: selbst oder Eltern für ihr Kind. Partner sehen nur. */
  editable: boolean;
  /** Eltern bearbeiten die Daten ihres Kindes. */
  managed?: boolean;
}

type Msg = { ok: boolean; text: string } | null;

/** Kantenlänge des gespeicherten Profilbilds. */
const PHOTO_PX = 320;

function initialsOf(first: string, last: string): string {
  return ((first.trim().charAt(0) ?? "") + (last.trim().charAt(0) ?? "")).toUpperCase() || "?";
}

function fmtBirth(ymd: string | null): string {
  if (!ymd) return "nicht eingetragen";
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

/** Bild mittig quadratisch zuschneiden und als JPEG verkleinern. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Bild"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("Bild");
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_PX;
    canvas.height = PHOTO_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Bild");
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Kopf des Profils: Bild, Name und die persönlichen Daten zum Bearbeiten. */
export function RiderPerson({ token, firstName, lastName, birthDate, photo, subtitle, editable, managed = false }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState({ firstName, lastName, birthDate, photo });
  const [form, setForm] = useState({ firstName, lastName, birthDate: birthDate ?? "" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const url = `/api/rider/${encodeURIComponent(token)}/person`;
  const name = `${data.firstName} ${data.lastName}`.trim();
  const today = new Date().toISOString().slice(0, 10);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { error?: unknown };
      setBusy(false);
      if (res.ok) return true;
      setMsg({ ok: false, text: typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen." });
    } catch {
      setBusy(false);
      setMsg({ ok: false, text: "Keine Verbindung." });
    }
    return false;
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let small: string;
    try {
      small = await shrink(file);
    } catch {
      setMsg({ ok: false, text: "Das Bild lässt sich nicht öffnen. Bitte ein anderes wählen." });
      return;
    }
    setChecking(true);
    const saved = await send({ photo: small });
    setChecking(false);
    if (saved) {
      setData((d) => ({ ...d, photo: small }));
      setMsg({ ok: true, text: "Profilbild gespeichert." });
      router.refresh();
    }
  }

  async function removePhoto() {
    if (await send({ photo: null })) {
      setData((d) => ({ ...d, photo: null }));
      setMsg({ ok: true, text: "Profilbild entfernt." });
      router.refresh();
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body = { firstName: form.firstName, lastName: form.lastName, birthDate: form.birthDate || null };
    if (await send(body)) {
      setData((d) => ({ ...d, firstName: form.firstName.trim().replace(/\s+/g, " "), lastName: form.lastName.trim().replace(/\s+/g, " "), birthDate: form.birthDate || null }));
      setEditing(false);
      setMsg({ ok: true, text: "Gespeichert." });
      router.refresh();
    }
  }

  function startEdit() {
    setForm({ firstName: data.firstName, lastName: data.lastName, birthDate: data.birthDate ?? "" });
    setMsg(null);
    setEditing(true);
  }

  const avatar = data.photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- Data-URL aus der eigenen Datenbank
    <img src={data.photo} alt="" />
  ) : (
    <span aria-hidden>{initialsOf(data.firstName, data.lastName)}</span>
  );

  return (
    <section className="rd-me" aria-label="Persönliche Daten">
      <div className="rd-me-head">
        {editable ? (
          <button type="button" className="rd-avatar" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={data.photo ? "Profilbild ändern" : "Profilbild wählen"}>
            {avatar}
            <i className="rd-avatar-cam" aria-hidden><Camera size={14} strokeWidth={2.4} /></i>
          </button>
        ) : (
          <div className="rd-avatar">{avatar}</div>
        )}
        <div className="rd-grow">
          <h1 className="rd-display rd-me-name">{name || "Profil"}</h1>
          {subtitle && <div className="rd-muted rd-me-sub">{subtitle}</div>}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={pickPhoto} />
      </div>

      {editing ? (
        <form className="rd-card" onSubmit={save} style={{ gap: 12 }}>
          <b>{managed ? "Daten deines Kindes" : "Persönliche Daten"}</b>
          <div className="rd-field">
            <label htmlFor="rd-first">Vorname</label>
            <input id="rd-first" className="rd-input" required maxLength={60} autoComplete={managed ? "off" : "given-name"} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
          </div>
          <div className="rd-field">
            <label htmlFor="rd-last">Nachname</label>
            <input id="rd-last" className="rd-input" required maxLength={60} autoComplete={managed ? "off" : "family-name"} value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
          </div>
          <div className="rd-field">
            <label htmlFor="rd-birth">Geburtsdatum</label>
            <input id="rd-birth" className="rd-input" type="date" min="1900-01-01" max={today} autoComplete={managed ? "off" : "bday"} value={form.birthDate} onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))} />
          </div>
          <span className="rd-muted">{managed ? "So steht dein Kind an der Kasse und auf seinen Abos." : "So stehst du an der Kasse und auf deinen Abos."} Für andere bleibt nur der Spitzname sichtbar.</span>
          {msg && <div className={`rd-msg ${msg.ok ? "rd-msg-ok" : "rd-msg-err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
          <div className="rd-row">
            <button type="submit" className="rd-btn rd-grow" disabled={busy || !form.firstName.trim() || !form.lastName.trim()}><span>Speichern</span></button>
            <button type="button" className="rd-btn rd-btn-ghost rd-grow" disabled={busy} onClick={() => { setEditing(false); setMsg(null); }}><span>Abbrechen</span></button>
          </div>
        </form>
      ) : (
        <div className="rd-card rd-list rd-kv">
          <div><span className="rd-dim">Vorname</span><b>{data.firstName || "–"}</b></div>
          <div><span className="rd-dim">Nachname</span><b>{data.lastName || "–"}</b></div>
          <div><span className="rd-dim">Geburtsdatum</span><b>{fmtBirth(data.birthDate)}</b></div>
          {editable && (
            <div className="rd-kv-actions">
              <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm rd-grow" onClick={startEdit} disabled={busy}>
                <span><Pencil size={14} strokeWidth={2.4} aria-hidden /> Daten ändern</span>
              </button>
              {data.photo && (
                <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm rd-grow" onClick={removePhoto} disabled={busy}>
                  <span>Bild entfernen</span>
                </button>
              )}
            </div>
          )}
          {checking && <div className="rd-msg rd-msg-ok" role="status">Bild wird geprüft …</div>}
          {msg && <div className={`rd-msg ${msg.ok ? "rd-msg-ok" : "rd-msg-err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
        </div>
      )}
    </section>
  );
}
