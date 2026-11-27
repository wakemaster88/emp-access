"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Hash, Loader2, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import type { SocialCampaignDetail } from "@/lib/social/load";
import { PHASE_LABEL } from "@/lib/social/rules";
import { CampaignFields, campaignFormBody, type CampaignFormValue } from "./campaign-form";
import { phaseBadge } from "./social-ui";

type Campaign = SocialCampaignDetail["campaign"];

function toForm(c: Campaign): CampaignFormValue {
  return {
    name: c.name,
    slug: c.slug,
    slugTouched: true,
    startsOn: c.startsOn ?? "",
    endsOn: c.endsOn ?? "",
    landingUrl: c.landingUrl ?? "",
    hashtags: c.hashtags ?? "",
    description: c.description ?? "",
  };
}

/** Kopf der Kampagne: Zeitraum, Ziel, Hashtags, Beschreibung; Bearbeiten und Löschen. */
export function CampaignCard({ campaign, postCount, newsletterCount }: { campaign: Campaign; postCount: number; newsletterCount: number }) {
  const router = useRouter();
  const [form, setForm] = useState<CampaignFormValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/social/campaigns/${campaign.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignFormBody(form)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      setForm(null);
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/social/campaigns/${campaign.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Löschen fehlgeschlagen");
        setConfirmDelete(false);
        return;
      }
      router.push("/newsletter?tab=social");
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{campaign.name}</span>
            <Badge variant={phaseBadge(campaign.phase)} className="font-normal">
              {PHASE_LABEL[campaign.phase]}
            </Badge>
          </CardTitle>
          <CardDescription>
            {campaign.period ?? "Ohne Zeitraum"} · Kürzel <span className="font-mono">{campaign.slug}</span>
            {campaign.createdBy ? ` · angelegt von ${campaign.createdBy}` : ""}
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              className="max-sm:h-11"
              onClick={() => {
                setForm(toForm(campaign));
                setError("");
                setConfirmDelete(false);
              }}
            >
              <Pencil className="h-4 w-4" />
              <span>Bearbeiten</span>
            </Button>
          </CardAction>
        </CardHeader>
        {(campaign.description || campaign.landingUrl || campaign.hashtags) && (
          <CardContent className="space-y-3 text-[13px]">
            {campaign.description && <p className="whitespace-pre-line text-foreground">{campaign.description}</p>}
            {campaign.landingUrl && (
              <p className="flex min-w-0 items-start gap-2 text-muted-foreground">
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <a href={campaign.landingUrl} target="_blank" rel="noreferrer" className="min-w-0 break-all text-foreground hover:underline">
                  {campaign.landingUrl}
                </a>
              </p>
            )}
            {campaign.hashtags && (
              <p className="flex min-w-0 items-start gap-2 text-muted-foreground">
                <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 break-words">{campaign.hashtags}</span>
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && !busy && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kampagne bearbeiten</DialogTitle>
            <DialogDescription>Ein neues Kürzel gilt für Links, die ab jetzt kopiert oder verschickt werden.</DialogDescription>
          </DialogHeader>
          {form && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (form.name.trim()) void save();
              }}
            >
              <CampaignFields value={form} onChange={setForm} full idPrefix="sc-edit" />
              {error && <Notice tone="danger" compact title={error} />}
              {confirmDelete ? (
                <ConfirmStep
                  title={`Kampagne „${campaign.name}“ löschen?`}
                  description={`${postCount} ${postCount === 1 ? "Beitrag geht" : "Beiträge gehen"} mit verloren. ${
                    newsletterCount ? `${newsletterCount} ${newsletterCount === 1 ? "Aussendung bleibt" : "Aussendungen bleiben"} im Newsletter, ohne Kampagne.` : ""
                  }`}
                  pending={busy}
                  onConfirm={() => void remove()}
                  onCancel={() => setConfirmDelete(false)}
                />
              ) : (
                <DialogFooter
                  start={
                    <Button type="button" variant="ghost" className="text-destructive max-sm:h-11" onClick={() => setConfirmDelete(true)} disabled={busy}>
                      <Trash2 className="h-4 w-4" />
                      Löschen
                    </Button>
                  }
                >
                  <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={busy} className="max-sm:h-11">
                    Abbrechen
                  </Button>
                  <Button type="submit" disabled={busy || !form.name.trim()} className="min-w-24 max-sm:h-11">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
                  </Button>
                </DialogFooter>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
