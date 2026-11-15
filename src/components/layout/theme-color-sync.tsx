"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/** Farbe der Statusleiste bzw. Browserleiste: entspricht `--background` hell und dunkel. */
const THEME_COLOR = { light: "#f9f9fb", dark: "#111215" } as const;

/**
 * Hält `<meta name="theme-color">` beim gewählten Farbschema. Das Root-Layout
 * setzt die Farbe nach dem System; wer im Kopfbalken Hell oder Dunkel fest
 * wählt, bekäme sonst in der installierten App (Android, iOS-Safari) eine
 * Statusleiste in der falschen Farbe. Nur in der Hülle des Dashboards, damit
 * Kunden-App, Kiosk und Monitore ihre eigenen Farben behalten.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    const previous = metas.map((m) => m.content);
    for (const m of metas) m.content = THEME_COLOR[resolvedTheme];
    return () => {
      metas.forEach((m, i) => {
        m.content = previous[i];
      });
    };
  }, [resolvedTheme]);

  return null;
}
