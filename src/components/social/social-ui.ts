import { Facebook, Instagram, MapPinned, Megaphone, MessageCircle, Music2, Youtube, type LucideIcon } from "lucide-react";
import type { CampaignPhase, PostStatus, SocialChannel } from "@/lib/social/rules";

type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

export const CHANNEL_ICON: Record<SocialChannel, LucideIcon> = {
  INSTAGRAM: Instagram,
  FACEBOOK: Facebook,
  TIKTOK: Music2,
  YOUTUBE: Youtube,
  WHATSAPP: MessageCircle,
  GOOGLE: MapPinned,
  OTHER: Megaphone,
};

export function postBadge(status: PostStatus, overdue: boolean): BadgeTone {
  if (status === "PUBLISHED") return "success";
  if (overdue) return "danger";
  if (status === "READY") return "info";
  if (status === "DRAFT") return "warning";
  return "neutral";
}

export function phaseBadge(phase: CampaignPhase): BadgeTone {
  switch (phase) {
    case "RUNNING":
      return "success";
    case "PLANNED":
      return "info";
    default:
      return "neutral";
  }
}

const TZ = "Europe/Berlin";

/** „Sa 6.12., 10:00“ (Berlin). */
export function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const day = d.toLocaleDateString("de-DE", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric" });
  const time = d.toLocaleTimeString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** „18:00“ (Berlin). */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

/** Kalendertag (Berlin) für Gruppen in der Liste: „Heute“, „Morgen“ oder „Sa 6.12.“. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const ymd = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TZ });
  const d = new Date(iso);
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (ymd(d) === today) return "Heute";
  if (ymd(d) === tomorrow) return "Morgen";
  return d.toLocaleDateString("de-DE", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric" });
}

export const nf = new Intl.NumberFormat("de-DE");

/** Erste Zeile des Textes, gekürzt. */
export function excerpt(text: string, max = 90): string {
  const line = text.trim().split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
