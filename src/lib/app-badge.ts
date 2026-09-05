/**
 * Zaehler auf dem App-Icon (Badging API): iOS 16.4+ fuer installierte
 * Web-Apps, Android/Chrome, Desktop-Chrome und Edge. Ohne Unterstuetzung
 * passiert nichts.
 */
type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function setAppBadge(count: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  if (count > 0) nav.setAppBadge?.(Math.min(count, 99)).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}
