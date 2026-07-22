import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
  {
    variants: {
      variant: {
        default: "bg-tile-accent text-foreground/70 ring-1 ring-border",
        success: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
        warn: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
        danger: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
        info: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ variant, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
