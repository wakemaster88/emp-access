/**
 * Prüft ein neues Profilbild der Kunden-App (und Fotos für Foto-Challenges, siehe `checkChallengePhoto`) mit der KI von xAI (derselbe
 * Schlüssel `XAI_API_KEY` wie die Sprachausgabe in `audio.ts`): Ist darauf
 * genau eine echte Person mit erkennbarem Gesicht zu sehen?
 *
 * Fällt die KI aus oder fehlt der Schlüssel, wird das Bild angenommen. Ein
 * Ausfall beim Anbieter soll Kunden nicht das Profilbild verwehren; der Fehler
 * landet im Log.
 *
 * Das Kassenfoto (`Ticket.profileImage`) prüft das hier nicht, das macht die
 * Kasse selbst.
 */

export type PhotoVerdict =
  | "ok"
  | "no_person"
  | "multiple_people"
  | "face_not_visible"
  | "not_a_photo"
  | "inappropriate";

export type PhotoCheckResult = { ok: true; checked: boolean } | { ok: false; verdict: PhotoVerdict; error: string };

const RESPONSES_ENDPOINT = "https://api.x.ai/v1/responses";
const MODELS_ENDPOINT = "https://api.x.ai/v1/language-models";
/** Fällt die Modellsuche aus, gilt das Modell aus der xAI-Doku zur Bilderkennung. */
const FALLBACK_MODEL = "grok-4.7";
const TIMEOUT_MS = 15_000;

const VERDICTS: readonly PhotoVerdict[] = ["ok", "no_person", "multiple_people", "face_not_visible", "not_a_photo", "inappropriate"];

/** Sätze für den Kunden, Du-Form wie in der übrigen App. */
export const PHOTO_VERDICT_MESSAGES: Record<Exclude<PhotoVerdict, "ok">, string> = {
  no_person: "Auf dem Bild ist keine Person zu sehen. Bitte wähl ein Foto, auf dem dein Gesicht gut zu erkennen ist.",
  multiple_people: "Auf dem Bild sind mehrere Personen. Bitte wähl ein Foto, auf dem nur eine Person zu sehen ist.",
  face_not_visible: "Das Gesicht ist nicht gut zu erkennen. Bitte wähl ein helles, scharfes Foto, auf dem das Gesicht von vorn zu sehen ist.",
  not_a_photo: "Das ist kein Foto einer Person. Bitte wähl ein echtes Foto, auf dem das Gesicht gut zu erkennen ist.",
  inappropriate: "Dieses Bild können wir nicht als Profilbild nehmen. Bitte wähl ein anderes Foto.",
};

const PROMPT = `Du prüfst Profilbilder für die App einer Wakeboard-Anlage. Ein geeignetes Profilbild ist ein echtes Foto, auf dem genau eine Person zu sehen ist und deren Gesicht gut erkennbar ist (von vorn oder leicht seitlich, nicht zu klein, nicht zu dunkel, nicht stark verschwommen). Helm, Mütze, Brille oder Sonnenbrille sind in Ordnung, solange das Gesicht größtenteils zu sehen ist. Kinder sind in Ordnung. Personen weit im Hintergrund zählen nicht mit.

Antworte nur mit JSON in der Form {"verdict": "..."} und genau einem dieser Werte:
- "ok": geeignet
- "no_person": kein Mensch zu sehen (z. B. Landschaft, Tier, Gegenstand, Logo, Text)
- "multiple_people": zwei oder mehr Personen im Vordergrund, unklar wer gemeint ist
- "face_not_visible": eine Person, aber Gesicht verdeckt, abgewandt, zu klein, zu dunkel oder unscharf
- "not_a_photo": Zeichnung, Comic, Avatar, Emoji, KI-Kunstbild, Screenshot oder Foto eines Bildschirms
- "inappropriate": Nacktheit, Gewalt, Waffen, Drogen, beleidigende Gesten oder Symbole`;

let cachedModel: { id: string; until: number } | null = null;

/**
 * Welches Modell Bilder versteht, ändert sich beim Anbieter öfter. Daher
 * fragt der Server einmal am Tag die Modellliste ab und nimmt ein Modell, das
 * Bilder annimmt (schnelle Modelle ohne langes Nachdenken bevorzugt).
 * `XAI_VISION_MODEL` legt das Modell fest.
 */
async function visionModel(apiKey: string): Promise<string> {
  const fixed = process.env.XAI_VISION_MODEL?.trim();
  if (fixed) return fixed;
  if (cachedModel && cachedModel.until > Date.now()) return cachedModel.id;
  let id = FALLBACK_MODEL;
  try {
    const res = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { models?: { id?: unknown; input_modalities?: unknown }[] };
      const ids = (data.models ?? [])
        .filter((m) => Array.isArray(m.input_modalities) && m.input_modalities.includes("image") && typeof m.id === "string")
        .map((m) => m.id as string);
      const picked = pickVisionModel(ids);
      if (picked) id = picked;
    }
  } catch {
    // bleibt beim Ersatzmodell
  }
  cachedModel = { id, until: Date.now() + 24 * 60 * 60 * 1000 };
  return id;
}

/** Aus Modellen mit Bildeingang: schnell und ohne Nachdenken zuerst. */
export function pickVisionModel(ids: string[]): string | null {
  if (ids.length === 0) return null;
  const score = (id: string) => {
    const s = id.toLowerCase();
    return (s.includes("fast") ? 2 : 0) + (s.includes("non-reasoning") ? 1 : 0) - (s.includes("image") || s.includes("imagine") ? 10 : 0);
  };
  return [...ids].sort((a, b) => score(b) - score(a))[0];
}

/** Liest das Urteil aus der Antwort der KI; unbekanntes gilt als nicht lesbar. */
export function parseVerdict(text: string): PhotoVerdict | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (match) {
    try {
      const value = (JSON.parse(match[0]) as { verdict?: unknown }).verdict;
      if (typeof value === "string" && (VERDICTS as readonly string[]).includes(value)) return value as PhotoVerdict;
    } catch {
      // unten weiter
    }
  }
  const bare = text.trim().replace(/^["']|["']$/g, "");
  return (VERDICTS as readonly string[]).includes(bare) ? (bare as PhotoVerdict) : null;
}

/** Text aus einer Antwort der Responses-API (`output_text` oder `output[].content[]`). */
function responseText(data: unknown): string {
  const d = data as { output_text?: unknown; output?: { content?: { type?: unknown; text?: unknown }[] }[] };
  if (typeof d.output_text === "string") return d.output_text;
  const parts: string[] = [];
  for (const item of d.output ?? []) {
    for (const c of item.content ?? []) {
      if (typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

/**
 * Fragt die KI mit Bild und Text; liefert die Antwort oder null, wenn die KI
 * ausfällt (Fehler landet im Log unter `[tag]`).
 */
async function askVision(apiKey: string, dataUrl: string, prompt: string, tag: string): Promise<string | null> {
  try {
    const model = await visionModel(apiKey);
    const res = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        // Bilder sollen beim Anbieter nicht liegen bleiben (laut Doku sonst auch Fehler möglich).
        store: false,
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: dataUrl, detail: "low" },
              { type: "input_text", text: prompt },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Modell gibt es nicht mehr: beim nächsten Mal neu suchen.
      if (res.status === 404 || /model/i.test(detail)) cachedModel = null;
      console.error(`[${tag}] KI-Prüfung fehlgeschlagen (${res.status}, ${model}): ${detail.slice(0, 200)}`);
      return null;
    }
    return responseText(await res.json());
  } catch (e) {
    console.error(`[${tag}] KI-Prüfung nicht erreichbar:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Prüft eine Data-URL (JPEG oder PNG). */
export async function checkProfilePhoto(dataUrl: string): Promise<PhotoCheckResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: true, checked: false };
  if (!/^data:image\/(jpeg|png);base64,/i.test(dataUrl)) {
    return { ok: false, verdict: "not_a_photo", error: "Bitte ein Foto als JPG oder PNG wählen." };
  }
  const text = await askVision(apiKey, dataUrl, PROMPT, "profilbild");
  if (text == null) return { ok: true, checked: false };
  const verdict = parseVerdict(text);
  if (!verdict) {
    console.error("[profilbild] KI-Antwort ohne lesbares Urteil");
    return { ok: true, checked: false };
  }
  if (verdict === "ok") return { ok: true, checked: true };
  return { ok: false, verdict, error: PHOTO_VERDICT_MESSAGES[verdict] };
}

const CHALLENGE_PROMPT = `Du prüfst Fotos, die Kunden einer Wakeboard-Anlage für einen Foto-Wettbewerb in der App hochladen. Alle Kunden der App sehen die Fotos, auch Kinder. Erlaubt ist fast alles: Fahrer, Tricks, Wasser, Landschaft, Freunde, Gruppen, Tiere, Essen, auch Kinder in Badekleidung beim Sport. Nicht erlaubt ist: Nacktheit oder sexuelle Darstellung, Gewalt oder Verletzungen, Waffen, Drogen, beleidigende Gesten, Symbole oder Texte, Werbung, gut lesbare persönliche Daten (Ausweis, Kennzeichen in Großaufnahme, Adresse).

Antworte nur mit JSON in der Form {"verdict": "..."} und genau einem dieser Werte:
- "ok": darf in den Wettbewerb
- "inappropriate": nicht erlaubt (siehe oben)`;

export const CHALLENGE_PHOTO_REJECTED = "Dieses Foto können wir für die Challenge nicht nehmen. Bitte wähl ein anderes.";

/**
 * Prüft ein Foto für eine Foto-Challenge: alles außer Unpassendem ist
 * erlaubt. Fällt die KI aus, wird das Foto angenommen (das Personal kann es
 * in der Verwaltung ausblenden).
 */
export async function checkChallengePhoto(dataUrl: string): Promise<{ ok: true; checked: boolean } | { ok: false; error: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: true, checked: false };
  if (!/^data:image\/(jpeg|png);base64,/i.test(dataUrl)) return { ok: false, error: "Bitte ein Foto als JPG oder PNG wählen." };
  const text = await askVision(apiKey, dataUrl, CHALLENGE_PROMPT, "challenge-foto");
  if (text == null) return { ok: true, checked: false };
  const verdict = parseVerdict(text);
  if (verdict === "ok") return { ok: true, checked: true };
  if (verdict === "inappropriate") return { ok: false, error: CHALLENGE_PHOTO_REJECTED };
  console.error("[challenge-foto] KI-Antwort ohne lesbares Urteil");
  return { ok: true, checked: false };
}
