"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Gauge, Loader2, Repeat, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RidePassRecap, RidePassStaffView } from "@/lib/ride-pass-staff-types";
import { fmtDay } from "./rider-form";

type Tab = "stats" | "awards" | "challenges" | "vouchers";

const nf = new Intl.NumberFormat("de-DE");

/** „15.11.2026“ aus „2026-11-15“ (ohne Zeitzonen-Verschiebung). */
function ymd(day: string | null): string {
  if (!day) return "–";
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

const TIER_BADGE: Record<number, "neutral" | "secondary" | "light" | "music"> = {
  0: "neutral",
  1: "secondary",
  2: "light",
  3: "music",
};

const VOUCHER_STATE = {
  open: { label: "Offen", variant: "live" },
  redeemed: { label: "Eingelöst", variant: "neutral" },
  expired: { label: "Abgelaufen", variant: "neutral" },
} as const;

/** Liste in einer Fläche: eine Zeile je Eintrag, wie die übrigen Abschnitte im Konto-Dialog. */
function Rows({ children }: { children: React.ReactNode }) {
  return <div className="glass-tile divide-y divide-border overflow-hidden">{children}</div>;
}

function Row({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{title}</div>
        {children && <div className="text-xs text-muted-foreground">{children}</div>}
      </div>
      {aside && <div className="shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular-nums">{aside}</div>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

function RecapBlock({ r }: { r: RidePassRecap }) {
  return (
    <div className="space-y-2">
      <p className="text-label">Saisonrückblick {r.year}</p>
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          size="sm"
          variant="tile"
          label="Luft im Schnitt"
          value={r.air?.avg ?? "–"}
          hint={r.air?.note ?? "kein Messwert"}
          tone="light"
        />
        <StatCard
          size="sm"
          variant="tile"
          label="Wasser im Schnitt"
          value={r.water?.avg ?? "–"}
          hint={r.water?.note ?? (r.waterSensor ? "kein Messwert" : "kein Fühler gewählt")}
          tone="water"
          icon={Waves}
        />
      </div>
      <div className="glass-tile divide-y divide-border overflow-hidden">
        <Fact label="Besuchstage" value={nf.format(r.visitDays)} />
        <Fact label="Starts" value={nf.format(r.starts)} />
        <Fact label="Längste Serie" value={`${r.streakWeeks} ${r.streakWeeks === 1 ? "Woche" : "Wochen"}`} />
        {r.bestMonth && <Fact label="Bester Monat" value={r.bestMonth} />}
        {r.bestWeekday && <Fact label="Lieblingstag" value={r.bestWeekday} />}
        {r.bestDay && <Fact label="Bester Tag" value={`${ymd(r.bestDay.day)} · ${r.bestDay.starts} Starts`} />}
        <Fact label="Erster und letzter Tag" value={`${ymd(r.firstDay)} – ${ymd(r.lastDay)}`} />
        {r.aheadOf != null && <Fact label="Öfter da als" value={`${r.aheadOf} % der Abo-Fahrer`} />}
      </div>
    </div>
  );
}

/**
 * Ride Pass einer Person im Kundenkonto: dieselben Zahlen wie in der
 * Kunden-App (Statistik, Saisonrückblick mit Temperaturen, Awards,
 * Challenges, Gutscheine), nur zum Ansehen.
 */
export function RidePassPanel({ personId, personName, onBack }: { personId: number; personName: string; onBack: () => void }) {
  const [data, setData] = useState<RidePassStaffView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stats");

  useEffect(() => {
    let alive = true;
    fetch(`/api/customers/persons/${personId}/ride-pass`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as RidePassStaffView & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Laden fehlgeschlagen");
        if (alive) setData(body);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Laden fehlgeschlagen"));
    return () => {
      alive = false;
    };
  }, [personId]);

  const back = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" className="max-sm:h-11" onClick={onBack}>
        Zurück
      </Button>
    </div>
  );

  if (error) {
    return (
      <>
        <Notice tone="danger" compact role="alert" title={error} />
        {back}
      </>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="mr-2 size-4 animate-spin" /> Ride Pass wird geladen …
      </div>
    );
  }
  if (data.empty || !data.stats) {
    return (
      <>
        <EmptyState compact title={`Für ${personName} gibt es noch keine Fahrten.`} description="Zahlen erscheinen, sobald die Person mit einem Abo fährt." />
        {back}
      </>
    );
  }

  const s = data.stats;
  const openVouchers = data.vouchers.filter((v) => v.state === "open").length;
  const runningChallenges = data.challenges.filter((c) => c.running).length;
  const appLine = data.lastSeenAt
    ? `Zuletzt in der App am ${fmtDay(data.lastSeenAt)}`
    : "Hat die App noch nicht geöffnet";
  const nickLine = data.nickname
    ? ` · Spitzname „${data.nickname}“${data.showInRanking ? ", in der Rangliste sichtbar" : ", in Ranglisten anonym"}`
    : "";

  return (
    <>
      {!data.enabled && (
        <Notice tone="info" compact title="Die Kunden-App ist ausgeschaltet, Awards und Challenges ruhen." />
      )}
      <p className="text-xs text-muted-foreground">{appLine}{nickLine}.</p>

      <div className="grid grid-cols-2 gap-2">
        <StatCard size="sm" variant="tile" label={`Besuchstage ${data.year}`} value={nf.format(s.visitDays)} icon={CalendarDays} hint={s.level ?? undefined} />
        <StatCard size="sm" variant="tile" label={`Starts ${data.year}`} value={nf.format(s.starts)} icon={Gauge} />
        <StatCard size="sm" variant="tile" label="Starts gesamt" value={nf.format(s.startsTotal)} icon={Gauge} />
        <StatCard
          size="sm"
          variant="tile"
          label="Saisons"
          value={s.seasons}
          icon={Repeat}
          hint={s.seasonsSince ? `seit ${s.seasonsSince}` : undefined}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-3">
        <TabsList className="w-full">
          <TabsTrigger value="stats" className="px-2.5 sm:px-3">Statistik</TabsTrigger>
          <TabsTrigger value="awards" className="px-2.5 sm:px-3">Awards ({data.awards.unlocked.length})</TabsTrigger>
          <TabsTrigger value="challenges" className="px-2.5 sm:px-3">Challenges{runningChallenges > 0 ? ` (${runningChallenges})` : ""}</TabsTrigger>
          <TabsTrigger value="vouchers" className="px-2.5 sm:px-3">Gutscheine{openVouchers > 0 ? ` (${openVouchers})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="stats" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {s.streakWeeks > 0 ? `Gerade ${s.streakWeeks} ${s.streakWeeks === 1 ? "Woche" : "Wochen"} in Folge da.` : "Gerade keine Serie."}
          </p>
          {data.recaps.length === 0 ? (
            <EmptyState compact title="Noch kein Besuchstag in dieser oder der letzten Saison." />
          ) : (
            data.recaps.map((r) => <RecapBlock key={r.year} r={r} />)
          )}
        </TabsContent>

        <TabsContent value="awards" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {data.awards.unlocked.length} von {data.awards.total} Awards in dieser Saison bzw. insgesamt.
          </p>
          {data.awards.unlocked.length === 0 ? (
            <EmptyState compact title="Noch kein Award." />
          ) : (
            <Rows>
              {data.awards.unlocked.map((a) => (
                <Row
                  key={a.id}
                  title={<>{a.name}<Badge variant={TIER_BADGE[a.tierRank] ?? "neutral"}>{a.tier}</Badge></>}
                  aside={a.awardedAt ? fmtDay(a.awardedAt) : undefined}
                >
                  {a.category} · {a.text}
                </Row>
              ))}
            </Rows>
          )}
          {data.awards.next.length > 0 && (
            <div className="space-y-2">
              <p className="text-label">Am nächsten dran</p>
              <Rows>
                {data.awards.next.map((a) => (
                  <Row key={a.id} title={a.name} aside={`${nf.format(a.value)} / ${nf.format(a.threshold)}`}>
                    {a.remaining}
                  </Row>
                ))}
              </Rows>
            </div>
          )}
          {data.awards.earlier.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Früher schon geholt: {data.awards.earlier.map((a) => `${a.name} (${a.period})`).join(", ")}.
            </p>
          )}
        </TabsContent>

        <TabsContent value="challenges" className="space-y-3">
          {data.challenges.length === 0 ? (
            <EmptyState compact title="Gerade läuft keine Challenge, in den letzten 30 Tagen ist keine zu Ende gegangen." />
          ) : (
            <Rows>
              {data.challenges.map((c) => (
                <Row
                  key={c.id}
                  title={
                    <>
                      {c.name}
                      {c.won ? (
                        <Badge variant="success">{c.kind === "Aufgabe" ? "Geschafft" : "Gewonnen"}</Badge>
                      ) : c.running ? (
                        <Badge variant="info">Läuft</Badge>
                      ) : (
                        <Badge variant="neutral">Beendet</Badge>
                      )}
                    </>
                  }
                  aside={`bis ${fmtDay(c.endDate)}`}
                >
                  {c.kind} · {c.standing}
                  {c.voucherLabel ? ` · Gewinn: ${c.voucherLabel}` : ""}
                </Row>
              ))}
            </Rows>
          )}
        </TabsContent>

        <TabsContent value="vouchers" className="space-y-3">
          {data.vouchers.length === 0 ? (
            <EmptyState compact title="Noch kein Gutschein." />
          ) : (
            <Rows>
              {data.vouchers.map((v) => {
                const st = VOUCHER_STATE[v.state];
                return (
                  <Row key={v.id} title={<>{v.label}<Badge variant={st.variant}>{st.label}</Badge></>}>
                    <span className="font-mono">{v.code}</span>
                    {v.award ? ` · aus ${v.award}` : ""}
                    {" · "}
                    {v.state === "redeemed"
                      ? `eingelöst am ${fmtDay(v.redeemedAt, "–")}`
                      : v.expiresAt
                        ? `${v.state === "open" ? "gültig bis" : "abgelaufen am"} ${fmtDay(v.expiresAt)}`
                        : "ohne Ablauf"}
                  </Row>
                );
              })}
            </Rows>
          )}
          <p className="text-xs text-muted-foreground">Einlösen geht am Gutschein-Monitor oder unter Kunden App › Gutscheine.</p>
        </TabsContent>
      </Tabs>

      {back}
    </>
  );
}
