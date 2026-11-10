import { describe, expect, it } from "vitest";
import {
  INTERNAL_TOKEN_HEADER,
  generateInternalToken,
  verifyInternalToken,
} from "@/lib/internal-token";

describe("verifyInternalToken", () => {
  it("akzeptiert genau das konfigurierte Token", () => {
    const token = generateInternalToken();
    expect(verifyInternalToken(token, token)).toBe(true);
  });

  it("lehnt falsche, kürzere und längere Token ab", () => {
    expect(verifyInternalToken("geheim-123", "geheim-124")).toBe(false);
    expect(verifyInternalToken("geheim-123", "geheim")).toBe(false);
    expect(verifyInternalToken("geheim-123", "geheim-1234")).toBe(false);
  });

  it("lehnt fehlenden Header ab", () => {
    expect(verifyInternalToken("geheim-123", null)).toBe(false);
    expect(verifyInternalToken("geheim-123", undefined)).toBe(false);
    expect(verifyInternalToken("geheim-123", "")).toBe(false);
  });

  it("gilt nie als intern, solange kein Token konfiguriert ist", () => {
    expect(verifyInternalToken("", "")).toBe(false);
    expect(verifyInternalToken("", "irgendwas")).toBe(false);
  });
});

describe("generateInternalToken", () => {
  it("erzeugt lange, jedes Mal andere Token", () => {
    const a = generateInternalToken();
    const b = generateInternalToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("nutzt einen Header-Namen in Kleinbuchstaben", () => {
    expect(INTERNAL_TOKEN_HEADER).toBe(INTERNAL_TOKEN_HEADER.toLowerCase());
  });
});
