import type { CampaignInput } from "./rules";

/** Eingabe einer Kampagne als Spalten (Kalendertage als UTC-Mitternacht für @db.Date). */
export function campaignData(input: CampaignInput) {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description,
    startsOn: input.startsOn ? new Date(`${input.startsOn}T00:00:00Z`) : null,
    endsOn: input.endsOn ? new Date(`${input.endsOn}T00:00:00Z`) : null,
    landingUrl: input.landingUrl,
    hashtags: input.hashtags,
  };
}
