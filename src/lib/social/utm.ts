/**
 * Links mit Kampagnen-Zusatz (utm_source, utm_medium, utm_campaign), damit
 * Google Analytics der Website Besuche aus Beiträgen und Newslettern einer
 * Kampagne zuordnet. Ohne Datenbank; darf in Client-Bausteine.
 */
import type { NewsletterBlock } from "@/lib/newsletter/blocks";
import { CHANNEL_SOURCE, type SocialChannel } from "./rules";

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
}

/** Hat der Link schon einen utm_-Parameter? Dann bleibt er, wie er ist. */
export function hasUtm(url: URL): boolean {
  for (const key of url.searchParams.keys()) if (key.toLowerCase().startsWith("utm_")) return true;
  return false;
}

/**
 * Hängt utm_source, utm_medium und utm_campaign an einen https-Link. Links
 * mit vorhandenem utm_ und alles, was kein https ist, bleiben unverändert.
 */
export function withUtm(link: string, p: UtmParams): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  if (url.protocol !== "https:" || hasUtm(url)) return link;
  url.searchParams.set("utm_source", p.source);
  url.searchParams.set("utm_medium", p.medium);
  url.searchParams.set("utm_campaign", p.campaign);
  return url.toString();
}

/** Link für einen Beitrag auf einem Kanal. */
export function socialLink(landingUrl: string, slug: string, channel: SocialChannel): string {
  return withUtm(landingUrl, { source: CHANNEL_SOURCE[channel], medium: "social", campaign: slug });
}

/** Link für den Newsletter der Kampagne. */
export function newsletterLink(landingUrl: string, slug: string): string {
  return withUtm(landingUrl, { source: "newsletter", medium: "email", campaign: slug });
}

/** Rechnername ohne „www.“, klein. */
export function hostKey(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Seiten des Newsletters selbst (Bestätigen, Abmelden) bekommen nie einen Zusatz. */
function isNewsletterPage(url: URL): boolean {
  const p = url.pathname.toLowerCase();
  return p === "/nl" || p.startsWith("/nl/") || p.startsWith("/newsletter/abmelden") || p.startsWith("/newsletter/bestaetigen");
}

function tag(link: string, hosts: Set<string>, slug: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  if (url.protocol !== "https:") return link;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!hosts.has(host) || isNewsletterPage(url) || hasUtm(url)) return link;
  return withUtm(link, { source: "newsletter", medium: "email", campaign: slug });
}

const LINK_RE = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g;

/**
 * Bausteine einer Aussendung mit Kampagnen-Zusatz an Links zur eigenen
 * Website (`hosts`, ohne „www.“). Tasten, Bild-Links und [Text](Links) im
 * Fließtext; andere Seiten, Links mit utm_ und /nl/… bleiben unverändert.
 */
export function tagNewsletterBlocks(blocks: NewsletterBlock[], slug: string, hostList: Array<string | null | undefined>): NewsletterBlock[] {
  const hosts = new Set(hostList.filter((h): h is string => !!h));
  if (!slug || hosts.size === 0) return blocks;
  return blocks.map((b) => {
    switch (b.type) {
      case "button":
        return { ...b, url: tag(b.url, hosts, slug) };
      case "image":
        return b.link ? { ...b, link: tag(b.link, hosts, slug) } : b;
      case "text":
        return { ...b, text: b.text.replace(LINK_RE, (_m, label: string, url: string) => `[${label}](${tag(url, hosts, slug)})`) };
      default:
        return b;
    }
  });
}
