"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Mail, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { CampaignStatus } from "@/lib/newsletter/rules";
import { percent } from "@/lib/newsletter/stats";
import { campaignBadge, starterBlocks } from "./campaign-ui";

export interface CampaignRow {
  id: number;
  subject: string;
  status: CampaignStatus;
  statusLabel: string;
  dateLabel: string;
  recipients: number;
  sent: number;
  delivered: number;
  progress: number;
  hasError: boolean;
}

/** Liste der Aussendungen, neueste zuerst. Ein Klick öffnet den Editor. */
export function CampaignsCard({
  campaigns,
  activeCount,
  websiteUrl,
}: {
  campaigns: CampaignRow[];
  activeCount: number;
  websiteUrl: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/newsletter/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), blocks: starterBlocks(subject.trim(), websiteUrl) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.id !== "number") {
        setError(typeof json.error === "string" ? json.error : "Anlegen fehlgeschlagen");
        return;
      }
      router.push(`/newsletter/${json.id}`);
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
            <Mail className="h-4 w-4 shrink-0 text-primary" />
            Aussendungen ({campaigns.length})
          </CardTitle>
          <CardDescription>
            Geht an alle {activeCount} angemeldeten Abonnenten. Vorher an dich selbst testen.
          </CardDescription>
          <CardAction>
            <Button
              onClick={() => {
                setSubject("");
                setError("");
                setOpen(true);
              }}
              className="max-sm:h-11"
              aria-label="Aussendung anlegen"
            >
              <Plus className="h-4 w-4" />
              <span>Aussendung<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Betreff</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Empfänger</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Zugestellt</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.length === 0 && (
              <TableEmpty
                colSpan={4}
                icon={Mail}
                title="Noch keine Aussendung"
                description="Leg die erste an und schick sie dir als Testmail."
                compact={false}
              />
            )}
            {campaigns.map((c) => (
              <TableRow key={c.id} className="cursor-pointer max-sm:h-11" onClick={() => router.push(`/newsletter/${c.id}`)}>
                <TableCell className="max-w-0 w-full whitespace-normal">
                  <Link
                    href={`/newsletter/${c.id}`}
                    className="font-medium text-foreground hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.subject}
                  </Link>
                  <div className="text-xs text-muted-foreground">{c.dateLabel}</div>
                  {c.status !== "DRAFT" && (
                    <div className="text-xs text-muted-foreground tabular-nums sm:hidden">
                      {c.recipients} Empfänger · {c.delivered} zugestellt
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {c.status === "DRAFT" ? "–" : c.recipients}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {c.status === "DRAFT" ? "–" : (
                    <>
                      {c.delivered}
                      <span className="ml-1 text-xs text-muted-foreground">{percent(c.delivered, c.sent)}</span>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-1.5">
                    {c.hasError && <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-label="Fehler beim Versand" />}
                    <Badge variant={campaignBadge(c.status)} className="font-normal">
                      {c.status === "SENDING" ? `${c.statusLabel} · ${c.progress} %` : c.statusLabel}
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
            <DialogTitle>Aussendung anlegen</DialogTitle>
            <DialogDescription>Den Inhalt baust du danach im Editor zusammen.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (subject.trim()) void create();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nl-new-subject">Betreff</Label>
              <Input
                id="nl-new-subject"
                value={subject}
                maxLength={150}
                placeholder="z. B. Saisonstart am 1. Mai"
                onChange={(e) => setSubject(e.target.value)}
                className="max-sm:h-11"
              />
            </div>
            {error && <Notice tone="danger" compact title={error} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving} className="max-sm:h-11">
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving || !subject.trim()} className="min-w-24 max-sm:h-11">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Anlegen"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
