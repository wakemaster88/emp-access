import { useId } from "react";
import { awardFace, awardShape, type AwardIcon, type AwardShape } from "@/lib/awards";
import { TIER_LABEL, type GamiTier } from "@/lib/gamification";
import type { AwardBadgeData } from "@/lib/rider-app";

/**
 * Abzeichen eines Awards als SVG. Die Form zeigt die Reihe (Sechseck = Starts,
 * Kreis = Besuchstage, Stern = Specials, Kranz = Treue), das Metall die
 * Seltenheit: Silver trägt einen Stern, Gold drei, Legendary Krone und
 * Regenbogen-Siegel. Gesperrt ist alles grau mit Schloss.
 *
 * Die Metallflächen sind Kegelverläufe aus schmalen Keilen. Sie stehen einmal
 * je Seite in `AwardBadgeDefs` und werden hier nur verwiesen.
 */

interface Tone {
  conic: string[];
  ink: [string, string];
  lin: string[];
  glow: string;
}

// Kegelverlauf rund um das Abzeichen: Start oben, im Uhrzeigersinn. Hellster
// Punkt oben links, zweites Glanzlicht unten rechts.
const TIERS: Record<GamiTier, Tone> = {
  BRONZE: { conic: ["#f1b57e", "#c9803f", "#7a3f17", "#f6c595", "#b76e35", "#693510", "#c47c3e", "#ffe6cc", "#f1b57e"], ink: ["#fff0e0", "#eaa56a"], glow: "#d08a4c", lin: ["#ffd9b0", "#d08a4c", "#8a4a1c"] },
  SILVER: { conic: ["#eef2f5", "#b4c0c9", "#6f7d87", "#f4f7f9", "#a9b6c0", "#5f6d77", "#b9c4cc", "#ffffff", "#eef2f5"], ink: ["#ffffff", "#c3ced6"], glow: "#c9d3da", lin: ["#ffffff", "#c9d3da", "#7d8b94"] },
  GOLD: { conic: ["#ffe27a", "#f6b91c", "#a8660a", "#ffe894", "#e9a713", "#8f5206", "#f0b01a", "#fffbe0", "#ffe27a"], ink: ["#fff8cc", "#fbbf24"], glow: "#fbbf24", lin: ["#fff4b8", "#fbbf24", "#a8640c"] },
  LEGENDARY: { conic: ["#fde68a", "#fbbf24", "#fb7185", "#f0abfc", "#a78bfa", "#60a5fa", "#7fd6db", "#fffbe0", "#fde68a"], ink: ["#fffbe6", "#fcd34d"], glow: "#f472b6", lin: ["#7fd6db", "#fbbf24", "#f472b6", "#a78bfa"] },
};
const LOCK: Tone & { face: [string, string] } = {
  conic: ["#3d4d50", "#2c393b", "#1a2325", "#415356", "#2a3638", "#172022", "#2b383a", "#4d6064", "#3d4d50"],
  ink: ["#6b8083", "#52666a"],
  face: ["#1c2729", "#121a1c"],
  lin: ["#3b4b4e", "#2a3638", "#1d2729"],
  glow: "#000000",
};
const FACE: [string, string] = ["#22919a", "#0a3438"];

const f1 = (n: number) => n.toFixed(1);
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) =>
  "#" + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");

const WEDGES = 72;

function conicWedges(stops: string[]) {
  const pt = (a: number) => `${f1(60 + 95 * Math.cos(a))} ${f1(60 + 95 * Math.sin(a))}`;
  return Array.from({ length: WEDGES }, (_, i) => {
    const pos = (i / WEDGES) * (stops.length - 1);
    const k = Math.floor(pos);
    const fill = mix(stops[k], stops[Math.min(k + 1, stops.length - 1)], pos - k);
    const a0 = (i / WEDGES) * 2 * Math.PI - Math.PI / 2;
    // Etwas überlappen, damit zwischen den Keilen keine Haarlinie bleibt.
    const a1 = ((i + 1.4) / WEDGES) * 2 * Math.PI - Math.PI / 2;
    return <path key={i} d={`M60 60L${pt(a0)}L${pt(a1)}Z`} fill={fill} />;
  });
}

const conicId = (tier: GamiTier | "LOCK") => `rd-cn-${tier.toLowerCase()}`;

/** Metallflächen aller Abzeichen, einmal je Seite (steht im Layout der Kunden-App). */
export function AwardBadgeDefs() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        {(Object.keys(TIERS) as GamiTier[]).map((t) => (
          <g key={t} id={conicId(t)}>{conicWedges(TIERS[t].conic)}</g>
        ))}
        <g id={conicId("LOCK")}>{conicWedges(LOCK.conic)}</g>
      </defs>
    </svg>
  );
}

const poly = (r: number, n: number, rot = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = (Math.PI / 180) * ((360 / n) * i + rot);
    return `${f1(60 + r * Math.cos(a))},${f1(60 + r * Math.sin(a))}`;
  }).join(" ");
const starPts = (ro: number, ri: number, n: number) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? ri : ro;
    const a = (Math.PI / n) * i - Math.PI / 2;
    return `${f1(60 + r * Math.cos(a))},${f1(60 + r * Math.sin(a))}`;
  }).join(" ");
const star5 = (cx: number, cy: number, r: number) =>
  "M" +
  Array.from({ length: 10 }, (_, i) => {
    const rr = i % 2 ? r * 0.46 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${f1(cx + rr * Math.cos(a))} ${f1(cy + rr * Math.sin(a))}`;
  }).join("L") +
  "Z";

type Part = "outer" | "bevel" | "face" | "ring";

// Maße je Form: Radien der vier Ringe, Oberkante (rt), Bahn der Sterne (rs),
// Unterkante der Fläche (fb) und Maßstab des Aufdrucks (k).
const GEO: Record<AwardShape, { r: Record<Part, number>; rt: number; rs: number; fb: number; k: number }> = {
  hex: { r: { outer: 56, bevel: 49.5, face: 43.5, ring: 39.5 }, rt: 55, rs: 49, fb: 97, k: 1 },
  circle: { r: { outer: 55, bevel: 48.5, face: 43, ring: 39.5 }, rt: 54, rs: 54, fb: 101, k: 1 },
  star: { r: { outer: 58, bevel: 45, face: 39.5, ring: 36 }, rt: 56, rs: 49.5, fb: 98, k: 0.92 },
  crest: { r: { outer: 46, bevel: 40.5, face: 35.5, ring: 32.5 }, rt: 45, rs: 45, fb: 94, k: 0.84 },
};

function shapeEl(shape: AwardShape, part: Part) {
  const r = GEO[shape].r[part];
  if (shape === "hex") return <polygon points={poly(r, 6)} />;
  if (shape === "star" && part === "outer") return <polygon points={starPts(58, 49, 8)} strokeLinejoin="round" />;
  return <circle cx="60" cy="60" r={r} />;
}

const DISPLAY = { fontFamily: "var(--font-barlow-condensed), var(--font-inter), sans-serif", fontStyle: "italic", fontWeight: 800 } as const;
const LABEL = { fontFamily: "var(--font-inter), system-ui, sans-serif", fontWeight: 800 } as const;

function Icon({ name, ink, mark }: { name: AwardIcon; ink: string; mark?: string }) {
  const stroke = { fill: "none", stroke: ink, strokeWidth: 4.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "sun") {
    // Sonnenaufgang über spiegelglattem Wasser
    const rays = [-150, -120, -90, -60, -30]
      .map((d) => {
        const a = (d * Math.PI) / 180;
        return `M${f1(60 + 23 * Math.cos(a))} ${f1(67 + 23 * Math.sin(a))}L${f1(60 + 29 * Math.cos(a))} ${f1(67 + 29 * Math.sin(a))}`;
      })
      .join("");
    return (
      <>
        <path d="M43 67A17 17 0 0 1 77 67Z" fill={ink} />
        <path {...stroke} d={`${rays}M35 76H85M43 85H77`} />
      </>
    );
  }
  if (name === "flame") {
    return (
      <>
        <path d="M60 31C72 44 80 54 78 68C77 80 69 88 60 88C51 88 43 81 43 69C43 60 48 55 52 48C54 55 57 58 60 59C62 51 62 41 60 31Z" fill={ink} />
        <path d="M60 65C66 70 67 76 65 80C64 83 62 84 60 84C57 84 54 82 54 78C54 73 58 71 60 65Z" fill="#0e474c" />
      </>
    );
  }
  if (name === "snow") {
    let d = "";
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3 - Math.PI / 2;
      const x = (r: number, o = 0) => f1(60 + r * Math.cos(a + o));
      const y = (r: number, o = 0) => f1(60 + r * Math.sin(a + o));
      d += `M60 60L${x(27)} ${y(27)}M${x(17)} ${y(17)}L${x(25, 0.33)} ${y(25, 0.33)}M${x(17)} ${y(17)}L${x(25, -0.33)} ${y(25, -0.33)}`;
    }
    return <path {...stroke} strokeWidth={3.8} d={d} />;
  }
  return (
    <>
      <rect x="39.5" y="31" width="4.6" height="59" rx="2.3" fill={ink} />
      <path d="M46 34C56 28 65 40 82 32V60C65 68 56 56 46 62Z" fill={ink} />
      {mark && (
        <text x="63" y="56" textAnchor="middle" fontSize="25" fill="#0e474c" style={DISPLAY}>
          {mark}
        </text>
      )}
    </>
  );
}

function Laurel({ fill }: { fill: string }) {
  const leaves = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      for (const k of [-1, 1]) {
        const deg = 28 + i * 21 + (k > 0 ? 7 : 0);
        const a = (deg * Math.PI) / 180;
        const r = 53 + k * 2.5;
        const x = 60 + side * Math.sin(a) * r;
        const y = 60 + Math.cos(a) * r;
        const tx = side * Math.cos(a);
        const ty = -Math.sin(a);
        const rot = (Math.atan2(-tx, ty) * 180) / Math.PI + side * k * 22;
        leaves.push(
          <ellipse
            key={`${side}-${i}-${k}`}
            cx={f1(x)}
            cy={f1(y)}
            rx="3.6"
            ry="8.5"
            transform={`rotate(${rot.toFixed(0)} ${f1(x)} ${f1(y)})`}
            fill={fill}
            stroke="rgba(0,0,0,.25)"
            strokeWidth=".6"
          />,
        );
      }
    }
  }
  return <>{leaves}</>;
}

const stops = (colors: string[]) =>
  colors.map((c, i) => <stop key={i} offset={`${((i / (colors.length - 1)) * 100).toFixed(0)}%`} stopColor={c} />);

export interface AwardBadgeProps {
  award: AwardBadgeData;
  locked?: boolean;
  /** Breite in Pixeln; die Höhe folgt (144 zu 154). */
  size?: number;
  /** Banderole mit der Seltenheit unter dem Abzeichen (Freischalt-Moment). */
  ribbon?: boolean;
  /** Gesperrt, aber ohne Schloss-Symbol (kleine Darstellung). */
  noLock?: boolean;
  /** Lichtreflex, der einmal über das Abzeichen wandert (Freischalt-Moment). */
  sweep?: boolean;
  className?: string;
}

export function AwardBadge({ award, locked = false, size = 96, ribbon = false, noLock = false, sweep = false, className }: AwardBadgeProps) {
  const id = "ab" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const shape = awardShape(award.metric);
  const face = awardFace(award);
  const tone = locked ? LOCK : TIERS[award.tier];
  const geo = GEO[shape];
  const legendary = award.tier === "LEGENDARY";
  const live = !locked;
  const ink = `url(#${id}i)`;
  const metal = `url(#${id}m)`;
  const cn = `#${conicId(locked ? "LOCK" : award.tier)}`;

  const len = (face.big ?? "").length;
  const fontSize = len <= 1 ? 54 : len === 2 ? 47 : len === 3 ? 38 : 31;
  const waveFill = locked ? "rgba(160,179,181,.07)" : "rgba(127,214,219,.2)";
  const wave = (y: number, x0: number) => (
    <path d={`M${x0} ${y}q10 -6 20 0t20 0t20 0t20 0t20 0t20 0V130H${x0}Z`} fill={waveFill} />
  );

  // Schmuck oben auf dem Rand
  const starFill = locked ? metal : ink;
  const starStroke = locked ? "#111a1c" : legendary ? "#7a3d06" : award.tier === "GOLD" ? "#7a4a05" : "#3d4a52";
  const st = (x: number, y: number, r: number, key: string) => (
    <path key={key} d={star5(x, y, r)} fill={starFill} stroke={starStroke} strokeWidth="1.3" strokeLinejoin="round" />
  );
  const sx = geo.rs * Math.sin((25 * Math.PI) / 180);
  const sy = 60 - geo.rs * Math.cos((25 * Math.PI) / 180);
  const top = 60 - geo.rt;
  const by = top + 10;
  const crown = `url(#${id}k)`;

  return (
    <svg
      className={className ? `rd-badge ${className}` : "rd-badge"}
      width={size}
      height={Math.round((size * 154) / 144)}
      viewBox="-12 -20 144 154"
      role="img"
      aria-label={`${award.name}, ${TIER_LABEL[award.tier]}${locked ? ", noch gesperrt" : ""}`}
    >
      <defs>
        <linearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="1">{stops(tone.lin)}</linearGradient>
        <linearGradient id={`${id}i`} x1="0" y1="0" x2="0" y2="1">{stops(tone.ink)}</linearGradient>
        <linearGradient id={`${id}k`} x1="0" y1="0" x2="0" y2="1">{stops(locked ? tone.lin : ["#fff8cc", "#fbbf24", "#d18a0a"])}</linearGradient>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="1">{stops(["#7fd6db", "#fde68a", "#f472b6", "#a78bfa"])}</linearGradient>
        <radialGradient id={`${id}f`} cx="0.36" cy="0.26" r="0.95">{stops(locked ? LOCK.face : FACE)}</radialGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.4" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity={locked ? 0.05 : 0.3} />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}co`}>{shapeEl(shape, "outer")}</clipPath>
        <clipPath id={`${id}cb`}>{shapeEl(shape, "bevel")}</clipPath>
        <clipPath id={`${id}cf`}>{shapeEl(shape, "face")}</clipPath>
        {ribbon && live && (
          <>
            <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="0">
              {stops(legendary ? ["#fbbf24", "#fef3c7", "#fbbf24"] : [tone.lin[1], tone.lin[0], tone.lin[1]])}
            </linearGradient>
            <linearGradient id={`${id}rd`} x1="0" y1="0" x2="0" y2="1">
              {stops(legendary ? ["#d99a0c", "#9a6a05"] : [tone.lin[1], tone.lin[2]])}
            </linearGradient>
          </>
        )}
        {live && (
          <filter id={`${id}g`} x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation={legendary ? 5.5 : 3} result="b" />
            <feFlood floodColor={tone.glow} floodOpacity={legendary ? 0.7 : 0.35} />
            <feComposite in2="b" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <g filter={live ? `url(#${id}g)` : undefined}>
        {legendary && (
          <polygon
            points={starPts(geo.rt + 12, geo.rt + 5, 22)}
            fill={live ? `url(#${id}h)` : metal}
            stroke={`rgba(0,0,0,${live ? 0.35 : 0.2})`}
            strokeWidth="1"
            strokeLinejoin="round"
            opacity={live ? 1 : 0.75}
          />
        )}
        {shape === "crest" && <Laurel fill={metal} />}
        <g clipPath={`url(#${id}co)`}><use href={cn} /></g>
        <g fill="none" stroke={`rgba(0,0,0,${locked ? 0.15 : 0.38})`} strokeWidth="1.2">{shapeEl(shape, "outer")}</g>
        {shape === "hex" && (
          <path
            d={Array.from({ length: 6 }, (_, i) => {
              const a = (Math.PI / 180) * (60 * i - 90);
              return `M${f1(60 + 56 * Math.cos(a))} ${f1(60 + 56 * Math.sin(a))}L${f1(60 + 49.5 * Math.cos(a))} ${f1(60 + 49.5 * Math.sin(a))}`;
            }).join("")}
            stroke={`rgba(255,255,255,${locked ? 0.12 : 0.45})`}
            strokeWidth=".9"
          />
        )}
        <g clipPath={`url(#${id}cb)`}><use href={cn} transform="rotate(180 60 60)" /></g>
        <g fill="none" stroke={`rgba(255,255,255,${locked ? 0.1 : 0.35})`} strokeWidth=".8">{shapeEl(shape, "bevel")}</g>
        <g fill={`url(#${id}f)`} stroke={`rgba(0,0,0,${locked ? 0.25 : 0.55})`} strokeWidth="1.6">{shapeEl(shape, "face")}</g>
        <g clipPath={`url(#${id}cf)`}>
          {wave(geo.fb - 12, -10)}
          {wave(geo.fb - 5, -20)}
        </g>
        <g fill="none" stroke={ink} strokeWidth="1.1" opacity={locked ? 0.35 : 0.5}>{shapeEl(shape, "ring")}</g>
        <g transform={`translate(60 60) scale(${geo.k}) translate(-60 -60)`}>
          {face.icon ? (
            <Icon name={face.icon} ink={ink} mark={face.mark} />
          ) : (
            <>
              <text x="60" y="69.2" textAnchor="middle" fontSize={fontSize} letterSpacing="-0.5" fill={locked ? "#0b1214" : "#052326"} opacity={locked ? 0.5 : 0.75} style={DISPLAY}>
                {face.big}
              </text>
              <text x="60" y="67" textAnchor="middle" fontSize={fontSize} letterSpacing="-0.5" fill={ink} style={DISPLAY}>
                {face.big}
              </text>
              <text x="60" y="83" textAnchor="middle" fontSize="8.5" letterSpacing="1.7" fill={ink} style={LABEL}>
                {face.sub}
              </text>
            </>
          )}
        </g>
        <rect x="-20" y="-20" width="160" height="160" fill={`url(#${id}s)`} clipPath={`url(#${id}co)`} />
        {sweep && live && (
          <g clipPath={`url(#${id}co)`}>
            <rect className="rd-badge-sweep" x="-70" y="-30" width="46" height="180" fill="#ffffff" opacity="0.55" transform="skewX(-20)" />
          </g>
        )}
        {award.tier === "SILVER" && st(60, top + 2, 8.5, "s")}
        {award.tier === "GOLD" && [st(60 - sx, sy, 6.5, "l"), st(60 + sx, sy, 6.5, "r"), st(60, top + 2, 9, "m")]}
        {legendary && (
          <>
            {st(60 - sx - 3, sy + 3, 5.5, "l")}
            {st(60 + sx + 3, sy + 3, 5.5, "r")}
            <path
              d={`M45 ${by}L41.5 ${by - 16}L51.5 ${by - 9}L60 ${by - 21}L68.5 ${by - 9}L78.5 ${by - 16}L75 ${by}Z`}
              fill={crown}
              stroke={starStroke}
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <circle cx="41.5" cy={by - 16} r="2.3" fill={crown} stroke={starStroke} strokeWidth="1" />
            <circle cx="60" cy={by - 21} r="2.6" fill={crown} stroke={starStroke} strokeWidth="1" />
            <circle cx="78.5" cy={by - 16} r="2.3" fill={crown} stroke={starStroke} strokeWidth="1" />
            {live && (
              <>
                <circle cx="60" cy={by - 5} r="2.6" fill="#f472b6" />
                <circle cx="50.5" cy={by - 3.5} r="1.9" fill="#7fd6db" />
                <circle cx="69.5" cy={by - 3.5} r="1.9" fill="#a78bfa" />
              </>
            )}
          </>
        )}
      </g>
      {legendary && live &&
        [[8, 22, 4.5], [112, 30, 3.5], [114, 92, 4.5], [5, 88, 3.2]].map(([x, y, r], i) => (
          <path
            key={i}
            className="rd-badge-spark"
            style={{ animationDelay: `${i * 0.45}s` }}
            d={`M${x} ${y - r * 2}Q${x} ${y} ${x + r * 2} ${y}Q${x} ${y} ${x} ${y + r * 2}Q${x} ${y} ${x - r * 2} ${y}Q${x} ${y} ${x} ${y - r * 2}Z`}
            fill="#fffbe6"
          />
        ))}
      {ribbon && live && (
        <g>
          <path d="M9 106H26V124H9L14.5 115Z M111 106H94V124H111L105.5 115Z" fill={`url(#${id}rd)`} />
          <path d="M20 108L26 103V108Z M100 108L94 103V108Z" fill="rgba(0,0,0,.55)" />
          <path d="M20 103H100V121H20Z" fill={`url(#${id}r)`} stroke="rgba(0,0,0,.28)" strokeWidth=".8" />
          <text x="60" y="115.3" textAnchor="middle" fontSize="8" letterSpacing="1.9" fill="#1f1503" style={LABEL}>
            {TIER_LABEL[award.tier].toUpperCase()}
          </text>
        </g>
      )}
      {locked && !noLock && (
        <g transform="translate(99 101)">
          <circle r="13" fill="#0b1214" stroke="#36555a" strokeWidth="2" />
          <rect x="-6" y="-2" width="12" height="9" rx="2" fill="#a0b3b5" />
          <path d="M-3.5 -2V-5A3.5 3.5 0 0 1 3.5 -5V-2" fill="none" stroke="#a0b3b5" strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}
