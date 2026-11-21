"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { MAX_SKILL_USES } from "@/lib/rider-skill-rules";

/** Skill zur Auswahl in den Belohnungs-Dialogen. */
export interface SkillChoice {
  id: number;
  name: string;
}

export interface SkillRewardState {
  /** "" = ohne Skill */
  skillId: string;
  skillUses: string;
  skillValidDays: string;
}

export const EMPTY_SKILL_REWARD: SkillRewardState = { skillId: "", skillUses: "5", skillValidDays: "365" };

export function skillRewardState(row: { skillId: number | null; skillUses: number; skillValidDays: number | null }): SkillRewardState {
  if (row.skillId == null) return EMPTY_SKILL_REWARD;
  return {
    skillId: String(row.skillId),
    skillUses: String(row.skillUses),
    skillValidDays: row.skillValidDays != null ? String(row.skillValidDays) : "",
  };
}

/** Für den Request: Skill-ID, Nutzungen und Gültigkeit oder ohne Skill. */
export function skillRewardBody(s: SkillRewardState) {
  if (!s.skillId) return { skillId: null, skillUses: 1, skillValidDays: null };
  const uses = Number(s.skillUses);
  const days = s.skillValidDays.trim() ? Number(s.skillValidDays) : null;
  return { skillId: Number(s.skillId), skillUses: Number.isInteger(uses) ? uses : 1, skillValidDays: days };
}

export function skillRewardValid(s: SkillRewardState): boolean {
  if (!s.skillId) return true;
  const uses = Number(s.skillUses);
  const days = s.skillValidDays.trim() ? Number(s.skillValidDays) : null;
  return Number.isInteger(uses) && uses >= 1 && uses <= MAX_SKILL_USES && (days == null || (Number.isInteger(days) && days >= 1 && days <= 730));
}

/**
 * Schalter „Skill freischalten“ mit Auswahl, Nutzungen und Gültigkeit. Gleich
 * in den Dialogen für Awards, Challenges und Feiertage.
 */
export function SkillRewardField({
  id, value, onChange, skills, disabled = false,
}: {
  id: string;
  disabled?: boolean;
  value: SkillRewardState;
  onChange: (v: SkillRewardState) => void;
  skills: SkillChoice[];
}) {
  const on = value.skillId !== "";
  if (skills.length === 0 && !on) return null;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${id}-on`}>Skill freischalten</Label>
        <Switch
          id={`${id}-on`}
          checked={on}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v ? { ...value, skillId: String(skills[0]?.id ?? "") } : { ...value, skillId: "" })}
        />
      </div>
      {on && (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-[1fr_7rem_8rem]">
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label htmlFor={`${id}-skill`}>Skill</Label>
            <NativeSelect id={`${id}-skill`} disabled={disabled} value={value.skillId} onChange={(e) => onChange({ ...value, skillId: e.target.value })}>
              {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-uses`}>Nutzungen</Label>
            <Input id={`${id}-uses`} type="number" min={1} max={MAX_SKILL_USES} inputMode="numeric" disabled={disabled} value={value.skillUses} onChange={(e) => onChange({ ...value, skillUses: e.target.value })} className="max-sm:h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-days`}>Gültig (Tage)</Label>
            <Input id={`${id}-days`} type="number" min={1} inputMode="numeric" disabled={disabled} value={value.skillValidDays} placeholder="unbegrenzt" onChange={(e) => onChange({ ...value, skillValidDays: e.target.value })} className="max-sm:h-11" />
          </div>
        </div>
      )}
    </>
  );
}
