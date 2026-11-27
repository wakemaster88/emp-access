"use client";

import { useState } from "react";
import { Check, Copy, Link2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { CHANNEL_LABEL, type SocialChannel } from "@/lib/social/rules";
import { newsletterLink, socialLink } from "@/lib/social/utm";
import { CHANNEL_ICON } from "./social-ui";
import { copyText } from "./share";

function CopyLink({ url, label }: { url: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 shrink-0 sm:size-9"
      aria-label={`Link für ${label} kopieren`}
      title="Kopieren"
      onClick={() =>
        void copyText(url).then((ok) => {
          if (!ok) return;
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        })
      }
    >
      {done ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

/**
 * Ziel-Link mit Kampagnen-Zusatz je Kanal zum Kopieren (Bio, Story, Facebook):
 * für die Kanäle der Beiträge, ohne Beiträge Instagram und Facebook.
 */
export function LinksCard({
  landingUrl,
  slug,
  usedChannels,
}: {
  landingUrl: string | null;
  slug: string;
  usedChannels: SocialChannel[];
}) {
  const channels: SocialChannel[] = usedChannels.length ? usedChannels : ["INSTAGRAM", "FACEBOOK"];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 shrink-0 text-primary" />
          Links mit Kampagnen-Zusatz
        </CardTitle>
        <CardDescription>So ordnet Google Analytics die Besuche dieser Kampagne und dem Kanal zu.</CardDescription>
      </CardHeader>
      <CardContent>
        {!landingUrl ? (
          <EmptyState icon={Link2} size="sm" title="Kein Ziel-Link" description="Trag unter „Bearbeiten“ einen Ziel-Link ein, dann stehen hier die Links je Kanal." />
        ) : (
          <ul className="space-y-2">
            {channels.map((c) => {
              const url = socialLink(landingUrl, slug, c);
              return (
                <li key={c} className="glass-tile flex items-center gap-3 py-1.5 pr-1 pl-3">
                  <IconChip icon={CHANNEL_ICON[c]} tone="primary" size="sm" label={CHANNEL_LABEL[c]} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-foreground">{CHANNEL_LABEL[c]}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground" title={url}>{url.replace(/^https:\/\//, "")}</span>
                  </span>
                  <CopyLink url={url} label={CHANNEL_LABEL[c]} />
                </li>
              );
            })}
            <li className="glass-tile flex items-center gap-3 py-1.5 pr-1 pl-3">
              <IconChip icon={Mail} tone="primary" size="sm" label="Newsletter" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-foreground">Newsletter</span>
                <span className="block truncate font-mono text-xs text-muted-foreground" title={newsletterLink(landingUrl, slug)}>
                  {newsletterLink(landingUrl, slug).replace(/^https:\/\//, "")}
                </span>
              </span>
              <CopyLink url={newsletterLink(landingUrl, slug)} label="Newsletter" />
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
