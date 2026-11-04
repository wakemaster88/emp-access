/** go2rtc.yaml: ffmpeg-Pfad festlegen (ohne Abhaengigkeiten, damit testbar). */

/** Steht in der yaml schon ein Top-Level-Block `ffmpeg:`? */
export function hasFfmpegBlock(yaml: string): boolean {
  return /^ffmpeg\s*:/m.test(yaml);
}

/** Haengt `ffmpeg: bin: <pfad>` an, falls noch kein ffmpeg-Block existiert. */
export function withFfmpegBin(yaml: string, bin: string): string {
  if (hasFfmpegBlock(yaml)) return yaml;
  const sep = yaml.length === 0 || yaml.endsWith("\n") ? "" : "\n";
  return `${yaml}${sep}\nffmpeg:\n  bin: ${bin}\n`;
}
