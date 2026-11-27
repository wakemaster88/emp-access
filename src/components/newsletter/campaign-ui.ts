import type { NewsletterBlock } from "@/lib/newsletter/blocks";
import type { CampaignStatus, SubscriberStatus } from "@/lib/newsletter/rules";

type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

export function campaignBadge(status: CampaignStatus): BadgeTone {
  switch (status) {
    case "SENT":
      return "success";
    case "SENDING":
    case "QUEUED":
      return "info";
    case "CANCELLED":
      return "warning";
    default:
      return "neutral";
  }
}

export function subscriberBadge(status: SubscriberStatus): BadgeTone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "PENDING":
      return "warning";
    case "BOUNCED":
    case "COMPLAINED":
      return "danger";
    default:
      return "neutral";
  }
}

/** Gerüst einer neuen Aussendung: Überschrift, Text und, mit Website, eine Taste. */
export function starterBlocks(subject: string, websiteUrl: string | null): NewsletterBlock[] {
  const site = websiteUrl && /^https:\/\/\S+$/.test(websiteUrl) ? websiteUrl : null;
  return [
    { type: "heading", text: subject || "Überschrift" },
    {
      type: "text",
      text: `Hallo,\n\nhier steht dein Text. **Fett** geht mit zwei Sternchen, Links mit [Linktext](${site ?? "https://www.beispiel.de"}).`,
    },
    ...(site ? [{ type: "button" as const, label: "Mehr erfahren", url: site }] : []),
  ];
}
