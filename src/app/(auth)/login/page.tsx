"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, ShieldCheck } from "lucide-react";
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <Card className="w-full max-w-md border-slate-200 dark:border-slate-800 shadow-xl">
        <CardHeader className="text-center pb-2">
          <Image src="/logo.png" alt="EMP Access" width={80} height={80} className="mx-auto mb-4 dark:hidden" priority />
          <Image src="/logo-dark.png" alt="EMP Access" width={80} height={80} className="mx-auto mb-4 hidden dark:block" priority />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">EMP Access</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {step === "credentials" ? "Zugangskontrolle anmelden" : "Bestätigung in zwei Schritten"}
          </p>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form onSubmit={handleCredentials} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="admin@example.de"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
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
                />
              </div>
              {error && (
                <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                {loading ? "Anmelden..." : "Anmelden"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleCode} className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2.5">
                <ShieldCheck className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5" />
                <p className="text-sm text-slate-600 dark:text-slate-300">
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
                  className="text-center text-lg tracking-[0.3em] font-mono"
                />
              </div>
              {error && (
                <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                {loading ? "Prüfen..." : "Bestätigen"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-slate-500"
                onClick={backToCredentials}
                disabled={loading}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Zurück
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
