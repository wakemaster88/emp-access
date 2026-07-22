"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Login fehlgeschlagen");
        return;
      }
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
    } catch {
      setError("Server nicht erreichbar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex h-full w-full items-center justify-center">
      <form
        onSubmit={submit}
        className="flex w-80 flex-col gap-4 rounded-2xl bg-tile p-8 ring-1 ring-border"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-tile-accent ring-1 ring-border">
            <Lock className="size-5" />
          </span>
          <div>
            <h1 className="text-base font-medium">Webcams Dashboard</h1>
            <p className="text-sm text-foreground/60">Admin-PIN eingeben</p>
          </div>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="rounded-lg border border-border bg-background px-3 py-2 text-lg tracking-widest outline-none focus:ring-2 focus:ring-focus"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !pin}
          className="rounded-lg bg-focus px-4 py-2 text-sm font-medium text-black hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Prüfe…" : "Anmelden"}
        </button>
      </form>
    </main>
  );
}
