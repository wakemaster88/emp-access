import Image from "next/image";

/** Vollbild-Platzhalter, solange die Sitzung geladen wird. */
export function ShellLoading() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background safe-area-padding">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/20" />
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary motion-reduce:animate-none" />
        <Image src="/logo.png" alt="" width={28} height={28} className="dark:hidden" priority />
        <Image src="/logo-dark.png" alt="" width={28} height={28} className="hidden dark:block" priority />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Verbinde …</p>
    </div>
  );
}
