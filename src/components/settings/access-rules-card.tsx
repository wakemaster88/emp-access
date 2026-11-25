"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  ACCESS_RULE_KEYS,
  ACCESS_RULE_TEXTS,
  PASSBACK_MAX_MINUTES,
  PASSBACK_MIN_MINUTES,
  PASSBACK_SUGGESTED_MINUTES,
  isPassbackMinutes,
  type AccessRuleChange,
  type AccessRuleKey,
  type AccessRules,
} from "@/lib/access-rules";

interface Affected {
  readersWithoutArea: number;
  partnerScansAtReadersWithoutArea?: number;
  ticketsWithoutArea: number;
  staffTicketsWithoutArea: number;
  vouchersWithArea: number;
  /** Bereiche, in denen „Wiedereintritt …“ gilt (fehlt bei älterem Server). */
  passbackAreas?: string[];
  /** Bereiche mit Einlass-, aber ohne Ausgangs-Leser. */
  passbackExemptAreas?: string[];
}

interface Props {
  initial: AccessRules;
}

/** „Betrifft heute: …“ je Regel, wo es eine Zahl gibt. */
function affectedText(key: AccessRuleKey, a: Affected | null): string | null {
  if (!a) return null;
  switch (key) {
    case "readerNeedsArea":
      return `Betrifft heute: ${a.readersWithoutArea} aktive${a.readersWithoutArea === 1 ? "r" : ""} Leser ohne Bereich`
        + (a.partnerScansAtReadersWithoutArea
          ? `, dort ${a.partnerScansAtReadersWithoutArea} Wakesys-/Binarytec-Einlass${a.partnerScansAtReadersWithoutArea === 1 ? "" : "e"} in den letzten 7 Tagen`
          : "");
    case "ticketNeedsArea":
      return `Betrifft heute: ${a.ticketsWithoutArea} heute gültige${a.ticketsWithoutArea === 1 ? "s" : ""} Ticket${a.ticketsWithoutArea === 1 ? "" : "s"} ohne Bereich`
        + (a.staffTicketsWithoutArea > 0 ? `, davon ${a.staffTicketsWithoutArea} Mitarbeiter` : "");
    case "voucherNeedsArea":
      return `Betrifft heute: ${a.vouchersWithArea} offene${a.vouchersWithArea === 1 ? "r" : ""} Gutschein${a.vouchersWithArea === 1 ? "" : "e"} mit Bereich, selbst oder über den Ticket-Typ`;
    default:
      return null;
  }
}

/** „Betrifft heute“ der Regel „Wiedereintritt …“: je Gedanke eine Zeile. */
function passbackAreaLines(a: Affected | null): string[] {
  if (!a || !Array.isArray(a.passbackAreas)) return [];
  const exempt = a.passbackExemptAreas ?? [];
  return [
    a.passbackAreas.length > 0
      ? `Gilt in: ${a.passbackAreas.join(", ")}`
      : exempt.length > 0
        ? "Gilt in keinem Bereich: kein Bereich hat einen Ausgangs-Leser"
        : "Gilt derzeit in keinem Bereich",
    ...(exempt.length > 0 ? [`Ausgenommen, weil ohne Ausgang: ${exempt.join(", ")}`] : []),
  ];
}

function isOn(rules: AccessRules, key: AccessRuleKey): boolean {
  return key === "passbackMinutes" ? rules.passbackMinutes > 0 : rules[key];
}

function changeValue(key: AccessRuleKey, v: boolean | number): string {
  if (key === "passbackMinutes") return typeof v === "number" && v > 0 ? `${v} Min.` : "aus";
  return v ? "an" : "aus";
}

function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Einstellungen › Einlass-Regeln: strengere Prüfungen am Einlass, ab Werk
 * aus. Einschalten fragt im Karteninhalt nach (ConfirmStep), Ausschalten
 * wirkt sofort. Der Scan übernimmt eine Änderung spätestens nach 60 s.
 */
export function AccessRulesCard({ initial }: Props) {
  const [rules, setRules] = useState<AccessRules>({ ...initial });
  const [affected, setAffected] = useState<Affected | null>(null);
  const [changes, setChanges] = useState<AccessRuleChange[]>([]);
  const [confirmKey, setConfirmKey] = useState<AccessRuleKey | null>(null);
  const [minutesDraft, setMinutesDraft] = useState(String(PASSBACK_SUGGESTED_MINUTES));
  const [busyKey, setBusyKey] = useState<AccessRuleKey | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/access-rules")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        setRules(json.rules);
        setAffected(json.affected ?? null);
        setChanges(Array.isArray(json.changes) ? json.changes : []);
        if (json.rules?.passbackMinutes > 0) setMinutesDraft(String(json.rules.passbackMinutes));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Speichert eine Regel; wirft mit deutscher Meldung (für ConfirmStep). */
  async function save(patch: Partial<AccessRules>) {
    const res = await fetch("/api/settings/access-rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof json.error === "string" ? json.error : "Speichern hat nicht geklappt.");
    }
    setRules(json.rules);
    setChanges(Array.isArray(json.changes) ? json.changes : []);
  }

  async function switchOff(key: AccessRuleKey) {
    setBusyKey(key);
    setError("");
    try {
      await save(key === "passbackMinutes" ? { passbackMinutes: 0 } : { [key]: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern hat nicht geklappt.");
    } finally {
      setBusyKey(null);
    }
  }

  async function switchOn(key: AccessRuleKey) {
    const minutes = Number(minutesDraft);
    if (key === "passbackMinutes" && !isPassbackMinutes(minutes)) {
      throw new Error(`Bitte eine ganze Zahl von ${PASSBACK_MIN_MINUTES} bis ${PASSBACK_MAX_MINUTES} Minuten eingeben.`);
    }
    // Während des Speicherns sind alle Schalter gesperrt, damit dieselbe
    // Seite nicht zwei Änderungen gleichzeitig abschickt.
    setBusyKey(key);
    try {
      await save(key === "passbackMinutes" ? { passbackMinutes: minutes } : { [key]: true });
    } finally {
      setBusyKey(null);
    }
    setConfirmKey(null);
  }

  async function saveMinutes() {
    const minutes = Number(minutesDraft);
    if (!isPassbackMinutes(minutes)) {
      setError(`Bitte eine ganze Zahl von ${PASSBACK_MIN_MINUTES} bis ${PASSBACK_MAX_MINUTES} Minuten eingeben.`);
      return;
    }
    setBusyKey("passbackMinutes");
    setError("");
    try {
      await save({ passbackMinutes: minutes });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern hat nicht geklappt.");
    } finally {
      setBusyKey(null);
    }
  }

  const minutesField = (id: string) => (
    <div className="space-y-1">
      <Label htmlFor={id}>Wartezeit in Minuten</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={PASSBACK_MIN_MINUTES}
        max={PASSBACK_MAX_MINUTES}
        value={minutesDraft}
        onChange={(e) => setMinutesDraft(e.target.value)}
        className="w-28 max-sm:h-11"
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <IconChip icon={ShieldCheck} size="lg" />
          <div className="min-w-0 space-y-1">
            <CardTitle><h3>Einlass-Regeln</h3></CardTitle>
            <CardDescription>
              Strengere Prüfungen an Drehkreuzen, Türen und Handscanner. Ab Werk ist jede Regel aus.
              Eine Änderung gilt am Einlass spätestens nach einer Minute.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {ACCESS_RULE_KEYS.map((key) => {
          const text = ACCESS_RULE_TEXTS[key];
          const on = isOn(rules, key);
          const count = affectedText(key, affected);
          const lines = key === "passbackMinutes" ? passbackAreaLines(affected) : count ? [count] : [];
          const switchId = `rule-${key}`;
          return (
            <div key={key} className="glass-tile space-y-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={switchId} className="block text-[13px] font-medium leading-snug">
                    {text.title}
                  </Label>
                  <p className="text-[12px] text-muted-foreground">{text.effect}</p>
                  {key === "passbackMinutes" && on && (
                    <p className="text-[12px] text-muted-foreground">Wartezeit: {rules.passbackMinutes} Minuten</p>
                  )}
                  {lines.map((line) => (
                    <p key={line} className="break-words text-[12px] font-medium tabular-nums">{line}</p>
                  ))}
                </div>
                <div className="flex shrink-0 items-center gap-2 pt-0.5">
                  {busyKey === key && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
                  <Switch
                    id={switchId}
                    checked={on || confirmKey === key}
                    // Gesperrt, solange gespeichert wird oder eine andere Regel
                    // gerade auf ihre Bestätigung wartet: nie zwei Änderungen zugleich.
                    disabled={busyKey != null || (confirmKey != null && confirmKey !== key)}
                    onCheckedChange={(next) => {
                      setError("");
                      if (next) {
                        if (key === "passbackMinutes") setMinutesDraft(String(PASSBACK_SUGGESTED_MINUTES));
                        setConfirmKey(key);
                      } else if (confirmKey === key) {
                        setConfirmKey(null);
                      } else {
                        void switchOff(key);
                      }
                    }}
                  />
                </div>
              </div>

              {confirmKey === key && !on && (
                <div className="space-y-3">
                  {key === "passbackMinutes" && minutesField(`${switchId}-confirm-minutes`)}
                  <ConfirmStep
                    title={`„${text.title}“ einschalten?`}
                    description={[text.effect, ...lines.map((l) => `${l}.`), text.confirm ?? ""].filter(Boolean).join(" ")}
                    confirmLabel="Einschalten"
                    destructive={false}
                    onConfirm={() => switchOn(key)}
                    onCancel={() => setConfirmKey(null)}
                  />
                </div>
              )}

              {key === "passbackMinutes" && on && (
                <div className="flex flex-wrap items-end gap-2">
                  {minutesField(`${switchId}-minutes`)}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveMinutes()}
                    disabled={busyKey != null || confirmKey != null || Number(minutesDraft) === rules.passbackMinutes}
                    className="max-sm:h-11"
                  >
                    Übernehmen
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {error && <Notice tone="danger" compact title={error} />}

        {changes.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-label">Letzte Änderungen</p>
            <ul className="space-y-1 text-[12px] text-muted-foreground">
              {changes.slice(0, 5).map((c, i) => (
                <li key={`${c.at}-${c.key}-${i}`} className="break-words">
                  {formatAt(c.at)} · {ACCESS_RULE_TEXTS[c.key].title}: {changeValue(c.key, c.from)} → {changeValue(c.key, c.to)}
                  {c.admin ? ` · ${c.admin}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
