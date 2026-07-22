"use client";

import { cn } from "@/lib/utils";

interface TileFrameProps {
  title?: string;
  showTitleBar?: boolean;
  focused?: boolean;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}

export function TileFrame({
  title,
  showTitleBar = true,
  focused,
  badge,
  actions,
  className,
  children,
  onClick,
}: TileFrameProps) {
  return (
    <section
      onClick={onClick}
      className={cn(
        "group relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-tile ring-1 ring-border transition",
        "hover:ring-border-strong",
        focused && "ring-2 ring-focus shadow-lg shadow-focus/10",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {showTitleBar && title && (
        <header className="flex items-center justify-between gap-2 border-b border-border bg-tile-accent/40 px-3 py-2 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[clamp(0.85rem,1.05vw,1.1rem)] font-medium tracking-wide text-foreground/90">
              {title}
            </h3>
            {badge}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-1 opacity-70 group-hover:opacity-100">
              {actions}
            </div>
          )}
        </header>
      )}
      <div className="relative flex-1 min-h-0">{children}</div>
    </section>
  );
}
