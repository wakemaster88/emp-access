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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad, type SignaturePadHandle } from "@/components/ui/signature-pad";
import type { KeySnapshot, PolicySnapshot } from "@/lib/key-policy-pdf";
import { cn } from "@/lib/utils";

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
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (notFound || !data) {
    return (
      <Shell>
        <Notice
          icon={<ShieldAlert className="h-8 w-8 text-slate-400" />}
          title="Link nicht gefunden"
          text="Dieser Link ist ungültig oder wurde zurückgezogen. Bitte wende dich an die ausgebende Stelle."
        />
      </Shell>
    );
  }

  if (done || data.state === "SIGNED") {
    return (
      <Shell accountName={data.accountName}>
        <Notice
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
          title="Unterschrift erfasst"
          text={
            data.state === "SIGNED" && !done
              ? `Dieses Protokoll wurde bereits am ${fmtDateTime(data.signedAt)} unterschrieben.`
              : "Danke. Die Belehrung wurde protokolliert und archiviert."
          }
        />
        <Button asChild variant="outline" className="mt-4 h-11 w-full">
          <a href={`/api/schluessel/${token}/pdf`} target="_blank" rel="noreferrer">
            <FileDown className="mr-1.5 h-4 w-4" />
            Protokoll als PDF öffnen
          </a>
        </Button>
      </Shell>
    );
  }

  if (data.state === "EXPIRED") {
    return (
      <Shell accountName={data.accountName}>
        <Notice
          icon={<Clock className="h-8 w-8 text-amber-500" />}
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
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        {data.kind === "RETURN" ? "Schlüsselrückgabe" : "Schlüsselübergabe"}
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Für {data.keys.holderName} · Protokoll Nr. {data.keys.handoverId}
      </p>

      <section className="mt-5">
        <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
          <KeyRound className="h-4 w-4 text-indigo-500" />
          Diese Schlüssel erhältst du
        </h2>
        <ul className="space-y-1.5">
          {data.keys.keys.map((k) => (
            <li
              key={k.keyNumber}
              className="rounded-md border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900/40"
            >
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                <span className="font-mono">{k.keyNumber}</span>
                {k.label && <span className="ml-1.5 font-normal">{k.label}</span>}
                <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                  {k.levelLabel}
                </span>
              </p>
              {k.locks.length > 0 && (
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Schließt: {k.locks.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
        {data.keys.dueAt && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Rückgabe bis {fmtDateTime(data.keys.dueAt)}
          </p>
        )}
        {data.keys.deposit != null && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pfand: {data.keys.deposit.toFixed(2)} EUR
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          Belehrung
          <span className="ml-1.5 text-[11px] font-normal text-slate-400">
            {data.policy.templateName} · Version {data.policy.version}
          </span>
        </h2>
        <div className="max-h-64 overflow-y-auto whitespace-pre-line rounded-md border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          {data.policy.bodyText}
        </div>
        <CheckRow checked={acceptedPolicy} onChange={setAcceptedPolicy}>
          Ich habe die Belehrung gelesen und verstanden.
        </CheckRow>
      </section>

      {hasLiability && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-200">
            Haftungserklärung
          </h2>
          <div className="max-h-56 overflow-y-auto whitespace-pre-line rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm leading-relaxed text-slate-700 dark:border-amber-900/40 dark:bg-amber-950/10 dark:text-slate-300">
            {data.policy.liabilityText}
          </div>
          <CheckRow checked={acceptedLiability} onChange={setAcceptedLiability}>
            Ich erkenne die Haftungserklärung an.
          </CheckRow>
        </section>
      )}

      <section className="mt-6 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="sign-name" className="text-xs">
            Vor- und Nachname <span className="text-rose-500">*</span>
          </Label>
          <Input
            id="sign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="h-11 text-base"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">
            Unterschrift <span className="text-rose-500">*</span>
          </Label>
          <SignaturePad ref={padRef} onChangeEmpty={setPadEmpty} height={190} />
        </div>

        {error && (
          <p className="inline-flex items-start gap-1.5 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-600 dark:bg-rose-950/30">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <Button
          onClick={submit}
          disabled={!canSubmit}
          className="h-12 w-full bg-indigo-600 text-base hover:bg-indigo-700"
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            "Verbindlich unterschreiben"
          )}
        </Button>
        <p className="text-center text-[11px] text-slate-400">
          Mit dem Absenden werden Zeitpunkt und IP-Adresse zu Nachweiszwecken gespeichert.
        </p>
      </section>
    </Shell>
  );
}

function Shell({
  children,
  accountName,
}: {
  children: React.ReactNode;
  accountName?: string;
}) {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-xl">
        {accountName && (
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
            {accountName}
          </p>
        )}
        {children}
      </div>
    </main>
  );
}

function Notice({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-12 text-center dark:border-slate-800 dark:bg-slate-900">
      {icon}
      <p className="text-base font-medium text-slate-800 dark:text-slate-200">{title}</p>
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  );
}

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
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="mt-2 flex w-full items-start gap-2.5 rounded-md border border-slate-200 bg-white p-3 text-left dark:border-slate-700 dark:bg-slate-900/40"
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
          checked
            ? "border-indigo-600 bg-indigo-600"
            : "border-slate-300 dark:border-slate-600",
        )}
      >
        {checked && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
      </span>
      <span className="text-sm text-slate-700 dark:text-slate-300">{children}</span>
    </button>
  );
}
