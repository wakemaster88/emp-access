#!/usr/bin/env node
/**
 * Kopiert die ZXing-WebAssembly-Datei fuer den Kamera-Scan des Shop-Monitors
 * nach public/scanner (src/components/checkin/shop-camera.tsx).
 *
 * Geladen wird sie nur in Browsern ohne eigene BarcodeDetector-Schnittstelle
 * (Safari, Firefox, Chrome unter Windows und Linux), und zwar vom eigenen
 * Server statt vom CDN. Laeuft vor `dev` und `build`, damit Datei und
 * installierte Version zusammenpassen.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fromRoot = createRequire(join(root, "package.json"));
// zxing-wasm ist eine Abhaengigkeit von barcode-detector, nicht des Projekts selbst
const fromDetector = createRequire(fromRoot.resolve("barcode-detector"));
const source = fromDetector.resolve("zxing-wasm/reader/zxing_reader.wasm");
const target = join(root, "public", "scanner", "zxing_reader.wasm");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("Scanner: zxing_reader.wasm nach public/scanner kopiert");
