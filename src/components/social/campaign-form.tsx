"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { slugify } from "@/lib/social/rules";

export interface CampaignFormValue {
  name: string;
  slug: string;
  /** Kürzel von Hand geändert: dann folgt es nicht mehr dem Namen. */
  slugTouched: boolean;
  startsOn: string;
  endsOn: string;
  landingUrl: string;
  hashtags: string;
  description: string;
}

export function emptyCampaignForm(landingUrl: string | null): CampaignFormValue {
  return { name: "", slug: "", slugTouched: false, startsOn: "", endsOn: "", landingUrl: landingUrl ?? "", hashtags: "", description: "" };
}

export function campaignFormBody(v: CampaignFormValue) {
  return {
    name: v.name.trim(),
    slug: v.slug.trim(),
    startsOn: v.startsOn || null,
    endsOn: v.endsOn || null,
    landingUrl: v.landingUrl.trim(),
    hashtags: v.hashtags.trim(),
    description: v.description.trim(),
  };
}

/** Felder einer Kampagne. `full` zeigt auch Hashtags und Beschreibung. */
export function CampaignFields({
  value,
  onChange,
  full,
  idPrefix,
}: {
  value: CampaignFormValue;
  onChange: (v: CampaignFormValue) => void;
  full: boolean;
  idPrefix: string;
}) {
  const set = (patch: Partial<CampaignFormValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          maxLength={120}
          placeholder="z. B. Nikolausfahren 2026"
          onChange={(e) => set({ name: e.target.value, ...(value.slugTouched ? {} : { slug: slugify(e.target.value) }) })}
          className="max-sm:h-11"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${idPrefix}-from`}>Von</Label>
          <Input
            id={`${idPrefix}-from`}
            type="date"
            value={value.startsOn}
            onChange={(e) => set({ startsOn: e.target.value, ...(!value.endsOn && e.target.value ? { endsOn: e.target.value } : {}) })}
            className="max-sm:h-11"
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${idPrefix}-to`}>Bis</Label>
          <Input id={`${idPrefix}-to`} type="date" value={value.endsOn} min={value.startsOn || undefined} onChange={(e) => set({ endsOn: e.target.value })} className="max-sm:h-11" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-landing`}>Ziel-Link</Label>
        <Input
          id={`${idPrefix}-landing`}
          value={value.landingUrl}
          inputMode="url"
          spellCheck={false}
          placeholder="https://www.tuttenbrocksee.com/…"
          onChange={(e) => set({ landingUrl: e.target.value })}
          className="max-sm:h-11"
        />
        <p className="text-xs text-muted-foreground">Seite, auf die Beiträge und Newsletter führen, z. B. die Buchung.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-slug`}>Kürzel für die Statistik</Label>
        <Input
          id={`${idPrefix}-slug`}
          value={value.slug}
          maxLength={60}
          spellCheck={false}
          autoCapitalize="none"
          placeholder="nikolaus-2026"
          onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"), slugTouched: true })}
          className="font-mono max-sm:h-11"
        />
        <p className="text-xs text-muted-foreground">Steht in den Links als utm_campaign. Google Analytics zeigt die Besuche darunter.</p>
      </div>
      {full && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-tags`}>Hashtags</Label>
            <Input
              id={`${idPrefix}-tags`}
              value={value.hashtags}
              maxLength={500}
              spellCheck={false}
              placeholder="#tuttenbrocksee #wakeboard"
              onChange={(e) => set({ hashtags: e.target.value })}
              className="max-sm:h-11"
            />
            <p className="text-xs text-muted-foreground">Kommen beim Kopieren unter jeden Beitragstext, wenn sie dort fehlen.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-desc`}>Beschreibung</Label>
            <Textarea
              id={`${idPrefix}-desc`}
              value={value.description}
              maxLength={5000}
              rows={4}
              placeholder="Anlass, Ziel, Botschaft, Absprachen"
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}
