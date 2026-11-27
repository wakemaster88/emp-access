"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, Loader2, Megaphone, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { SocialCampaignRow } from "@/lib/social/load";
import { PHASE_LABEL } from "@/lib/social/rules";
import { CampaignFields, campaignFormBody, emptyCampaignForm, type CampaignFormValue } from "./campaign-form";
import { phaseBadge, whenLabel } from "./social-ui";

/** Liste der Kampagnen: laufende zuerst. Ein Klick öffnet die Kampagne. */
export function SocialCampaignsCard({ campaigns, websiteUrl }: { campaigns: SocialCampaignRow[]; websiteUrl: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CampaignFormValue>(() => emptyCampaignForm(websiteUrl));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/social/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignFormBody(form)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.id !== "number") {
        setError(typeof json.error === "string" ? json.error : "Anlegen fehlgeschlagen");
        return;
      }
      router.push(`/newsletter/social/${json.id}`);
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 shrink-0 text-primary" />
            Kampagnen ({campaigns.length})
          </CardTitle>
          <CardDescription>Ein Anlass mit Beiträgen je Kanal und den passenden Newslettern.</CardDescription>
          <CardAction>
            <Button
              onClick={() => {
                setForm(emptyCampaignForm(websiteUrl));
                setError("");
                setOpen(true);
              }}
              className="max-sm:h-11"
              aria-label="Kampagne anlegen"
            >
              <Plus className="h-4 w-4" />
              <span>Kampagne<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Kampagne</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Beiträge</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Newsletter</TableHead>
              <TableHead className="text-right">Stand</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.length === 0 && (
              <TableEmpty colSpan={4}>
                <EmptyState
                  icon={Megaphone}
                  title="Noch keine Kampagne"
                  description="Leg die erste an, z. B. für das Nikolausfahren, und plane dort die Beiträge."
                />
              </TableEmpty>
            )}
            {campaigns.map((c) => (
              <TableRow key={c.id} className="cursor-pointer max-sm:h-11" onClick={() => router.push(`/newsletter/social/${c.id}`)}>
                <TableCell className="max-w-0 w-full whitespace-normal">
                  <Link
                    href={`/newsletter/social/${c.id}`}
                    className="font-medium text-foreground hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {c.period ?? "ohne Zeitraum"}
                    {c.nextPostAt ? ` · nächster Beitrag ${whenLabel(c.nextPostAt)}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums sm:hidden">
                    {c.posts ? `${c.published} von ${c.posts} Beiträgen gepostet` : "noch keine Beiträge"}
                    {c.newsletters ? ` · ${c.newsletters} Newsletter` : ""}
                  </div>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {c.published}
                  <span className="text-muted-foreground"> / {c.posts}</span>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.newsletters}</TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-1.5">
                    {c.overdue > 0 && <AlarmClock className="h-3.5 w-3.5 text-destructive" aria-label={`${c.overdue} überfällig`} />}
                    <Badge variant={phaseBadge(c.phase)} className="font-normal">
                      {PHASE_LABEL[c.phase]}
                    </Badge>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kampagne anlegen</DialogTitle>
            <DialogDescription>Beiträge, Bilder und Newsletter planst du danach in der Kampagne.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (form.name.trim()) void create();
            }}
          >
            <CampaignFields value={form} onChange={setForm} full={false} idPrefix="sc-new" />
            {error && <Notice tone="danger" compact title={error} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving} className="max-sm:h-11">
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving || !form.name.trim()} className="min-w-24 max-sm:h-11">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Anlegen"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
