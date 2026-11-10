import { describe, expect, it } from "vitest";
import { isSameOrigin, requireSameOrigin } from "@/lib/same-origin";

describe("isSameOrigin", () => {
  it("erlaubt Aufrufe ohne Origin (Sidecar, curl)", () => {
    expect(isSameOrigin({ origin: null, host: "127.0.0.1:3000" })).toBe(true);
    expect(isSameOrigin({ origin: undefined, host: "127.0.0.1:3000" })).toBe(true);
  });

  it("erlaubt die eigene Origin", () => {
    expect(
      isSameOrigin({ origin: "http://localhost:3000", host: "localhost:3000" }),
    ).toBe(true);
    expect(
      isSameOrigin({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }),
    ).toBe(true);
    expect(isSameOrigin({ origin: "http://Kiosk.local", host: "kiosk.local" })).toBe(true);
  });

  it("lehnt fremde Seiten ab", () => {
    expect(
      isSameOrigin({ origin: "https://evil.example", host: "localhost:3000" }),
    ).toBe(false);
    // Gleicher Host, anderer Port ist eine andere Origin.
    expect(
      isSameOrigin({ origin: "http://localhost:8080", host: "localhost:3000" }),
    ).toBe(false);
    // localhost und 127.0.0.1 sind für den Browser verschiedene Origins.
    expect(
      isSameOrigin({ origin: "http://127.0.0.1:3000", host: "localhost:3000" }),
    ).toBe(false);
  });

  it('lehnt Origin "null" (sandboxed iFrame) und Müll ab', () => {
    expect(isSameOrigin({ origin: "null", host: "localhost:3000" })).toBe(false);
    expect(isSameOrigin({ origin: "kein-url", host: "localhost:3000" })).toBe(false);
  });

  it("lehnt ab, wenn der Host fehlt", () => {
    expect(isSameOrigin({ origin: "http://localhost:3000", host: null })).toBe(false);
  });

  it("akzeptiert den Host hinter einem Reverse-Proxy (x-forwarded-host)", () => {
    expect(
      isSameOrigin({
        origin: "https://kiosk.example",
        host: "127.0.0.1:3000",
        forwardedHost: "kiosk.example",
      }),
    ).toBe(true);
    expect(
      isSameOrigin({
        origin: "https://evil.example",
        host: "127.0.0.1:3000",
        forwardedHost: "kiosk.example",
      }),
    ).toBe(false);
  });
});

describe("requireSameOrigin", () => {
  const url = "http://localhost:3000/api/doorbird/open";

  it("lässt Same-Origin- und Origin-lose Requests durch", () => {
    expect(
      requireSameOrigin(
        new Request(url, {
          method: "POST",
          headers: { host: "localhost:3000", origin: "http://localhost:3000" },
        }),
      ),
    ).toBeNull();
    expect(
      requireSameOrigin(
        new Request(url, { method: "POST", headers: { host: "localhost:3000" } }),
      ),
    ).toBeNull();
  });

  it("antwortet Cross-Origin mit 403", () => {
    const res = requireSameOrigin(
      new Request(url, {
        method: "POST",
        headers: { host: "localhost:3000", origin: "https://evil.example" },
      }),
    );
    expect(res?.status).toBe(403);
  });
});
