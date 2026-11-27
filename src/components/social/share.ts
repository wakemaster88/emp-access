"use client";

/** Text in die Zwischenablage. false, wenn der Browser es nicht erlaubt. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Kann dieses Gerät Dateien teilen (Handy)? Nur im Browser aufrufen. */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "probe.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
}

/**
 * Beitrag über das Teilen-Menü des Handys weitergeben (z. B. an Instagram):
 * Der Text liegt danach in der Zwischenablage, denn Instagram übernimmt nur
 * die Bilder. Ohne ladbare Bilder wird nur der Text geteilt.
 */
export async function sharePost(text: string, media: string[]): Promise<"shared" | "cancelled" | "failed"> {
  await copyText(text);
  const files: File[] = [];
  for (const [i, url] of media.entries()) {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) continue;
      const blob = await res.blob();
      const type = blob.type || "image/jpeg";
      const ext = type.includes("png") ? "png" : type.includes("mp4") ? "mp4" : type.includes("quicktime") ? "mov" : "jpg";
      files.push(new File([blob], `beitrag-${i + 1}.${ext}`, { type }));
    } catch {
      // Bild nicht ladbar: ohne dieses Bild weiter.
    }
  }
  try {
    if (files.length && navigator.canShare?.({ files })) {
      await navigator.share({ files, text });
    } else {
      await navigator.share({ text });
    }
    return "shared";
  } catch (err) {
    return err instanceof DOMException && err.name === "AbortError" ? "cancelled" : "failed";
  }
}
