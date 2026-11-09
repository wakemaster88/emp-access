import { describe, expect, it } from "vitest";
import {
  injectRuntimePatch,
  rewriteAbsolutePaths,
  stripCookies,
} from "@/lib/embed-rewrite";

const base = new URL("https://upstream.example.com");
const prefix = "/api/embed/w1";

describe("rewriteAbsolutePaths", () => {
  it("ersetzt absolute Origin-URLs durch den Proxy-Prefix", () => {
    const html = `<a href="https://upstream.example.com/foo">x</a>`;
    expect(rewriteAbsolutePaths(html, base, prefix)).toBe(
      `<a href="${prefix}/foo">x</a>`,
    );
  });

  it("rebased absolute Pfade in src/href-Attributen", () => {
    const html = `<img src="/img/logo.png"><a href='/login'>y</a>`;
    const out = rewriteAbsolutePaths(html, base, prefix);
    expect(out).toContain(`src="${prefix}/img/logo.png"`);
    expect(out).toContain(`href='${prefix}/login'`);
  });

  it("lässt protocol-relative URLs und bereits geproxte Pfade in Ruhe", () => {
    const html = `<img src="//cdn.example.com/a.png"><img src="${prefix}/b.png">`;
    expect(rewriteAbsolutePaths(html, base, prefix)).toBe(html);
  });

  it("rebased CSS url(...)", () => {
    const css = `body { background: url(/bg.png); }`;
    expect(rewriteAbsolutePaths(css, base, prefix)).toBe(
      `body { background: url(${prefix}/bg.png); }`,
    );
  });

  it("rebased srcset-Einträge", () => {
    const html = `<img srcset="/a.png 1x, /b.png 2x">`;
    expect(rewriteAbsolutePaths(html, base, prefix)).toBe(
      `<img srcset="${prefix}/a.png 1x, ${prefix}/b.png 2x">`,
    );
  });
});

describe("injectRuntimePatch", () => {
  it("injectet base-Tag und Patch-Script in <head>", () => {
    const html = `<html><head><title>t</title></head><body></body></html>`;
    const out = injectRuntimePatch(html, prefix);
    expect(out).toContain(`<base href="${prefix}/">`);
    expect(out).toContain("window.fetch=function");
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("<title>"));
  });

  it("stellt das Script voran, wenn kein <head> existiert", () => {
    const out = injectRuntimePatch("<div>x</div>", prefix);
    expect(out.startsWith("<script>")).toBe(true);
  });
});

describe("stripCookies", () => {
  it("entfernt das Login-Cookie der App, behält Upstream-Cookies", () => {
    expect(
      stripCookies("session=abc; webcams_auth=deadbeef; theme=dark", ["webcams_auth"]),
    ).toBe("session=abc; theme=dark");
  });

  it("liefert leer, wenn nur das App-Cookie da war", () => {
    expect(stripCookies("webcams_auth=deadbeef", ["webcams_auth"])).toBe("");
  });

  it("verwechselt keine Cookies mit ähnlichem Namen", () => {
    expect(stripCookies("webcams_auth2=x; my_webcams_auth=y", ["webcams_auth"])).toBe(
      "webcams_auth2=x; my_webcams_auth=y",
    );
  });

  it("lässt Werte mit '=' intakt", () => {
    expect(stripCookies("a=b=c; webcams_auth=x", ["webcams_auth"])).toBe("a=b=c");
  });
});
