#!/usr/bin/env swift
/**
 * Kennzeichen-OCR via macOS Vision (VNRecognizeTextRequest).
 * Aufruf: PlateOCR <jpeg-path>
 * stdout: JSON { "plate": "RE-HS 9014"|null, "confidence": 0.0, "candidates": [...] }
 */
import Foundation
import Vision
import AppKit
import CoreImage
import CoreGraphics

struct Candidate: Codable {
    let plate: String
    let confidence: Float
    let source: String
}

struct ResultPayload: Codable {
    let plate: String?
    let confidence: Float
    let candidates: [Candidate]
    let raw: [String]
}

struct TextHit {
    let text: String
    let confidence: Float
    let box: CGRect
}

func loadCGImage(path: String) -> CGImage? {
    let url = URL(fileURLWithPath: path)
    guard let img = NSImage(contentsOf: url),
          let tiff = img.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let cg = rep.cgImage else { return nil }
    return cg
}

func recognize(_ cg: CGImage) throws -> [TextHit] {
    var hits: [TextHit] = []
    let request = VNRecognizeTextRequest { req, _ in
        guard let observations = req.results as? [VNRecognizedTextObservation] else { return }
        for obs in observations {
            guard let best = obs.topCandidates(3).first else { continue }
            hits.append(TextHit(text: best.string, confidence: best.confidence, box: obs.boundingBox))
            for alt in obs.topCandidates(3).dropFirst() {
                hits.append(TextHit(text: alt.string, confidence: alt.confidence * 0.9, box: obs.boundingBox))
            }
        }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["de-DE", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try handler.perform([request])
    return hits
}

func normalizeLetters(_ s: String) -> String {
    s.uppercased()
        .replacingOccurrences(of: "Ä", with: "AE")
        .replacingOccurrences(of: "Ö", with: "OE")
        .replacingOccurrences(of: "Ü", with: "UE")
        .replacingOccurrences(of: "ß", with: "SS")
}

/// Alle gültigen DE-Kennzeichen-Splits aus einem alphanumerischen Blob.
func platesFromBlob(_ raw: String) -> [String] {
    let upper = normalizeLetters(raw)
    let compact = upper.replacingOccurrences(of: "[^A-Z0-9]", with: "", options: .regularExpression)
    guard compact.count >= 5, compact.count <= 12 else { return [] }

    var out: [String] = []
    // Optional leading country junk
    let body = compact.hasPrefix("D") && compact.count > 5 ? String(compact.dropFirst()) : compact

    guard let m = body.range(of: #"^([A-Z]+)(\d{1,4}[EH]?)$"#, options: .regularExpression) else {
        return []
    }
    let full = String(body[m])
    guard let dm = full.range(of: #"\d"#, options: .regularExpression) else { return [] }
    let letters = String(full[..<dm.lowerBound])
    let digits = String(full[dm.lowerBound...])
    guard digits.range(of: #"^\d{1,4}[EH]?$"#, options: .regularExpression) != nil else { return [] }

    for cityLen in 1...3 {
        for midLen in 1...2 {
            if cityLen + midLen != letters.count { continue }
            let city = String(letters.prefix(cityLen))
            let mid = String(letters.dropFirst(cityLen))
            // Unplausible: city ends with digit already handled; reject I/O-only mid
            if mid.isEmpty { continue }
            out.append("\(city)-\(mid) \(digits)")
        }
    }

    // OCR-Fehler: extra Buchstabe in der Mitte (RESHS → REHS)
    if letters.count >= 5 {
        for dropAt in 2..<(letters.count - 1) {
            var chars = Array(letters)
            chars.remove(at: dropAt)
            let slim = String(chars)
            for cityLen in 1...3 {
                for midLen in 1...2 {
                    if cityLen + midLen != slim.count { continue }
                    let city = String(slim.prefix(cityLen))
                    let mid = String(slim.dropFirst(cityLen))
                    out.append("\(city)-\(mid) \(digits)")
                }
            }
        }
    }

    return Array(Set(out))
}

func platesFromText(_ text: String) -> [String] {
    var found = platesFromBlob(text)
    // Auch Teilstücke mit Leerzeichen/Bindestrich
    let upper = normalizeLetters(text)
    let pattern = #"\b([A-Z]{1,3})[-\s]?([A-Z]{1,2})[-\s]?(\d{1,4}[EH]?)\b"#
    if let r = try? NSRegularExpression(pattern: pattern) {
        let ns = upper as NSString
        let matches = r.matches(in: upper, range: NSRange(location: 0, length: ns.length))
        for m in matches where m.numberOfRanges == 4 {
            let a = ns.substring(with: m.range(at: 1))
            let b = ns.substring(with: m.range(at: 2))
            let c = ns.substring(with: m.range(at: 3))
            found.append("\(a)-\(b) \(c)")
        }
    }
    return Array(Set(found))
}

func cropNormalized(_ cg: CGImage, box: CGRect, pad: CGFloat) -> CGImage? {
    let W = CGFloat(cg.width)
    let H = CGFloat(cg.height)
    // Vision: origin bottom-left, normalized
    var x = box.origin.x - pad
    var y = box.origin.y - pad
    var w = box.size.width + pad * 2
    var h = box.size.height + pad * 2
    x = max(0, min(1, x))
    y = max(0, min(1, y))
    w = max(0.01, min(1 - x, w))
    h = max(0.01, min(1 - y, h))
    // Convert to top-left pixel rect for CGImage crop
    let px = CGFloat(Int(x * W))
    let pw = CGFloat(Int(w * W))
    let ph = CGFloat(Int(h * H))
    let pyTop = CGFloat(Int((1 - y - h) * H))
    let rect = CGRect(x: px, y: pyTop, width: max(1, pw), height: max(1, ph))
    return cg.cropping(to: rect)
}

func scale(_ cg: CGImage, factor: CGFloat) -> CGImage? {
    let w = Int(CGFloat(cg.width) * factor)
    let h = Int(CGFloat(cg.height) * factor)
    guard w > 0, h > 0 else { return nil }
    let colorSpace = cg.colorSpace ?? CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil, width: w, height: h,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()
}

func lowerRegion(_ cg: CGImage, heightFrac: CGFloat) -> CGImage? {
    let H = CGFloat(cg.height)
    let h = H * heightFrac
    let rect = CGRect(x: 0, y: H - h, width: CGFloat(cg.width), height: h)
    return cg.cropping(to: rect)
}

func centerRegion(_ cg: CGImage, frac: CGFloat) -> CGImage? {
    let W = CGFloat(cg.width), H = CGFloat(cg.height)
    let w = W * frac, h = H * frac
    let rect = CGRect(x: (W - w) / 2, y: (H - h) / 2, width: w, height: h)
    return cg.cropping(to: rect)
}

/// Überlappende Kacheln (für weit entfernte, kleine Kennzeichen).
func tileRegions(_ cg: CGImage, cols: Int, rows: Int, overlap: CGFloat) -> [CGImage] {
    let W = CGFloat(cg.width), H = CGFloat(cg.height)
    let tw = W / CGFloat(cols)
    let th = H / CGFloat(rows)
    let ox = tw * overlap
    let oy = th * overlap
    var out: [CGImage] = []
    for r in 0..<rows {
        for c in 0..<cols {
            let x = max(0, CGFloat(c) * tw - ox)
            let y = max(0, CGFloat(r) * th - oy)
            let w = min(W - x, tw + ox * 2)
            let h = min(H - y, th + oy * 2)
            if let tile = cg.cropping(to: CGRect(x: x, y: y, width: w, height: h)) {
                out.append(tile)
            }
        }
    }
    return out
}

/// Häufige DE-Unterscheidungszeichen (NRW + Umgebung + Großstädte). Kein Vollkatalog.
let KNOWN_CITY: Set<String> = [
    "RE", "BOR", "UN", "GE", "EN", "DO", "BO", "E", "HA", "HER", "HAM", "BOT",
    "MG", "NE", "D", "K", "AC", "BN", "SU", "LEV", "GL", "ME", "RS", "W", "SG",
    "OB", "MH", "DU", "KR", "VIE", "WES", "KLE", "COE", "ST", "SO", "UNNA",
    "B", "M", "HH", "HB", "S", "F", "N", "DD", "L", "H", "KI", "HL",
]

/// Bevorzuge typische Muster + bekannte Kreise.
func scorePlate(_ plate: String) -> Int {
    let parts = plate.split(separator: " ")
    guard parts.count == 2 else { return 0 }
    let left = parts[0].split(separator: "-")
    guard left.count == 2 else { return 0 }
    let cityStr = String(left[0])
    let city = cityStr.count
    let mid = left[1].count
    let digits = parts[1].filter(\.isNumber).count
    var s = 0
    if city == 2 { s += 3 } else if city == 3 { s += 2 } else { s += 1 }
    if mid == 2 { s += 3 } else { s += 1 }
    if digits >= 3 { s += 2 }
    if KNOWN_CITY.contains(cityStr) { s += 4 }
    // Doppelbuchstaben in der Erkennungsnummer sind seltener / oft OCR-Artefakte (SS vs HS).
    let midStr = String(left[1])
    if Set(midStr).count == midStr.count { s += 1 }
    let bad = ["HTTP", "WWW", "COM", "DE", "TEL", "FAX", "WED", "HED", "UED"]
    if bad.contains(cityStr) { s -= 10 }
    return s
}

func collect(from hits: [TextHit], source: String) -> [Candidate] {
    var out: [Candidate] = []
    for h in hits {
        for p in platesFromText(h.text) {
            out.append(Candidate(plate: p, confidence: h.confidence, source: source))
        }
    }
    // Join neighboring hits (OCR splits "RE" "HS" "9014")
    let texts = hits.map(\.text)
    for i in 0..<texts.count {
        for j in i...min(i + 4, texts.count - 1) {
            let joined = texts[i...j].joined(separator: " ")
            let conf = hits[i...j].map(\.confidence).min() ?? 0
            for p in platesFromText(joined) {
                out.append(Candidate(plate: p, confidence: conf, source: source + "+join"))
            }
        }
    }
    return out
}

func run(path: String) throws -> ResultPayload {
    guard let full = loadCGImage(path: path) else {
        throw NSError(domain: "plate", code: 1, userInfo: [NSLocalizedDescriptionKey: "cannot load image"])
    }

    var candidates: [Candidate] = []
    var rawTexts: [String] = []

    let passes: [(String, CGImage?)] = [
        ("full", full),
        ("lower", lowerRegion(full, heightFrac: 0.55)),
        ("center", centerRegion(full, frac: 0.6)),
        ("lower-up", lowerRegion(full, heightFrac: 0.5).flatMap { scale($0, factor: 2.5) }),
    ]

    for (name, imgOpt) in passes {
        guard let img = imgOpt else { continue }
        let hits = try recognize(img)
        rawTexts.append(contentsOf: hits.prefix(20).map(\.text))
        candidates.append(contentsOf: collect(from: hits, source: name))
    }

    // Zoom auf verdächtige Boxen (Vision-Koordinaten: full-relativ)
    let fullHits = try recognize(full)
    for h in fullHits {
        let aspect = h.box.width / max(h.box.height, 0.001)
        let interesting = aspect > 2.0 && h.box.height < 0.1
            || !platesFromText(h.text).isEmpty
            || h.text.uppercased().range(of: #"\d{3,}"#, options: .regularExpression) != nil
        if interesting {
            if let crop = cropNormalized(full, box: h.box, pad: 0.04),
               let up = scale(crop, factor: 4.0) {
                let zh = try recognize(up)
                rawTexts.append(contentsOf: zh.prefix(10).map(\.text))
                candidates.append(contentsOf: collect(from: zh, source: "zoom"))
            }
        }
    }

    // Kachel-Pass: nur wenn bisher kein brauchbarer Kandidat (weit entfernte Plates).
    // Vision findet kleinen Text auf 4K-Vollbild nicht – Kacheln + Upscale lösen das.
    let hasGood = candidates.contains { c in
        let city = String(c.plate.split(separator: "-").first ?? "")
        return c.confidence >= 0.50 && KNOWN_CITY.contains(city)
    }
    if !hasGood {
        for tile in tileRegions(full, cols: 3, rows: 2, overlap: 0.15) {
            guard let up = scale(tile, factor: 2.0) else { continue }
            let th = try recognize(up)
            rawTexts.append(contentsOf: th.prefix(10).map(\.text))
            candidates.append(contentsOf: collect(from: th, source: "tile"))
            // Zoom auf verdächtige Boxen innerhalb der Kachel
            for h in th {
                let aspect = h.box.width / max(h.box.height, 0.001)
                let interesting = aspect > 2.0 && h.box.height < 0.15
                    || !platesFromText(h.text).isEmpty
                if interesting {
                    if let crop = cropNormalized(up, box: h.box, pad: 0.05),
                       let zoomed = scale(crop, factor: 3.0) {
                        let zh = try recognize(zoomed)
                        rawTexts.append(contentsOf: zh.prefix(6).map(\.text))
                        candidates.append(contentsOf: collect(from: zh, source: "tile-zoom"))
                    }
                }
            }
            // Early-Stop: sobald eine Kachel einen guten Treffer liefert
            let nowGood = candidates.contains { c in
                let city = String(c.plate.split(separator: "-").first ?? "")
                return c.confidence >= 0.50 && KNOWN_CITY.contains(city) && scorePlate(c.plate) >= 12
            }
            if nowGood { break }
        }
    }

    // Dedup: beste Confidence je Plate, Tie-Break nach scorePlate
    var best: [String: Candidate] = [:]
    for c in candidates {
        if let prev = best[c.plate] {
            let betterConf = c.confidence > prev.confidence
            let betterScore = scorePlate(c.plate) > scorePlate(prev.plate) && abs(c.confidence - prev.confidence) < 0.15
            if betterConf || betterScore { best[c.plate] = c }
        } else {
            best[c.plate] = c
        }
    }

    let ranked = best.values.sorted { a, b in
        let sa = scorePlate(a.plate)
        let sb = scorePlate(b.plate)
        if sa != sb { return sa > sb }
        return a.confidence > b.confidence
    }

    // Auto-Wahl nur mit bekanntem Kreis (KNOWN_CITY) und guter Confidence.
    let picked = ranked.first { c in
        let city = String(c.plate.split(separator: "-").first ?? "")
        return c.confidence >= 0.50 && scorePlate(c.plate) >= 12 && KNOWN_CITY.contains(city)
    }

    return ResultPayload(
        plate: picked?.plate,
        confidence: picked?.confidence ?? 0,
        candidates: Array(ranked.prefix(12)),
        raw: Array(Set(rawTexts)).prefix(40).map { $0 }
    )
}

let args = Array(CommandLine.arguments.dropFirst())
guard let path = args.first else {
    fputs("usage: PlateOCR <image.jpg>\n", stderr)
    exit(2)
}

do {
    let payload = try run(path: path)
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    let data = try enc.encode(payload)
    if let s = String(data: data, encoding: .utf8) {
        print(s)
    }
} catch {
    let err = ResultPayload(plate: nil, confidence: 0, candidates: [], raw: ["error:\(error)"])
    let data = try! JSONEncoder().encode(err)
    print(String(data: data, encoding: .utf8)!)
    exit(1)
}
