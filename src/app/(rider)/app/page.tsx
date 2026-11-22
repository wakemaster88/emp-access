import { AwardBadge, AwardBadgeDefs } from "@/components/rider/award-badge";
import { GiftIcon } from "@/components/rider/award-parts";
import { RiderMailLink } from "@/components/rider/rider-mail-link";
import { RiderPasskeyLogin } from "@/components/rider/rider-auth";
import { AWARD_DEFAULTS, BEACH_AWARD_DEFAULTS, type AwardDefault } from "@/lib/awards";
import { RIDER_LOCATION } from "@/lib/rider-shop";
import { RiderLinkExpired } from "@/components/rider/rider-link-expired";
import { Suspense } from "react";
import { riderAppKind } from "@/lib/rider-base";

const PIN_ICON = (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

const icon = (d: string) => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/** Drei Abzeichen aus der Award-Vorlage als Schaufenster: Einstieg, Ziel, Fernziel. */
const pick = (list: AwardDefault[], keys: string[]) =>
  keys.map((key) => list.find((a) => a.key === key)).filter((a): a is AwardDefault => !!a);
const SHOWCASE = pick(AWARD_DEFAULTS, ["first-splash", "tuttenbrock-legend", "lake-local"]);
const BEACH_SHOWCASE = pick(BEACH_AWARD_DEFAULTS, ["beach-first-dip", "beach-endless-summer", "beach-sandcastle-king"]);

const PERKS = [
  {
    icon: icon("M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1zM14 5v2M14 11v2M14 17v2"),
    title: "Dein Abo immer dabei",
    text: "Laufzeit, Besuchstage und Starts auf einen Blick.",
  },
  {
    icon: icon("M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"),
    title: `${AWARD_DEFAULTS.length} Awards zum Freischalten`,
    text: "Vom ersten Start bis zur Legende am Lift.",
  },
  {
    icon: <GiftIcon size={20} />,
    title: "Zu jedem Award ein Gutschein",
    text: "Drinks, Eis und Pommes bis zur Private Session.",
  },
];

/** Dasselbe für den Beach Pass (/beach): Strandtage statt Starts, Beach-Awards im Schaufenster. */
const BEACH_PERKS = [
  { ...PERKS[0], text: "Laufzeit und Strandtage auf einen Blick." },
  { ...PERKS[1], title: `${BEACH_AWARD_DEFAULTS.length} Awards zum Freischalten`, text: "Vom ersten Strandtag bis zur Beach Legend." },
  { ...PERKS[2], text: "Eis, Drinks und Pommes am Strand." },
];

/** Einstieg in die Kunden-App: Anmeldung per E-Mail-Link, mit oder ohne Abo. Ride Pass unter /app, Beach Pass unter /beach. */
export default async function RiderLoginPage() {
  const beach = (await riderAppKind()) === "beach";
  const perks = beach ? BEACH_PERKS : PERKS;
  return (
    <main className="rd-main">
      <AwardBadgeDefs />
      <div className="rd-hero rd-wl-hero">
        <svg aria-hidden="true" viewBox="0 0 390 120" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M-10 52 C 60 20, 120 84, 195 52 S 330 20, 400 52" opacity="0.55" />
          <path d="M-10 74 C 60 42, 120 106, 195 74 S 330 42, 400 74" opacity="0.3" />
          <path d="M-10 96 C 60 64, 120 128, 195 96 S 330 64, 400 96" opacity="0.15" />
        </svg>
        <div className="rd-hero-body">
          <div className="rd-hero-line rd-loc">{PIN_ICON}{RIDER_LOCATION}</div>
          <h1 className="rd-display rd-wl-title">{beach ? "Beach Pass" : "Deine Saison"}</h1>
          <p className="rd-wl-lead">
            {beach ? "Strandtage sammeln, Awards holen, Gutscheine einlösen." : "Starts sammeln, Awards holen, Gutscheine einlösen."}
          </p>
        </div>
      </div>

      <div className="rd-wl-badges" aria-label="Beispiele für Awards">
        {(beach ? BEACH_SHOWCASE : SHOWCASE).map((a) => (
          <AwardBadge key={a.key} award={{ name: a.name, tier: a.tier, metric: a.metric, threshold: a.threshold, key: a.key }} size={a.tier === "LEGENDARY" ? 112 : 84} />
        ))}
      </div>

      <Suspense fallback={null}>
        <RiderLinkExpired />
      </Suspense>

      <ul className="rd-wl-perks">
        {perks.map((p) => (
          <li key={p.title}>
            <span className="rd-wl-icon">{p.icon}</span>
            <span>
              <b>{p.title}</b>
              <span className="rd-muted">{p.text}</span>
            </span>
          </li>
        ))}
      </ul>

      <RiderMailLink />

      <RiderPasskeyLogin />

      <p className="rd-muted rd-wl-foot">
        Noch kein Abo? Die App geht auch ohne. An der Kasse bekommst du deinen persönlichen Link auch als QR-Code.
      </p>
    </main>
  );
}
