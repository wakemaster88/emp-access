"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Facebook, Instagram, Link2, Loader2, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import { IconChip } from "@/components/ui/icon-chip";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import type { MetaStatus } from "@/lib/social/meta-store";
import { copyText } from "./share";
import { whenLabel } from "./social-ui";

/** Rückmeldung nach dem Rücksprung von Meta (?meta=…). */
const RESULT: Record<string, { tone: "success" | "info" | "warning" | "danger"; title: string; text?: string }> = {
  verbunden: { tone: "success", title: "Mit Meta verbunden" },
  "seite-waehlen": { tone: "info", title: "Bitte noch die Facebook-Seite wählen" },
  "keine-seite": {
    tone: "warning",
    title: "Keine Facebook-Seite freigegeben",
    text: "Beim Verbinden die Seite auswählen, mit der das Instagram-Profil verknüpft ist.",
  },
  "rechte-fehlen": {
    tone: "warning",
    title: "Nicht alle Rechte freigegeben",
    text: "Bitte neu verbinden und bei Meta alle Häkchen gesetzt lassen.",
  },
  abgebrochen: { tone: "info", title: "Verbinden abgebrochen" },
  abgelaufen: { tone: "warning", title: "Die Anmeldung ist abgelaufen", text: "Bitte noch einmal „Mit Facebook verbinden“ drücken." },
  fehler: { tone: "danger", title: "Verbinden hat nicht geklappt" },
  "nicht-eingerichtet": { tone: "warning", title: "Meta ist noch nicht eingerichtet" },
};

/** Karte „Instagram und Facebook“: Verbindung zur Meta Graph API. */
export function MetaCard({ status, result }: { status: MetaStatus; result: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "page" | "stats" | "disconnect">("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pageId, setPageId] = useState(status.pageChoices[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const notice = result ? RESULT[result] : undefined;

  async function call(kind: "page" | "stats" | "disconnect", init: RequestInit & { url: string }) {
    setBusy(kind);
    setError("");
    setInfo("");
    try {
      const res = await fetch(init.url, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt");
        return;
      }
      if (kind === "stats") {
        setInfo(json.updated ? `Zahlen für ${json.updated} ${json.updated === 1 ? "Beitrag" : "Beiträge"} abgerufen` : "Keine über emp-access geposteten Beiträge der letzten 30 Tage");
      }
      setConfirm(false);
      // Rückmeldung aus der Adresse entfernen, damit sie nach dem Neuladen nicht wieder steht.
      router.replace("/newsletter?tab=social", { scroll: false });
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugZap className="h-4 w-4 shrink-0 text-primary" />
          Instagram und Facebook
        </CardTitle>
        <CardDescription>
          {status.connected
            ? "Beiträge mit „Automatisch posten“ gehen zum Termin raus. Zahlen kommen alle 6 Stunden."
            : "Verbinde die Facebook-Seite, dann kann emp-access zum Termin posten und die Zahlen abrufen."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && (
          <Notice tone={notice.tone} compact title={notice.title}>
            {notice.text ?? (result === "fehler" && status.lastError ? status.lastError : null)}
          </Notice>
        )}

        {!status.configured ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              Es fehlt noch die Meta-App: App-ID und App-Geheimnis gehören in Vercel als <code className="font-mono text-xs">META_APP_ID</code> und{" "}
              <code className="font-mono text-xs">META_APP_SECRET</code>. Danach erscheint hier „Mit Facebook verbinden“.
            </p>
            {status.redirectUri && (
              <div className="glass-tile space-y-1.5 p-3">
                <p className="text-xs text-muted-foreground">Rücksprungadresse für die Meta-App (Facebook Login, „Gültige OAuth-Redirect-URIs“):</p>
                <div className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{status.redirectUri}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 max-sm:h-11"
                    onClick={() => void copyText(status.redirectUri!).then((ok) => ok && setCopied(true))}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {copied ? "Kopiert" : "Kopieren"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : status.connected ? (
          <>
            <ul className="space-y-2">
              <li className="glass-tile flex min-h-12 items-center gap-3 px-3 py-2">
                <IconChip icon={Facebook} tone="primary" size="sm" label="Facebook" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{status.pageName}</span>
                  <span className="block text-xs text-muted-foreground">Facebook-Seite</span>
                </span>
              </li>
              <li className="glass-tile flex min-h-12 items-center gap-3 px-3 py-2">
                <IconChip icon={Instagram} tone="primary" size="sm" label="Instagram" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {status.instagram ? (status.igUsername ? `@${status.igUsername}` : "Instagram-Profil") : "Kein Instagram-Profil verknüpft"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {status.instagram ? "Instagram-Profil" : "Instagram-Profil als Business-Konto mit der Facebook-Seite verknüpfen, dann neu verbinden"}
                  </span>
                </span>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Verbunden {whenLabel(status.connectedAt) ?? ""}
              {status.connectedBy ? ` von ${status.connectedBy}` : ""}
              {status.statsSyncAt ? ` · Zahlen ${whenLabel(status.statsSyncAt)}` : ""}
            </p>
            {status.lastError && <Notice tone="warning" compact title={status.lastError} />}
            {status.missingScopes.length > 0 && (
              <Notice tone="info" compact title="Nicht alle Rechte freigegeben">
                Es fehlt: {status.missingScopes.join(", ")}. Neu verbinden und alle Häkchen gesetzt lassen.
              </Notice>
            )}
          </>
        ) : status.pageChoices.length > 0 ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void call("page", {
                url: "/api/social/meta",
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageId }),
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="meta-page">Facebook-Seite</Label>
              <NativeSelect id="meta-page" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                {status.pageChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.igUsername ? ` (Instagram @${p.igUsername})` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" disabled={!pageId || busy !== ""} className="max-sm:h-11 max-sm:w-full">
              {busy === "page" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Seite übernehmen
            </Button>
          </form>
        ) : (
          status.lastError && !notice && <Notice tone="warning" compact title={status.lastError} />
        )}

        {error && <Notice tone="danger" compact title={error} />}
        {info && <Notice tone="success" compact title={info} />}

        {status.configured &&
          (confirm ? (
            <ConfirmStep
              title="Verbindung zu Meta trennen?"
              description="emp-access postet dann nichts mehr automatisch und ruft keine Zahlen mehr ab. Bei Facebook bleibt die App freigegeben, bis du sie unter Einstellungen › Business-Integrationen entfernst."
              confirmLabel="Trennen"
              icon={Unplug}
              pending={busy === "disconnect"}
              onConfirm={() => void call("disconnect", { url: "/api/social/meta", method: "DELETE" })}
              onCancel={() => setConfirm(false)}
            />
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {status.connected && (
                <Button
                  type="button"
                  variant="outline"
                  className="max-sm:h-11"
                  disabled={busy !== ""}
                  onClick={() => void call("stats", { url: "/api/social/meta/stats", method: "POST" })}
                >
                  {busy === "stats" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                  Zahlen jetzt abrufen
                </Button>
              )}
              <Button asChild variant={status.connected ? "outline" : "default"} className="max-sm:h-11">
                <a href="/api/social/meta/connect">
                  {status.connected ? <RefreshCw className="h-4 w-4" /> : <Facebook className="h-4 w-4" />}
                  {status.connected ? "Neu verbinden" : "Mit Facebook verbinden"}
                </a>
              </Button>
              {(status.connected || status.pageChoices.length > 0) && (
                <Button type="button" variant="ghost" className="text-destructive max-sm:h-11" disabled={busy !== ""} onClick={() => setConfirm(true)}>
                  <Unplug className="h-4 w-4" />
                  Trennen
                </Button>
              )}
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
