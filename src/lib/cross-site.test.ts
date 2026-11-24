import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSiteWrite } from "./cross-site";

function h(values: Record<string, string>): Headers {
  return new Headers(values);
}

test("crossSiteWrite: GET und HEAD werden nie markiert", () => {
  const foreign = h({ "sec-fetch-site": "cross-site", origin: "https://fremd.example", host: "app.example.de" });
  assert.equal(crossSiteWrite("GET", foreign), false);
  assert.equal(crossSiteWrite("HEAD", foreign), false);
  assert.equal(crossSiteWrite("get", foreign), false);
});

test("crossSiteWrite: Sec-Fetch-Site entscheidet, wenn vorhanden", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(crossSiteWrite(method, h({ "sec-fetch-site": "same-origin" })), false, method);
    assert.equal(crossSiteWrite(method, h({ "sec-fetch-site": "none" })), false, method);
    assert.equal(crossSiteWrite(method, h({ "sec-fetch-site": "same-site" })), true, method);
    assert.equal(crossSiteWrite(method, h({ "sec-fetch-site": "cross-site" })), true, method);
  }
  // Ein passender Origin hebt ein fremdes Sec-Fetch-Site nicht auf.
  assert.equal(
    crossSiteWrite("POST", h({ "sec-fetch-site": "cross-site", origin: "https://app.example.de", host: "app.example.de" })),
    true,
  );
});

test("crossSiteWrite: ohne Sec-Fetch-Site zaehlt der Host im Origin", () => {
  assert.equal(crossSiteWrite("POST", h({ origin: "https://app.example.de", host: "app.example.de" })), false);
  assert.equal(
    crossSiteWrite("POST", h({ origin: "https://app.example.de", host: "intern", "x-forwarded-host": "app.example.de" })),
    false,
  );
  assert.equal(crossSiteWrite("POST", h({ origin: "http://localhost:3000", host: "localhost:3000" })), false);
  assert.equal(crossSiteWrite("POST", h({ origin: "https://fremd.example", host: "app.example.de" })), true);
  assert.equal(crossSiteWrite("POST", h({ origin: "https://sub.app.example.de", host: "app.example.de" })), true);
  assert.equal(crossSiteWrite("POST", h({ origin: "null", host: "app.example.de" })), true);
});

test("crossSiteWrite: ohne beide Header (Geraete, Skripte, Server) keine Markierung", () => {
  assert.equal(crossSiteWrite("POST", h({ host: "app.example.de" })), false);
  assert.equal(crossSiteWrite("POST", h({ host: "app.example.de", authorization: "Bearer x" })), false);
  assert.equal(crossSiteWrite("DELETE", h({})), false);
});
