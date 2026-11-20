"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";

export interface RiderChoice {
  id: number;
  name: string;
  /** ISO-Datum (YYYY-MM-DD) oder null. */
  birthDate: string | null;
  /** Laufende Abos der Person, z. B. „Ride Abo“. */
  abos: string[];
}

export function fmtDay(iso: string | null, empty = "offen"): string {
  if (!iso) return empty;
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin",
  });
}

export function ageFrom(iso: string | null): number | null {
  if (!iso) return null;
  const b = new Date(iso);
  const now = new Date();
  let a = now.getFullYear() - b.getUTCFullYear();
  const m = now.getMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getUTCDate())) a--;
  return a;
}

/**
 * Wer fährt mit diesem Abo? Eine Person des Kontos oder eine neue mit Name
 * und Geburtsdatum (`PUT /api/tickets/[id]/rider`). Gleiche Daten wie eine
 * vorhandene Person ordnen dieser zu.
 */
export function RiderForm({
  ticketId,
  persons,
  current = null,
  initialLastName = "",
  cancelLabel = "Abbrechen",
  onDone,
  onCancel,
}: {
  ticketId: number;
  persons: RiderChoice[];
  /** Person, die jetzt damit fährt (vorausgewählt). */
  current?: number | null;
  initialLastName?: string | null;
  cancelLabel?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState(current != null ? `p${current}` : "new");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState(initialLastName ?? "");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = choice !== "new" ? persons.find((p) => `p${p.id}` === choice) : null;
  const unchanged = current != null && choice === `p${current}`;
  const canSave = !unchanged && (choice !== "new" || !!(firstName.trim() || lastName.trim()));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !canSave) return;
    const body = choice === "new"
      ? { firstName, lastName, birthDate: birthDate || null }
      : { personId: Number(choice.slice(1)) };
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/rider`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={save}>
      {persons.length > 0 && (
        <div className="space-y-1.5">
          <Label>Wer fährt?</Label>
          <Segmented
            aria-label="Wer fährt?"
            value={choice}
            onValueChange={setChoice}
            options={[
              ...persons.map((p) => ({ value: `p${p.id}`, label: p.name })),
              { value: "new", label: "Neue Person" },
            ]}
          />
          {chosen && (
            <p className="text-xs text-muted-foreground">
              {chosen.birthDate ? `Geboren ${fmtDay(chosen.birthDate, "")}` : "Ohne Geburtsdatum"}
              {chosen.abos.length > 0 ? ` · fährt mit ${chosen.abos.join(", ")}` : ""}
            </p>
          )}
        </div>
      )}
      {choice === "new" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="rider-first">Vorname</Label>
              <Input
                id="rider-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="off"
                maxLength={80}
                className="max-sm:h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rider-last">Nachname</Label>
              <Input
                id="rider-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="off"
                maxLength={80}
                className="max-sm:h-11"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rider-birth">Geburtsdatum</Label>
            <Input
              id="rider-birth"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="max-sm:h-11"
            />
          </div>
        </>
      )}
      {error && <Notice tone="danger" compact title={error} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={busy} className="max-sm:h-11" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={busy || !canSave} className="max-sm:h-11">
          {busy ? <Loader2 className="animate-spin" /> : "Speichern"}
        </Button>
      </div>
    </form>
  );
}
