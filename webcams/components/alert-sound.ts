"use client";

/**
 * Warnton fürs Kontrollzentrum, synthetisiert statt abgespielt.
 *
 * Eine Tondatei müsste irgendwo liegen und ausgeliefert werden; das Dashboard
 * hat dafür bislang kein Verzeichnis. Zwei Sinus-Töne aus der Web-Audio-API
 * kosten nichts, sind immer da und lassen sich exakt dosieren.
 *
 * Browser lassen Ton erst zu, nachdem jemand die Seite angefasst hat. Auf
 * einem Kiosk-Bildschirm passiert das womöglich nie — deshalb wird bei jeder
 * Interaktion entsperrt und der Zustand nach außen sichtbar gemacht, damit
 * das UI darauf hinweisen kann, statt stumm zu bleiben.
 */

let ctx: AudioContext | null = null;
let unlockBound = false;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Hängt sich an die erste Nutzerinteraktion, um den Ton freizuschalten. */
export function armAudioUnlock(): () => void {
  if (typeof window === "undefined" || unlockBound) return () => {};
  unlockBound = true;
  const unlock = () => {
    void audioContext()?.resume().catch(() => {});
  };
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  for (const e of events) window.addEventListener(e, unlock, { passive: true });
  return () => {
    for (const e of events) window.removeEventListener(e, unlock);
    unlockBound = false;
  };
}

/** Ob der Browser den Ton noch blockiert. */
export function audioBlocked(): boolean {
  return ctx !== null && ctx.state === "suspended";
}

function beep(at: number, freq: number, seconds: number): void {
  const ac = ctx;
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // Weiche Flanken, sonst knackt es an den Rändern.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.25, at + 0.015);
  gain.gain.setValueAtTime(0.25, at + seconds - 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/**
 * Kurzer absteigender Doppelton — deutlich genug, um über Hallengeräusch
 * aufzufallen, aber ohne Sirenencharakter.
 */
export function playTailgateTone(): void {
  const ac = audioContext();
  if (!ac) return;
  if (ac.state === "suspended") {
    void ac.resume().catch(() => {});
  }
  const now = ac.currentTime + 0.02;
  beep(now, 988, 0.16);
  beep(now + 0.2, 740, 0.22);
}
