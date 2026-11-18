import { CupSoda, IceCreamCone, Package, ShoppingBag, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { IconChip } from "@/components/ui/icon-chip";
import { cn } from "@/lib/utils";

/** Platzhalter-Symbol je Kategorie, wenn ein Artikel kein Foto hat. */
export function categoryIcon(category: string): LucideIcon {
  const c = category.toLowerCase();
  if (c.includes("getränk") || c.includes("drink")) return CupSoda;
  if (c.includes("eis")) return IceCreamCone;
  if (c.includes("speise") || c.includes("essen") || c.includes("küche")) return UtensilsCrossed;
  if (c.includes("shop")) return ShoppingBag;
  return Package;
}

/** Artikelbild in Listen (Foto oder Kategorie-Symbol), quadratisch. */
export function ArticleThumb({
  image,
  name,
  category,
  size = "md",
  className,
}: {
  image: string | null;
  name: string;
  category: string;
  size?: "md" | "lg";
  className?: string;
}) {
  const box = size === "lg" ? "size-12" : "size-10";
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Data-URL oder Open-Food-Facts-Adresse
      <img
        src={image}
        alt={name}
        loading="lazy"
        className={cn(box, "shrink-0 rounded-lg border border-border bg-white object-contain", className)}
      />
    );
  }
  return <IconChip icon={categoryIcon(category)} size="lg" className={cn(box, "shrink-0", className)} />;
}
