import { describe, expect, it } from "vitest";
import { isJsonContentType, isSameOrigin, requireSameOrigin, requireSameOriginJson } from "@/lib/same-origin";

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

describe("requireSameOriginJson", () => {
  const url = "http://localhost:3000/api/cams";

  it("lässt Same-Origin-JSON und Skripte ohne Origin durch", () => {
    expect(
      requireSameOriginJson(
        new Request(url, {
          method: "POST",
          headers: {
            host: "localhost:3000",
            origin: "http://localhost:3000",
            "content-type": "application/json; charset=utf-8",
          },
        }),
      ),
    ).toBeNull();
    expect(
      requireSameOriginJson(
        new Request(url, {
          method: "POST",
          headers: { host: "localhost:3000", "content-type": "application/json" },
        }),
      ),
    ).toBeNull();
  });

  it("lehnt Cross-Origin mit 403 und Formular-Requests mit 415 ab", () => {
    const cross = requireSameOriginJson(
      new Request(url, {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "https://evil.example",
          "content-type": "application/json",
        },
      }),
    );
    expect(cross?.status).toBe(403);
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = requireSameOriginJson(
        new Request(url, {
          method: "POST",
          headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": ct },
        }),
      );
      expect(res?.status).toBe(415);
    }
  });

  it("erkennt den JSON-Content-Type", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("Application/JSON ; charset=UTF-8")).toBe(true);
    expect(isJsonContentType("application/jsonx")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });
});

describe("POST /api/telegram/set-webhook", () => {
  const url = "http://localhost:3000/api/telegram/set-webhook";

  it("lehnt Cross-Origin und Nicht-JSON ab, bevor die Config gelesen wird", async () => {
    const { POST } = await import("@/app/api/telegram/set-webhook/route");
    const cross = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "https://fremd.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ delete: true }),
      }),
    );
    expect(cross.status).toBe(403);
    const plain = await POST(
      new Request(url, {
        method: "POST",
        headers: { host: "localhost:3000", "content-type": "text/plain" },
        body: JSON.stringify({ delete: true }),
      }),
    );
    expect(plain.status).toBe(415);
  });
});
