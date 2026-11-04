import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Mehrzeiliges Eingabefeld, gleiche Optik wie `Input` (`glass-field`,
 * Radius 14 px, Fokus in Akzentfarbe). Mindestens 16 px Schrift auf iOS.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "glass-field placeholder:text-muted-foreground flex min-h-20 w-full min-w-0 px-3 py-2 text-base transition-[color,box-shadow,border-color,background-color] outline-none hover:border-foreground/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:bg-glass-strong focus-visible:ring-ring/30 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
