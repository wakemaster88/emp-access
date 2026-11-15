import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Barlow_Condensed } from "next/font/google";
import { loadRankingDisplay } from "@/lib/ranking-display";
import { AutoRefresh } from "@/components/rider/auto-refresh";
import "../../app/rider.css";
import "./board.css";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  style: ["italic"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const dynamic = "force-dynamic";
export const viewport: Viewport = { themeColor: "#0b1214" };
export const metadata: Metadata = { title: "Rangliste", robots: { index: false, follow: false } };

/** Rangliste für einen Bildschirm am See: Saison und laufende Top-X-Challenges. */
export default async function RankingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadRankingDisplay(token);
  if (!data) notFound();

  return (
    <div className={`rd-root ${display.variable}`}>
      <AutoRefresh seconds={300} />
      <div className="rb-page">
        <header className="rb-head">
          <div className="rd-hero-line">{data.accountName}</div>
          <h1 className="rd-display rb-title">Rangliste</h1>
        </header>
        <div className="rb-boards" data-count={data.boards.length}>
          {data.boards.map((b) => (
            <section key={b.title} className="rd-card rb-board">
              <div>
                <h2 className="rd-display rb-board-title">{b.title}</h2>
                <div className="rd-muted">{b.subtitle}</div>
              </div>
              {b.rows.length === 0 ? (
                <div className="rd-muted rb-empty">
                  {b.participants === 0 ? "Noch kein Start gezählt." : "Noch niemand mit Spitznamen dabei."}
                </div>
              ) : (
                <div className="rd-rank rb-rank">
                  {b.rows.map((r, i) => (
                    <div key={i} className={r.rank === 1 ? "rd-me" : undefined}>
                      <span className="rd-pos">{r.rank}</span>
                      <span className="rd-grow">{r.name}</span>
                      <span>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="rd-muted rb-foot">{b.participants} Fahrer dabei · gezählt werden {b.unit}</div>
            </section>
          ))}
        </div>
        <footer className="rd-muted rb-note">
          Du willst hier stehen? Öffne die App, trag im Profil einen Spitznamen ein und stimme der Rangliste zu.
        </footer>
      </div>
    </div>
  );
}
