"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type Step = "credentials" | "code";

interface PrecheckResponse {
  ok?: boolean;
  twoFactor?: boolean;
  locked?: boolean;
  retryAfterSec?: number;
  error?: string;
}

function lockMessage(retryAfterSec?: number) {
  const minutes = Math.max(1, Math.ceil((retryAfterSec ?? 900) / 60));
  return `Zu viele Fehlversuche. Bitte in ${minutes} Minute${minutes === 1 ? "" : "n"} erneut versuchen.`;
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function precheck(): Promise<PrecheckResponse | null> {
    const res = await fetch("/api/login/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 429) {
      const data = (await res.json()) as PrecheckResponse;
      setError(data.error || lockMessage(data.retryAfterSec));
      return null;
    }
    if (!res.ok) {
      setError("Anmeldung derzeit nicht möglich");
      return null;
    }
    return (await res.json()) as PrecheckResponse;
  }

  async function completeSignIn(secondFactor?: string) {
    const result = await signIn("credentials", {
      email,
      password,
      code: secondFactor ?? "",
      redirect: false,
    });
    if (result?.error) return false;
    router.push("/");
    router.refresh();
    return true;
  }

  async function handleCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const status = await precheck();
    if (!status) {
      setLoading(false);
      return;
    }

    if (!status.ok) {
      setError("Ungültige Anmeldedaten");
      setLoading(false);
      return;
    }

    if (status.twoFactor) {
      if (status.locked) {
        setError(lockMessage(status.retryAfterSec));
        setLoading(false);
        return;
      }
      setStep("code");
      setLoading(false);
      return;
    }

    if (!(await completeSignIn())) {
      setError("Ungültige Anmeldedaten");
      setLoading(false);
    }
  }

  async function handleCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (await completeSignIn(code)) return;

    // Der Login meldet aus Prinzip nur „hat nicht geklappt“. Ob das Konto
    // inzwischen gesperrt ist, holen wir separat, damit niemand ratlos vor
    // einem stummen Formular sitzt.
    const status = await precheck();
    if (status?.ok && status.locked) {
      setError(lockMessage(status.retryAfterSec));
      setStep("credentials");
    } else if (status) {
      setError("Code ungültig oder abgelaufen");
    }
    setCode("");
    setLoading(false);
  }

  function backToCredentials() {
    setStep("credentials");
    setCode("");
    setError("");
  }

  return (
    <div className="relative min-h-[100dvh] bg-background bg-grid-dots">
      {/* Farbverlauf oben: gibt der Seite Tiefe, ohne den Inhalt zu stören. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[45vh] bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklch,var(--primary)_22%,transparent),transparent_65%)]"
      />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col lg:grid lg:grid-cols-[1.1fr_minmax(0,26rem)] lg:items-center lg:gap-16 px-4 py-8 sm:px-6 lg:px-8">
        {/* Markenfläche: nur auf großen Bildschirmen. */}
        <section className="hidden lg:flex flex-col gap-8 animate-fade-up">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="EMP Access" width={44} height={44} className="dark:hidden" priority />
            <Image src="/logo-dark.png" alt="EMP Access" width={44} height={44} className="hidden dark:block" priority />
            <div className="leading-none">
              <p className="text-xl font-semibold tracking-tight">EMP Access</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Leitstand</p>
            </div>
          </div>
          <div className="space-y-3">
            <h2 className="text-4xl font-semibold tracking-tight text-balance">
              Zutritt, Technik und Betrieb <span className="text-primary">auf einem Bildschirm.</span>
            </h2>
            <p className="max-w-md text-base text-muted-foreground">
              Drehkreuze, Türen, Kameras, Audio und Bewässerung – überwacht, gesteuert und ausgewertet.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-4 max-w-md">
            {[
              { k: "Zutritt", v: "Tickets · Abos · Scans" },
              { k: "Technik", v: "Geräte · Regeln · Netz" },
              { k: "Sicherheit", v: "Kameras · Personen · Kfz" },
            ].map((f) => (
              <div key={f.k} className="rounded-lg border bg-card/70 px-3 py-2.5 backdrop-blur-sm">
                <dt className="text-label">{f.k}</dt>
                <dd className="mt-1 text-xs text-foreground/80">{f.v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Anmeldung */}
        <div className="flex flex-1 items-center justify-center lg:flex-none animate-fade-up">
          <Card className="w-full max-w-md gap-4 py-7 shadow-lg shadow-black/5 dark:shadow-none">
            <CardHeader className="gap-1 px-6 sm:px-8">
              <div className="mb-3 flex items-center gap-3 lg:hidden">
                <Image src="/logo.png" alt="EMP Access" width={40} height={40} className="dark:hidden" priority />
                <Image src="/logo-dark.png" alt="EMP Access" width={40} height={40} className="hidden dark:block" priority />
                <div className="leading-none">
                  <p className="text-lg font-semibold tracking-tight">EMP Access</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Leitstand</p>
                </div>
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                {step === "credentials" ? "Anmelden" : "Bestätigung in zwei Schritten"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {step === "credentials"
                  ? "Mit E-Mail und Passwort des Mandanten."
                  : "Code aus der Authenticator-App oder ein Wiederherstellungscode."}
              </p>
            </CardHeader>
            <CardContent className="px-6 sm:px-8">
              {step === "credentials" ? (
                <form onSubmit={handleCredentials} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-Mail</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      placeholder="name@betrieb.de"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Passwort</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      enterKeyHint="go"
                      className="h-11"
                    />
                  </div>
                  {error && (
                    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button type="submit" size="lg" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Anmelden …
                      </>
                    ) : (
                      "Anmelden"
                    )}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleCode} className="space-y-4">
                  <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/8 px-3 py-2.5">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <p className="text-sm text-foreground/80">
                      Bitte den aktuellen Code aus der Authenticator-App eingeben. Ersatzweise geht auch ein
                      Wiederherstellungscode.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="code">Code</Label>
                    <Input
                      id="code"
                      name="code"
                      type="text"
                      inputMode="text"
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      autoFocus
                      autoComplete="one-time-code"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="go"
                      className="h-12 text-center text-lg tracking-[0.3em] font-mono"
                    />
                  </div>
                  {error && (
                    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button type="submit" size="lg" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Prüfen …
                      </>
                    ) : (
                      "Bestätigen"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-muted-foreground"
                    onClick={backToCredentials}
                    disabled={loading}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Zurück
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
