import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground/50",
  primary: "bg-primary",
};

interface StatusDotProps {
  tone?: StatusTone;
  /** Pulsierender Ring – für „lebt gerade“ (online, spielt, läuft). */
  pulse?: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
  /** Screenreader-Text, z. B. „online“. */
  label?: string;
}

const SIZE_CLASSES = { xs: "h-1.5 w-1.5", sm: "h-2 w-2", md: "h-2.5 w-2.5" } as const;

/**
 * Kleiner Statuspunkt, überall gleich: grün = online/ok, amber = Achtung,
 * rot = Störung, grau = unbekannt/aus. Ersetzt die vielen handgebauten
 * `h-2 w-2 rounded-full bg-emerald-500`.
 */
export function StatusDot({ tone = "neutral", pulse = false, size = "sm", className, label }: StatusDotProps) {
  return (
    <span className={cn("relative inline-flex shrink-0", SIZE_CLASSES[size], className)} aria-hidden={label ? undefined : true}>
      {pulse && (
        <span
          className={cn("absolute inset-0 rounded-full opacity-60 animate-ping motion-reduce:animate-none", TONE_CLASSES[tone])}
        />
      )}
      <span className={cn("relative inline-flex h-full w-full rounded-full", TONE_CLASSES[tone])} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
