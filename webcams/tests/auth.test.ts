import { describe, expect, it } from "vitest";
import { checkRequestAuth, cookieValueForPin } from "@/lib/auth";

describe("checkRequestAuth", () => {
  it("erlaubt alles, wenn keine PIN gesetzt ist", () => {
    expect(checkRequestAuth({ pin: "" })).toBe(true);
    expect(checkRequestAuth({ pin: "", headerToken: "falsch" })).toBe(true);
  });

  it("akzeptiert den korrekten Header-Token", () => {
    expect(checkRequestAuth({ pin: "1234", headerToken: "1234" })).toBe(true);
  });

  it("lehnt falschen Header-Token ab", () => {
    expect(checkRequestAuth({ pin: "1234", headerToken: "9999" })).toBe(false);
    expect(checkRequestAuth({ pin: "1234", headerToken: "12345" })).toBe(false);
  });

  it("akzeptiert das korrekte Cookie", () => {
    const cookie = cookieValueForPin("1234");
    expect(checkRequestAuth({ pin: "1234", cookieValue: cookie })).toBe(true);
  });

  it("lehnt Cookies anderer PINs ab (PIN-Wechsel invalidiert Sessions)", () => {
    const cookie = cookieValueForPin("alt");
    expect(checkRequestAuth({ pin: "neu", cookieValue: cookie })).toBe(false);
  });

  it("lehnt ohne Cookie und Header ab", () => {
    expect(checkRequestAuth({ pin: "1234" })).toBe(false);
    expect(checkRequestAuth({ pin: "1234", cookieValue: "", headerToken: "" })).toBe(false);
  });
});
