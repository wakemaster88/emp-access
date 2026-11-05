"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileDown,
  KeyRound,
  Loader2,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { IconChip, type ChipTone } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SignaturePad, type SignaturePadHandle } from "@/components/ui/signature-pad";
import type { KeySnapshot, PolicySnapshot } from "@/lib/key-policy-pdf";

interface SignPayload {
  state: "OPEN" | "SIGNED" | "EXPIRED";
  kind: string;
  accountName: string;
  expiresAt: string;
  signedAt: string | null;
  signedName: string | null;
  policy: PolicySnapshot;
  keys: KeySnapshot;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Oeffentliche Signaturseite (QR-Link). Mobil zuerst: Belehrung lesen,
 * Haftung bestaetigen, mit dem Finger unterschreiben.
 */
export function KeySignClient({ token }: { token: string }) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [data, setData] = useState<SignPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [acceptedLiability, setAcceptedLiability] = useState(false);
  const [padEmpty, setPadEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/schluessel/${token}`);
        if (!res.ok) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const payload = (await res.json()) as SignPayload;
        if (cancelled) return;
        setData(payload);
        setName(payload.signedName ?? payload.keys.holderName ?? "");
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = useCallback(async () => {
    const signatureImage = padRef.current?.toDataUrl();
    if (!signatureImage) {
      setError("Bitte unterschreibe im Feld.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/schluessel/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedName: name.trim(),
          signatureImage,
          acceptedPolicy: true,
          acceptedLiability,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          typeof payload?.error === "string" ? payload.error : `Fehler (${res.status})`,
        );
        return;
      }
      setDone(true);
    } catch (e) {
      setError(`Netzwerkfehler: ${e instanceof Error ? e.message : "unbekannt"}`);
    } finally {
      setSubmitting(false);
    }
  }, [token, name, acceptedLiability]);

  if (loading) {
    return (
      <Shell>
        <Card className="flex-row items-center justify-center gap-2 py-16 sm:py-16 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Lädt …
        </Card>
      </Shell>
    );
  }

  if (notFound || !data) {
    return (
      <Shell>
        <StateCard
          icon={ShieldAlert}
          tone="neutral"
          title="Link nicht gefunden"
          text="Dieser Link ist ungültig oder wurde zurückgezogen. Bitte wende dich an die ausgebende Stelle."
        />
      </Shell>
    );
  }

  if (done || data.state === "SIGNED") {
    return (
      <Shell accountName={data.accountName}>
        <StateCard
          icon={CheckCircle2}
          tone="success"
          title="Unterschrift erfasst"
          text={
            data.state === "SIGNED" && !done
              ? `Dieses Protokoll wurde bereits am ${fmtDateTime(data.signedAt)} unterschrieben.`
              : "Danke. Die Belehrung wurde protokolliert und archiviert."
          }
        />
        <Button asChild variant="outline" className="mt-4 h-11 w-full">
          <a href={`/api/schluessel/${token}/pdf`} target="_blank" rel="noreferrer">
            <FileDown className="h-4 w-4" />
            Protokoll als PDF öffnen
          </a>
        </Button>
      </Shell>
    );
  }

  if (data.state === "EXPIRED") {
    return (
      <Shell accountName={data.accountName}>
        <StateCard
          icon={Clock}
          tone="warning"
          title="Link abgelaufen"
          text={`Dieser Link war bis zum ${fmtDateTime(data.expiresAt)} gültig. Bitte lass dir einen neuen QR-Code geben.`}
        />
      </Shell>
    );
  }

  const hasLiability = Boolean(data.policy.liabilityText?.trim());
  const canSubmit =
    name.trim().length >= 2 &&
    acceptedPolicy &&
    (!hasLiability || acceptedLiability) &&
    !padEmpty &&
    !submitting;

  return (
    <Shell accountName={data.accountName}>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {data.kind === "RETURN" ? "Schlüsselrückgabe" : "Schlüsselübergabe"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Für {data.keys.holderName} · Protokoll Nr. {data.keys.handoverId}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="inline-flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-primary" />
                Diese Schlüssel erhältst du
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {data.keys.keys.map((k) => (
                <li key={k.keyNumber} className="glass-tile px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground">
                    <span className="font-mono">{k.keyNumber}</span>
                    {k.label && <span className="ml-1.5 font-normal">{k.label}</span>}
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      {k.levelLabel}
                    </span>
                  </p>
                  {k.locks.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Schließt: {k.locks.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {data.keys.dueAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Rückgabe bis {fmtDateTime(data.keys.dueAt)}
              </p>
            )}
            {data.keys.deposit != null && (
              <p className="text-xs tabular-nums text-muted-foreground">
                Pfand: {data.keys.deposit.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>
                Belehrung
                <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                  {data.policy.templateName} · Version {data.policy.version}
                </span>
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="glass-tile max-h-64 overflow-y-auto scrollbar-thin whitespace-pre-line p-3 text-sm leading-relaxed text-foreground/90">
              {data.policy.bodyText}
            </div>
            <CheckRow checked={acceptedPolicy} onChange={setAcceptedPolicy}>
              Ich habe die Belehrung gelesen und verstanden.
            </CheckRow>
          </CardContent>
        </Card>

        {hasLiability && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Haftungserklärung</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="glass-tile max-h-56 overflow-y-auto scrollbar-thin whitespace-pre-line p-3 text-sm leading-relaxed text-foreground/90">
                {data.policy.liabilityText}
              </div>
              <CheckRow checked={acceptedLiability} onChange={setAcceptedLiability}>
                Ich erkenne die Haftungserklärung an.
              </CheckRow>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sign-name">
                Vor- und Nachname <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="h-11 text-base"
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Unterschrift <span className="text-destructive">*</span>
              </Label>
              <SignaturePad ref={padRef} onChangeEmpty={setPadEmpty} height={190} />
            </div>

            {error && <Notice tone="danger" compact icon={AlertTriangle} title={error} />}

            <Button
              onClick={submit}
              disabled={!canSubmit}
              size="lg"
              className="h-12 w-full text-base"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Verbindlich unterschreiben"
              )}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Mit dem Absenden werden Zeitpunkt und IP-Adresse zu Nachweiszwecken gespeichert.
            </p>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

/** Rahmen der Seite: Farbgrund (folgt Hell/Dunkel des Geräts), schmale Spalte. */
function Shell({
  children,
  accountName,
}: {
  children: React.ReactNode;
  accountName?: string;
}) {
  return (
    <main className="page-ambient min-h-dvh px-4 py-6">
      <div className="mx-auto w-full max-w-xl">
        {accountName && (
          <p className="text-label mb-3">
            {accountName}
          </p>
        )}
        {children}
      </div>
    </main>
  );
}

/** Abschluss- oder Fehlerzustand als Glaskarte: Symbol in der Zustandsfarbe, Titel, ein Satz. */
function StateCard({
  icon,
  tone,
  title,
  text,
}: {
  icon: LucideIcon;
  tone: ChipTone;
  title: string;
  text: string;
}) {
  return (
    <Card className="items-center gap-3 px-6 py-10 sm:py-10 text-center">
      <IconChip icon={icon} tone={tone} size="lg" className="size-14 rounded-tile [&_svg]:size-7" />
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}

/** Bestätigung im Formular: Kästchen und Satz, die ganze Zeile ist tippbar. */
function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="glass-tile mt-3 flex w-full cursor-pointer items-start gap-3 p-3 text-left">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-px"
      />
      <span className="text-sm text-foreground/90">{children}</span>
    </label>
  );
}
