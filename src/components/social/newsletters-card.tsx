"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Mail, Plus, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { campaignBadge } from "@/components/newsletter/campaign-ui";
import type { SocialCampaignDetail } from "@/lib/social/load";
import { CAMPAIGN_STATUS_LABEL } from "@/lib/newsletter/rules";
import { percent } from "@/lib/newsletter/stats";
import { nf } from "./social-ui";

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Newsletter-Aussendungen der Kampagne: neu anlegen, vorhandene zuordnen, lösen. */
export function NewslettersCard({
  campaignId,
  newsletters,
  unlinked,
}: {
  campaignId: number;
  newsletters: SocialCampaignDetail["newsletters"];
  unlinked: SocialCampaignDetail["unlinked"];
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function call(body: Record<string, unknown>, key: string): Promise<{ id?: number } | null> {
    setBusy(key);
    setError("");
    try {
      const res = await fetch(`/api/social/campaigns/${campaignId}/newsletters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt");
        return null;
      }
      return json;
    } catch {
      setError("Netzwerkfehler");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-primary" />
          Newsletter ({newsletters.length})
        </CardTitle>
        <CardDescription>Links zur Website bekommen beim Versand den Kampagnen-Zusatz.</CardDescription>
        <CardAction>
          <Button
            className="max-sm:h-11"
            disabled={busy !== null}
            aria-label="Aussendung für diese Kampagne anlegen"
            onClick={async () => {
              const r = await call({ action: "create" }, "create");
              if (r?.id) router.push(`/newsletter/${r.id}`);
            }}
          >
            {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span>Aussendung<span className="sr-only"> anlegen</span></span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {newsletters.length === 0 ? (
          <EmptyState icon={Mail} size="sm" title="Noch kein Newsletter" description="Leg eine Aussendung an oder ordne eine vorhandene zu." />
        ) : (
          <ul className="space-y-2">
            {newsletters.map((n) => (
              <li key={n.id} className="glass-tile flex items-center gap-1 pr-1">
                <Link href={`/newsletter/${n.id}`} className="press flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-[inherit] px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{n.subject}</span>
                    <Badge variant={campaignBadge(n.status)} className="shrink-0 font-normal">
                      {CAMPAIGN_STATUS_LABEL[n.status] ?? n.status}
                    </Badge>
                  </span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {n.status === "DRAFT"
                      ? `Entwurf vom ${dateLabel(n.at)}`
                      : `${dateLabel(n.at)} · ${nf.format(n.recipients)} Empfänger · ${nf.format(n.delivered)} zugestellt (${percent(n.delivered, n.sent)})`}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 sm:size-9"
                  aria-label={`„${n.subject}“ von der Kampagne lösen`}
                  title="Von der Kampagne lösen"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (await call({ action: "unlink", newsletterId: n.id }, `unlink-${n.id}`)) router.refresh();
                  }}
                >
                  {busy === `unlink-${n.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {unlinked.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <NativeSelect aria-label="Vorhandene Aussendung" value={pick} onChange={(e) => setPick(e.target.value)} containerClassName="sm:flex-1" className="max-sm:h-11">
              <option value="">Vorhandene Aussendung wählen …</option>
              {unlinked.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.subject} ({CAMPAIGN_STATUS_LABEL[u.status] ?? u.status})
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              className="max-sm:h-11"
              disabled={!pick || busy !== null}
              onClick={async () => {
                if (await call({ action: "link", newsletterId: Number(pick) }, "link")) {
                  setPick("");
                  router.refresh();
                }
              }}
            >
              {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Zuordnen
            </Button>
          </div>
        )}
        {error && <Notice tone="danger" compact title={error} />}
      </CardContent>
    </Card>
  );
}
