/**
 * iOS zeigt beim Start einer Home-Bildschirm-App ein `apple-touch-startup-image`,
 * das exakt zur Bildschirmgroesse passen muss – sonst bleibt der Start weiss.
 * Die Liste hier speist `scripts/gen-pwa-assets.ts` (erzeugt die PNGs unter
 * public/splash) und `appleStartupImages()` (die <link>-Tags im Layout).
 */
export interface SplashDevice {
  /** Dateiname ohne Endung und Orientierung. */
  name: string;
  /** CSS-Punkte im Hochformat. */
  width: number;
  height: number;
  /** device-pixel-ratio */
  ratio: number;
  /** iPads werden auch quer gestartet (Kiosk, Monitor). */
  landscape: boolean;
}

export const SPLASH_DEVICES: SplashDevice[] = [
  // iPhone
  { name: "iphone-440x956-3x", width: 440, height: 956, ratio: 3, landscape: false }, // 16 Pro Max
  { name: "iphone-430x932-3x", width: 430, height: 932, ratio: 3, landscape: false }, // 14/15 Pro Max, 15/16 Plus
  { name: "iphone-428x926-3x", width: 428, height: 926, ratio: 3, landscape: false }, // 12/13 Pro Max, 14 Plus
  { name: "iphone-414x896-3x", width: 414, height: 896, ratio: 3, landscape: false }, // XS Max, 11 Pro Max
  { name: "iphone-414x896-2x", width: 414, height: 896, ratio: 2, landscape: false }, // XR, 11
  { name: "iphone-402x874-3x", width: 402, height: 874, ratio: 3, landscape: false }, // 16 Pro
  { name: "iphone-393x852-3x", width: 393, height: 852, ratio: 3, landscape: false }, // 14 Pro, 15, 16
  { name: "iphone-390x844-3x", width: 390, height: 844, ratio: 3, landscape: false }, // 12, 13, 14
  { name: "iphone-375x812-3x", width: 375, height: 812, ratio: 3, landscape: false }, // X, XS, 12/13 mini
  { name: "iphone-375x667-2x", width: 375, height: 667, ratio: 2, landscape: false }, // SE 2/3, 8
  // iPad (Hoch- und Querformat)
  { name: "ipad-1032x1376-2x", width: 1032, height: 1376, ratio: 2, landscape: true }, // Pro 13 (M4)
  { name: "ipad-1024x1366-2x", width: 1024, height: 1366, ratio: 2, landscape: true }, // Pro 12.9
  { name: "ipad-834x1210-2x", width: 834, height: 1210, ratio: 2, landscape: true }, // Pro 11 (M4)
  { name: "ipad-834x1194-2x", width: 834, height: 1194, ratio: 2, landscape: true }, // Pro 11, Air 11
  { name: "ipad-820x1180-2x", width: 820, height: 1180, ratio: 2, landscape: true }, // iPad 10/11, Air 10.9
  { name: "ipad-810x1080-2x", width: 810, height: 1080, ratio: 2, landscape: true }, // iPad 7–9 (10.2)
  { name: "ipad-768x1024-2x", width: 768, height: 1024, ratio: 2, landscape: true }, // 9.7, mini 5
  { name: "ipad-744x1133-2x", width: 744, height: 1133, ratio: 2, landscape: true }, // mini 6/7
];

/** Hintergrund der Splash-Screens – gleich `background_color` im Manifest. */
export const SPLASH_BACKGROUND = "#0f172a";

export function splashFile(device: SplashDevice, orientation: "portrait" | "landscape"): string {
  return `/splash/${device.name}-${orientation}.png`;
}

function mediaFor(device: SplashDevice, orientation: "portrait" | "landscape"): string {
  return (
    `(device-width: ${device.width}px) and (device-height: ${device.height}px) ` +
    `and (-webkit-device-pixel-ratio: ${device.ratio}) and (orientation: ${orientation})`
  );
}

/** Eintraege fuer `metadata.appleWebApp.startupImage`. */
export function appleStartupImages(): { url: string; media: string }[] {
  const out: { url: string; media: string }[] = [];
  for (const d of SPLASH_DEVICES) {
    out.push({ url: splashFile(d, "portrait"), media: mediaFor(d, "portrait") });
    if (d.landscape) out.push({ url: splashFile(d, "landscape"), media: mediaFor(d, "landscape") });
  }
  return out;
}
