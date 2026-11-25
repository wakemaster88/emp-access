import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptedAudioBlobPath,
  audioBlobDeleteMode,
  audioUploadPath,
  blobPathFromUrl,
  isAllowedAudioUploadPath,
  ttsBlobPath,
} from "./audio-blob-path";

const STORE = "https://example123.public.blob.vercel-storage.com";
const HASH = "a".repeat(64);

test("Upload-Pfad: Mandanten-Präfix, Verzeichnisanteile fallen weg", () => {
  assert.equal(audioUploadPath(7, "Lied.mp3"), "audio/7/Lied.mp3");
  assert.equal(audioUploadPath(7, "../../scan-snapshots/x.jpg"), "audio/7/x.jpg");
  assert.equal(audioUploadPath(7, ".."), "audio/7/datei");
  assert.equal(ttsBlobPath(7, HASH), `audio/tts/7/${HASH}.mp3`);
});

test("Upload-Token: eigener Pfad und blanker Dateiname (alte Tabs), sonst nichts", () => {
  assert.equal(isAllowedAudioUploadPath("audio/7/Lied.mp3", 7), true);
  assert.equal(isAllowedAudioUploadPath("Lied.mp3", 7), true);
  assert.equal(isAllowedAudioUploadPath("audio/8/Lied.mp3", 7), false);
  assert.equal(isAllowedAudioUploadPath("audio/7/sub/Lied.mp3", 7), false);
  assert.equal(isAllowedAudioUploadPath("scan-snapshots/7/x.jpg", 7), false);
  assert.equal(isAllowedAudioUploadPath(`audio/tts/${HASH}.mp3`, 7), false);
  assert.equal(isAllowedAudioUploadPath("", 7), false);
});

test("Blob-URL: Pfad wird dekodiert, fremde Hosts zählen nicht", () => {
  assert.equal(blobPathFromUrl(`${STORE}/audio/7/Mein%20Lied-abc.mp3`), "audio/7/Mein Lied-abc.mp3");
  assert.equal(blobPathFromUrl("https://example.com/audio/7/x.mp3"), null);
  assert.equal(blobPathFromUrl("http://example123.public.blob.vercel-storage.com/x.mp3"), null);
  assert.equal(blobPathFromUrl("kein url"), null);
});

test("Anlegen: Pfad nur, wenn er zur URL passt und dem Mandanten gehört", () => {
  const url = `${STORE}/audio/7/Lied-abc.mp3`;
  assert.equal(acceptedAudioBlobPath("audio/7/Lied-abc.mp3", url, 7), "audio/7/Lied-abc.mp3");
  assert.equal(acceptedAudioBlobPath(" audio/7/Lied-abc.mp3 ", url, 7), "audio/7/Lied-abc.mp3");
  assert.equal(acceptedAudioBlobPath("audio/7/Lied-abc.mp3", url, 8), null);
  assert.equal(acceptedAudioBlobPath("audio/7/anderes.mp3", url, 7), null);
  // Alter Tab: Datei ohne Präfix wird angelegt, aber ohne Pfad.
  assert.equal(acceptedAudioBlobPath("Lied-abc.mp3", `${STORE}/Lied-abc.mp3`, 7), null);
  assert.equal(acceptedAudioBlobPath(null, url, 7), null);
  assert.equal(acceptedAudioBlobPath("audio/7/Lied-abc.mp3", "https://example.com/audio/7/Lied-abc.mp3", 7), null);
});

test("Löschen: eigener Pfad, alter Pfad oder liegen lassen", () => {
  assert.equal(audioBlobDeleteMode({ blobPathname: "audio/7/a.mp3", url: `${STORE}/audio/7/a.mp3` }, 7), "own");
  assert.equal(
    audioBlobDeleteMode({ blobPathname: `audio/tts/7/${HASH}.mp3`, url: `${STORE}/audio/tts/7/${HASH}.mp3` }, 7),
    "own",
  );
  assert.equal(audioBlobDeleteMode({ blobPathname: "a-xyz.mp3", url: `${STORE}/a-xyz.mp3` }, 7), "legacy");
  assert.equal(
    audioBlobDeleteMode({ blobPathname: `audio/tts/${HASH}.mp3`, url: `${STORE}/audio/tts/${HASH}.mp3` }, 7),
    "legacy",
  );
  // Alter blanker Pfad ohne Audio-Endung bleibt liegen.
  assert.equal(audioBlobDeleteMode({ blobPathname: "A-XYZ.M4A", url: `${STORE}/A-XYZ.M4A` }, 7), "legacy");
  assert.equal(audioBlobDeleteMode({ blobPathname: "bild-xyz.jpg", url: `${STORE}/bild-xyz.jpg` }, 7), "keep");
  assert.equal(audioBlobDeleteMode({ blobPathname: "daten", url: `${STORE}/daten` }, 7), "keep");
  // Pfad passt nicht zur URL, fremder Mandant, fremder Bereich, kein Pfad.
  assert.equal(audioBlobDeleteMode({ blobPathname: "a-xyz.mp3", url: `${STORE}/b.mp3` }, 7), "keep");
  assert.equal(audioBlobDeleteMode({ blobPathname: "audio/8/a.mp3", url: `${STORE}/audio/8/a.mp3` }, 7), "keep");
  assert.equal(
    audioBlobDeleteMode({ blobPathname: "scan-snapshots/7/x.jpg", url: `${STORE}/scan-snapshots/7/x.jpg` }, 7),
    "keep",
  );
  assert.equal(audioBlobDeleteMode({ blobPathname: null, url: `${STORE}/a.mp3` }, 7), "keep");
});
