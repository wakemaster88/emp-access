"use client";

import { useState } from "react";
import { Check, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { ToggleChip, ToggleChipGroup } from "@/components/ui/toggle-chip";
import {
  DEFAULT_HOLD_MINUTES,
  MAX_HOLD_MINUTES,
  MAX_VOTE_PLAYLISTS,
  VOTE_ACTIVE_HOURS,
  type VoteTally,
} from "@/lib/music-vote-rules";

type Option = { id: number; name: string };

export interface MusicVoteSettings {
  enabled: boolean;
  zoneIds: number[];
  playlistIds: number[];
  holdMinutes: number;
}

export interface MusicVoteStanding {
  tally: VoteTally[];
  voters: number;
  zones: { id: number; name: string; isPlaying: boolean; playing: string | null; holdUntil: string | null }[];
}

function toggle(list: number[], id: number, on: boolean): number[] {
  return on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id);
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

/**
 * Playlist-Abstimmung: aktive Fahrer wählen in der Kunden-App, die Mehrheit
 * läuft in den gewählten Zonen. Personal geht vor (Ruhezeit nach Start/Stopp
 * von Hand).
 */
export function MusicVoteCard({
  initial,
  zones,
  playlists,
  standing: initialStanding,
}: {
  initial: MusicVoteSettings;
  zones: Option[];
  playlists: Option[];
  standing: MusicVoteStanding | null;
}) {
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(initial);
  const [hold, setHold] = useState(String(initial.holdMinutes));
  const [standing, setStanding] = useState(initialStanding);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const holdNum = Number(hold);
  const holdValid = Number.isInteger(holdNum) && holdNum >= 0 && holdNum <= MAX_HOLD_MINUTES;
  const dirty =
    form.enabled !== saved.enabled ||
    form.zoneIds.join() !== saved.zoneIds.join() ||
    form.playlistIds.join() !== saved.playlistIds.join() ||
    holdNum !== saved.holdMinutes;
  const tooMany = form.playlistIds.length > MAX_VOTE_PLAYLISTS;
  const ready = !form.enabled || (form.zoneIds.length > 0 && form.playlistIds.length >= 2 && !tooMany);

  async function save() {
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const body = { ...form, holdMinutes: holdNum };
      const res = await fetch("/api/gamification/music-vote", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      const next = { ...body, zoneIds: json.zoneIds as number[], playlistIds: json.playlistIds as number[] };
      setSaved(next);
      setForm(next);
      setStanding(json.standing ?? null);
      setDone(true);
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  const total = standing?.tally.reduce((s, t) => s + t.votes, 0) ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
          Playlist-Abstimmung
        </CardTitle>
        <CardDescription>
          Wer in den letzten {VOTE_ACTIVE_HOURS} Stunden am Lift gestartet ist, wählt in der Kunden-App eine Playlist. Die
          mit den meisten Stimmen läuft. Die Abstimmung wechselt nur laufende Musik und startet nie selbst.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="vote-enabled">Fahrer stimmen ab</Label>
            <p className="text-xs text-muted-foreground">Aus: Die Karte verschwindet aus der App, es läuft, was eingestellt ist.</p>
          </div>
          <Switch
            id="vote-enabled"
            checked={form.enabled}
            disabled={busy}
            onCheckedChange={(v) => { setForm((f) => ({ ...f, enabled: v })); setDone(false); }}
          />
        </div>

        <div className="space-y-2">
          <p id="vote-zones" className="text-sm font-medium">Zonen</p>
          {zones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Audio-Zone angelegt.</p>
          ) : (
            <ToggleChipGroup aria-labelledby="vote-zones">
              {zones.map((z) => {
                const on = form.zoneIds.includes(z.id);
                return (
                  <ToggleChip
                    key={z.id}
                    pressed={on}
                    onPressedChange={(v) => { setForm((f) => ({ ...f, zoneIds: toggle(f.zoneIds, z.id, v) })); setDone(false); }}
                    className="max-w-full"
                  >
                    {on && <Check />}
                    <span className="truncate">{z.name}</span>
                  </ToggleChip>
                );
              })}
            </ToggleChipGroup>
          )}
        </div>

        <div className="space-y-2">
          <div className="space-y-0.5">
            <p id="vote-playlists" className="text-sm font-medium">Playlists zur Wahl</p>
            <p className="text-xs text-muted-foreground">
              2 bis {MAX_VOTE_PLAYLISTS}. In der App stehen sie in der Reihenfolge, in der du sie antippst. Bei Gleichstand
              bleibt die laufende.
            </p>
          </div>
          {playlists.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Playlist angelegt (Audio › Inhalte).</p>
          ) : (
            <ToggleChipGroup aria-labelledby="vote-playlists">
              {playlists.map((p) => {
                const pos = form.playlistIds.indexOf(p.id);
                const on = pos >= 0;
                return (
                  <ToggleChip
                    key={p.id}
                    pressed={on}
                    onPressedChange={(v) => { setForm((f) => ({ ...f, playlistIds: toggle(f.playlistIds, p.id, v) })); setDone(false); }}
                    className="max-w-full"
                  >
                    {on && <span className="tabular-nums font-semibold">{pos + 1}</span>}
                    <span className="truncate">{p.name}</span>
                  </ToggleChip>
                );
              })}
            </ToggleChipGroup>
          )}
        </div>

        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor="vote-hold">Ruhe nach Wahl des Teams (Minuten)</Label>
          <Input
            id="vote-hold"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_HOLD_MINUTES}
            value={hold}
            onChange={(e) => { setHold(e.target.value); setDone(false); }}
          />
          <p className="text-xs text-muted-foreground">
            Startet oder stoppt jemand die Musik von Hand, gilt das so lange. Vorgabe {DEFAULT_HOLD_MINUTES}, 0 heißt: Die
            Mehrheit gilt sofort wieder.
          </p>
        </div>

        {standing && saved.enabled && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Stand jetzt · {standing.voters === 1 ? "1 Stimme" : `${standing.voters} Stimmen`}
            </p>
            <ul className="space-y-1.5">
              {standing.tally.map((t) => (
                <li key={t.playlistId} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{t.name}</span>
                    <span className="tabular-nums text-muted-foreground">{t.votes}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-violet-500"
                      style={{ width: `${total > 0 ? Math.round((t.votes / total) * 100) : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {standing.zones.map((z) => (
              <p key={z.id} className="text-xs text-muted-foreground">
                {z.name}: {z.playing ? `läuft ${z.playing}` : "keine Musik"}
                {z.holdUntil ? ` · Team hat gewählt, Abstimmung ruht bis ${clock(z.holdUntil)} Uhr` : ""}
              </p>
            ))}
          </div>
        )}

        {tooMany && <Notice tone="warning" compact title={`Höchstens ${MAX_VOTE_PLAYLISTS} Playlists.`} />}
        {error && <Notice tone="danger" compact title={error} />}
        {done && !dirty && (
          <Notice tone="success" compact title={saved.enabled ? "Gespeichert. Die Abstimmung ist in der App." : "Gespeichert. Die Abstimmung ist aus."} />
        )}
        <Button onClick={() => void save()} disabled={busy || !dirty || !holdValid || !ready}>
          Speichern
        </Button>
      </CardContent>
    </Card>
  );
}
