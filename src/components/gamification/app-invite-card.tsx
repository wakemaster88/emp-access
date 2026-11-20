"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import type { InviteStatus } from "@/lib/rider-invite";

/**
 * Einladung zur App per Mail: bei neuem anny-Abo und an Bestandskunden,
 * je ein Schalter (lib/rider-invite). Bestandskunden erst nach Rückfrage,
 * weil dann viele echte Mails rausgehen.
 */
export function AppInviteCard({ initial }: { initial: InviteStatus }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmExisting, setConfirmExisting] = useState(false);
  const [error, setError] = useState("");

  async function save(patch: Partial<Pick<InviteStatus, "inviteNewAbos" | "inviteExistingAbos">>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/gamification/invites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      if (json.status) setStatus(json.status as InviteStatus);
      setConfirmExisting(false);
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  const open = status.openExisting;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary shrink-0" />
          Einladung zur App
        </CardTitle>
        <CardDescription>
          Je Adresse eine Mail mit Link, nur an wen noch nicht in der App ist.
          {status.sent > 0 && ` Bisher ${status.sent} verschickt.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {status.blocker && <Notice tone="warning" compact title={status.blocker} />}

        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="invite-new">Bei neuem Abo aus anny</Label>
            <p className="text-xs text-muted-foreground">
              Nur frisch gebuchte Abos, nach dem nächsten Abgleich. Keine Verlängerungen.
            </p>
          </div>
          <Switch
            id="invite-new"
            checked={status.inviteNewAbos}
            disabled={busy}
            onCheckedChange={(v) => void save({ inviteNewAbos: v })}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="invite-existing">An Bestandskunden</Label>
              <p className="text-xs text-muted-foreground">
                {open === 1 ? "1 Adresse" : `${open} Adressen`} offen. Höchstens 10 Mails je 5 Minuten, 9 bis 20 Uhr. Aus stoppt sofort.
              </p>
            </div>
            <Switch
              id="invite-existing"
              checked={status.inviteExistingAbos || confirmExisting}
              disabled={busy}
              onCheckedChange={(v) => (v ? setConfirmExisting(true) : void save({ inviteExistingAbos: false }))}
            />
          </div>
          {confirmExisting && !status.inviteExistingAbos && (
            <Notice
              tone="warning"
              compact
              title={`${open === 1 ? "1 Kunde bekommt" : `${open} Kunden bekommen`} eine echte Mail.`}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setConfirmExisting(false)} disabled={busy} className="max-sm:h-11">
                    Abbrechen
                  </Button>
                  <Button size="sm" onClick={() => void save({ inviteExistingAbos: true })} disabled={busy} className="max-sm:h-11">
                    Einladen
                  </Button>
                </div>
              }
            />
          )}
        </div>

        {error && <Notice tone="danger" compact role="alert" title={error} />}
      </CardContent>
    </Card>
  );
}
