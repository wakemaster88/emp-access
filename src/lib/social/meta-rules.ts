import { postCopyText, type SocialChannel, type SocialFormat } from "./rules";

/**
 * Regeln fürs Posten über Meta, ohne Server-Abhängigkeiten (auch im Browser
 * nutzbar, z. B. um „Jetzt posten“ zu sperren und den Grund zu zeigen).
 */

export const META_CHANNELS: readonly SocialChannel[] = ["INSTAGRAM", "FACEBOOK"];

export const IG_CAPTION_LIMIT = 2200;
export const IG_HASHTAG_LIMIT = 30;
export const IG_CAROUSEL_MAX = 10;

export interface PublishablePost {
  channel: SocialChannel;
  format: SocialFormat;
  text: string;
  media: string[];
  link: string | null;
  /** Instagram-Container aus einem früheren Versuch (Video in Verarbeitung). */
  containerId: string | null;
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v)(\?|#|$)/i.test(url);
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

/**
 * Text für den Kanal: Hashtags der Kampagne anhängen. Bei Facebook-Bildern den
 * Link in den Text, weil Bildbeiträge kein eigenes Link-Feld haben (Textbeiträge
 * bekommen ihn als Link-Vorschau).
 */
export function metaCaption(post: { channel: SocialChannel; text: string; link: string | null; media: string[] }, hashtags: string | null): string {
  let text = postCopyText(post.text, hashtags);
  if (post.channel === "FACEBOOK" && post.media.length > 0 && post.link && !text.includes(post.link)) {
    text = text ? `${text}\n\n${post.link}` : post.link;
  }
  return text;
}

/** Was spricht gegen automatisches Posten? null = geht. */
export function publishProblem(post: PublishablePost, target: { igUserId: string | null } | null): string | null {
  if (!META_CHANNELS.includes(post.channel)) return "Automatisch posten geht nur auf Instagram und Facebook";
  if (!target) return "Meta ist nicht verbunden";
  const videos = post.media.filter(isVideoUrl).length;
  if (post.channel === "INSTAGRAM") {
    if (!target.igUserId) return "Mit der Facebook-Seite ist kein Instagram-Profil verknüpft";
    if (post.media.length === 0) return "Instagram braucht mindestens ein Bild oder Video";
    if (post.text.length > IG_CAPTION_LIMIT) return `Instagram erlaubt höchstens ${IG_CAPTION_LIMIT} Zeichen`;
    if (countHashtags(post.text) > IG_HASHTAG_LIMIT) return `Instagram erlaubt höchstens ${IG_HASHTAG_LIMIT} Hashtags`;
    if (post.format === "STORY" && post.media.length !== 1) return "Eine Story braucht genau ein Bild oder Video";
    if (post.format === "REEL" && (post.media.length !== 1 || videos !== 1)) return "Ein Reel braucht genau ein Video (.mp4 oder .mov)";
    if (post.format === "CAROUSEL" && (post.media.length < 2 || post.media.length > IG_CAROUSEL_MAX)) return `Ein Karussell braucht 2 bis ${IG_CAROUSEL_MAX} Bilder`;
    if (post.media.length > IG_CAROUSEL_MAX) return `Instagram erlaubt höchstens ${IG_CAROUSEL_MAX} Bilder je Beitrag`;
    return null;
  }
  if (post.format === "STORY") return "Facebook-Storys bitte von Hand posten";
  if (!post.text.trim() && post.media.length === 0 && !post.link) return "Der Beitrag braucht Text, Bild oder Link";
  if (videos > 0 && post.media.length > 1) return "Facebook: ein Video nur allein posten, ohne weitere Bilder";
  return null;
}
