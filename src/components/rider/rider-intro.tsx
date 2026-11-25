"use client";

import { useEffect } from "react";

/** Einmal je App-Sitzung (Tab/geöffnete App) zeigen. */
const SEEN_KEY = "rd-intro-seen";
/** Läuft die Animation, solange das Attribut fehlt; danach bleibt sie aus (auch beim Familienwechsel). */
const SKIP_ATTR = "data-rd-intro";
/**
 * Nach dem Ende der Animation (rider.css): 1,3 s, kurz 0,65 s (`.rd-intro-short`,
 * Schalter in den Einstellungen); danach blendet das Attribut sie ganz aus.
 */
const DONE_MS = 1400;
const DONE_MS_SHORT = 700;

/*
 * Läuft vor dem ersten Zeichnen: war die Animation in dieser Sitzung schon
 * zu sehen, blendet ein Attribut am <html> sie per CSS sofort aus, damit
 * Tab-Wechsel und Neuladen nicht jedes Mal warten.
 */
const EARLY = `try{var d=document.documentElement;if(sessionStorage.getItem("${SEEN_KEY}"))d.setAttribute("${SKIP_ATTR}","skip");else sessionStorage.setItem("${SEEN_KEY}","1")}catch(e){}`;

/**
 * Logo-Animation beim Start der Kunden-App: „RIDE“ und „PASS“ fahren
 * schräg von beiden Seiten ein, ein gelber Streifen und Speed-Linien ziehen
 * durch, der Balken unter dem Logo läuft voll, dann
 * gibt die Fläche die App frei. Gut eine Sekunde, blockiert keine Eingabe
 * (die Seite darunter ist schon fertig) und entfällt bei „Bewegung
 * reduzieren“.
 */
export function RiderIntro({ word = "Ride", short = false }: { word?: string; short?: boolean }) {
  useEffect(() => {
    const id = setTimeout(() => document.documentElement.setAttribute(SKIP_ATTR, "skip"), short ? DONE_MS_SHORT : DONE_MS);
    return () => clearTimeout(id);
  }, [short]);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: EARLY }} />
      <div className={short ? "rd-intro rd-intro-short" : "rd-intro"} aria-hidden="true">
        <span className="rd-intro-stripe" />
        <svg className="rd-intro-lines" viewBox="0 0 390 120" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M-10 52 C 60 20, 120 84, 195 52 S 330 20, 400 52" opacity="0.55" />
          <path d="M-10 74 C 60 42, 120 106, 195 74 S 330 42, 400 74" opacity="0.3" />
          <path d="M-10 96 C 60 64, 120 128, 195 96 S 330 64, 400 96" opacity="0.15" />
        </svg>
        <span className="rd-intro-mark">
          <span className="rd-intro-word">{word}</span>
          <span className="rd-intro-word rd-intro-word-accent">Pass</span>
          <span className="rd-intro-bar" />
        </span>
      </div>
    </>
  );
}
