"use client";

/**
 * Symbole fuer Raeume. Gespeichert wird nur der Schluessel (`KeyRoom.icon`);
 * ohne Auswahl wird aus dem Namen geraten (Umkleide → Kleidung, WC → Bad …).
 */

import {
  Bath,
  BedDouble,
  Briefcase,
  Building2,
  Coffee,
  DoorOpen,
  Dumbbell,
  Music,
  Sailboat,
  Shirt,
  Sofa,
  Store,
  TreePalm,
  Users,
  Utensils,
  Warehouse,
  Waves,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const ROOM_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "building", label: "Gebäude", Icon: Building2 },
  { key: "shirt", label: "Umkleide", Icon: Shirt },
  { key: "bath", label: "WC / Dusche", Icon: Bath },
  { key: "utensils", label: "Gastronomie", Icon: Utensils },
  { key: "coffee", label: "Imbiss / Kiosk", Icon: Coffee },
  { key: "store", label: "Shop", Icon: Store },
  { key: "wrench", label: "Technik", Icon: Wrench },
  { key: "briefcase", label: "Büro", Icon: Briefcase },
  { key: "users", label: "Personal", Icon: Users },
  { key: "bed", label: "Zimmer", Icon: BedDouble },
  { key: "sofa", label: "Lounge", Icon: Sofa },
  { key: "warehouse", label: "Halle / Lager", Icon: Warehouse },
  { key: "waves", label: "Wasser", Icon: Waves },
  { key: "sailboat", label: "Verleih", Icon: Sailboat },
  { key: "palm", label: "Insel / Strand", Icon: TreePalm },
  { key: "music", label: "Bühne / Sound", Icon: Music },
  { key: "fitness", label: "Sport", Icon: Dumbbell },
  { key: "door", label: "Eingang", Icon: DoorOpen },
];

export const ROOM_ICON_KEYS = ROOM_ICONS.map((i) => i.key);

const GUESS: [RegExp, string][] = [
  [/umkleide|garderobe/i, "shirt"],
  [/toilette|wc|dusche|bad\b/i, "bath"],
  [/gastro|restaurant|küche|kueche/i, "utensils"],
  [/imbiss|kiosk|caf/i, "coffee"],
  [/shop|laden/i, "store"],
  [/technik/i, "wrench"],
  [/büro|buero|office/i, "briefcase"],
  [/personal|team/i, "users"],
  [/zimmer|apartment/i, "bed"],
  [/lounge|vip/i, "sofa"],
  [/halle|lager/i, "warehouse"],
  [/insel|strand/i, "palm"],
  [/verleih/i, "sailboat"],
];

export function roomIconKey(room: { name: string; icon?: string | null }): string {
  if (room.icon && ROOM_ICON_KEYS.includes(room.icon)) return room.icon;
  return GUESS.find(([re]) => re.test(room.name))?.[1] ?? "building";
}

export function RoomIcon({ room, className }: { room: { name: string; icon?: string | null }; className?: string }) {
  const key = roomIconKey(room);
  const Icon = ROOM_ICONS.find((i) => i.key === key)?.Icon ?? Building2;
  return <Icon className={className} />;
}
