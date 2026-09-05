import type { NextConfig } from "next";

/**
 * Sicherheits-Header fuer alle Antworten.
 *
 * Die CSP ist bewusst nicht streng bei Skripten und Styles (Next.js und
 * Tailwind brauchen Inline-Anteile), verbietet aber das Einbetten in fremde
 * Seiten (Clickjacking auf Tueroeffner-Knoepfe), fremde Formularziele,
 * Plugins und `base`-Umbiegungen. Kamerastreams und Webradio laufen teils
 * ueber http im LAN, deshalb sind http-Quellen bei Medien/Bildern erlaubt.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: http:",
      "media-src 'self' data: blob: https: http:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss: http: ws:",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs"],
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Service Worker immer frisch holen, sonst bleiben Kiosks wochenlang auf
      // einem alten Stand; Splash-Bilder sind dagegen unveraenderlich.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      { source: "/splash/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
