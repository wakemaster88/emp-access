import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAllowedHosts,
  checkDashboardRequest,
  hostnameOf,
  type GuardRequest,
} from "./dashboard-guard.js";

const CFG = {
  port: 8787,
  allowedHosts: buildAllowedHosts({
    hostname: "Hub-iMac.local",
    addresses: ["127.0.0.1", "::1", "192.168.10.5", "fe80::1c2a:3bff:fe4d:5e6f%en0"],
    extra: ["hub.emp.lan, 10.0.0.7"],
  }),
};

/** Anfrage der Dashboard-Oberflaeche am Hub-Rechner selbst (Loopback, kein Token). */
function uiPost(over: Partial<GuardRequest> = {}): GuardRequest {
  return {
    method: "POST",
    pathname: "/api/action",
    host: "localhost:8787",
    origin: "http://localhost:8787",
    contentType: "application/json",
    tokenAuthenticated: false,
    ...over,
  };
}

function reason(req: GuardRequest): string {
  const r = checkDashboardRequest(req, CFG);
  return r.ok ? "ok" : r.reason;
}

test("Oberflaeche am Hub-Rechner: gleicher Ursprung wird angenommen", () => {
  assert.equal(reason(uiPost()), "ok");
  assert.equal(reason(uiPost({ host: "127.0.0.1:8787", origin: "http://127.0.0.1:8787" })), "ok");
  assert.equal(reason(uiPost({ host: "[::1]:8787", origin: "http://[::1]:8787" })), "ok");
  assert.equal(reason(uiPost({ contentType: "application/json; charset=utf-8" })), "ok");
  assert.equal(reason(uiPost({ method: "DELETE", pathname: "/api/rules/3" })), "ok");
  assert.equal(reason(uiPost({ method: "PATCH", pathname: "/api/detection/cameras/2" })), "ok");
});

test("Oberflaeche im LAN (Token-Cookie): IP, Name und HTTPS", () => {
  const lan = { tokenAuthenticated: true };
  assert.equal(reason(uiPost({ ...lan, host: "192.168.10.5:8787", origin: "http://192.168.10.5:8787" })), "ok");
  assert.equal(reason(uiPost({ ...lan, host: "hub-imac.local:8787", origin: "https://hub-imac.local:8787" })), "ok");
  // Mit gueltigem Token darf der Hub unter jedem Namen erreicht werden (DNS im Router, VPN).
  assert.equal(reason(uiPost({ ...lan, host: "imac.fritz.box:8787", origin: "http://imac.fritz.box:8787" })), "ok");
});

test("fremde Seite (CSRF) wird abgelehnt – auch mit JSON und Token-Cookie", () => {
  assert.equal(reason(uiPost({ origin: "https://evil.example" })), "origin");
  assert.equal(reason(uiPost({ origin: "http://localhost:3000" })), "origin");
  assert.equal(reason(uiPost({ origin: "null" })), "origin");
  assert.equal(reason(uiPost({ origin: "" })), "origin");
  // Anderer Dienst auf demselben Rechner (anderer Port) – Cookie kaeme mit.
  assert.equal(
    reason(uiPost({ tokenAuthenticated: true, host: "192.168.10.5:8787", origin: "http://192.168.10.5:3000" })),
    "origin"
  );
  // localhost des Clients ist nicht das Dashboard, wenn die Anfrage ans LAN ging.
  assert.equal(
    reason(uiPost({ tokenAuthenticated: true, host: "192.168.10.5:8787", origin: "http://localhost:8787" })),
    "origin"
  );
});

test("localhost und 127.0.0.1 gelten untereinander als das Dashboard", () => {
  assert.equal(reason(uiPost({ host: "127.0.0.1:8787", origin: "http://localhost:8787" })), "ok");
  assert.equal(reason(uiPost({ host: "127.0.0.1:8787", origin: "http://localhost:9999" })), "origin");
});

test("einfache Anfrage ohne JSON-Typ wird abgelehnt (Tueroeffner per Formular)", () => {
  assert.equal(reason(uiPost({ contentType: "text/plain" })), "content-type");
  assert.equal(reason(uiPost({ contentType: "application/x-www-form-urlencoded" })), "content-type");
  assert.equal(reason(uiPost({ contentType: "multipart/form-data; boundary=x" })), "content-type");
  assert.equal(reason(uiPost({ contentType: undefined })), "content-type");
  // Auch ohne Origin (alter Browser, Skript) bleibt der Typ Pflicht.
  assert.equal(reason(uiPost({ origin: undefined, contentType: "text/plain" })), "content-type");
  assert.equal(reason(uiPost({ origin: undefined, pathname: "/api/rules/3/run", contentType: undefined })), "content-type");
  const r = checkDashboardRequest(uiPost({ contentType: "text/plain" }), CFG);
  assert.equal(r.ok ? 0 : r.status, 415);
});

test("DNS-Rebinding: fremder Host-Name wird abgelehnt", () => {
  // Seite und Anfrage haben denselben (umgebogenen) Namen – Origin passt also.
  assert.equal(reason(uiPost({ host: "evil.example:8787", origin: "http://evil.example:8787" })), "host");
  assert.equal(reason(uiPost({ host: "hub-imac.evil.example:8787", origin: undefined })), "host");
  assert.equal(reason(uiPost({ host: undefined })), "host");
  assert.equal(reason(uiPost({ host: "" })), "host");
  assert.equal(reason(uiPost({ host: "localhost:8787@evil.example" })), "host");
  const r = checkDashboardRequest(uiPost({ host: "evil.example:8787" }), CFG);
  assert.equal(r.ok ? 0 : r.status, 403);
});

test("eigene Namen und Adressen des Hubs sind ohne Token erlaubt", () => {
  for (const host of [
    "hub-imac.local:8787",
    "HUB-IMAC:8787",
    "192.168.10.5:8787",
    "hub.emp.lan:8787",
    "10.0.0.7:8787",
    "localhost.:8787",
    "[fe80::1c2a:3bff:fe4d:5e6f]:8787",
  ]) {
    assert.equal(reason(uiPost({ host, origin: `http://${host}` })), "ok", host);
  }
});

test("Skript ohne Browser (curl mit JSON, kein Origin) bleibt moeglich", () => {
  assert.equal(reason(uiPost({ origin: undefined })), "ok");
});

test("WebRTC-Angebot der Kamera-Zentrale: application/sdp nur dort", () => {
  const webrtc = { pathname: "/api/go2rtc/webrtc", contentType: "application/sdp" };
  assert.equal(reason(uiPost(webrtc)), "ok");
  assert.equal(reason(uiPost({ ...webrtc, origin: "https://evil.example" })), "origin");
  assert.equal(reason(uiPost({ ...webrtc, contentType: "text/plain" })), "content-type");
  assert.equal(reason(uiPost({ pathname: "/api/action", contentType: "application/sdp" })), "content-type");
});

test("Klima-Webhook (Shelly H&T) bleibt erreichbar", () => {
  // Dokumentierter Weg: GET mit Token in der Adresse, kein Origin, kein Content-Type.
  const shelly: GuardRequest = {
    method: "GET",
    pathname: "/api/climate/report",
    host: "192.168.10.5:8787",
    origin: undefined,
    contentType: undefined,
    tokenAuthenticated: true,
  };
  assert.equal(reason(shelly), "ok");
  // Falls ein Fuehler per POST meldet: kein JSON-Typ noetig …
  assert.equal(reason({ ...shelly, method: "POST" }), "ok");
  assert.equal(reason({ ...shelly, method: "POST", contentType: "application/x-www-form-urlencoded" }), "ok");
  // … aber eine fremde Seite darf auch hier nicht schreiben.
  assert.equal(reason({ ...shelly, method: "POST", origin: "https://evil.example" }), "origin");
  assert.equal(
    reason({ ...shelly, method: "POST", tokenAuthenticated: false, host: "evil.example:8787" }),
    "host"
  );
});

test("lesende Anfragen prueft der Guard nicht", () => {
  assert.equal(reason(uiPost({ method: "GET", origin: "https://evil.example", contentType: undefined })), "ok");
  assert.equal(reason(uiPost({ method: "HEAD", contentType: undefined })), "ok");
  // OPTIONS (Preflight einer fremden Seite) wird wie eine schreibende Anfrage behandelt.
  assert.equal(reason(uiPost({ method: "OPTIONS", origin: "https://evil.example", contentType: undefined })), "origin");
});

test("hostnameOf", () => {
  assert.equal(hostnameOf("LocalHost:8787"), "localhost");
  assert.equal(hostnameOf("192.168.1.2"), "192.168.1.2");
  assert.equal(hostnameOf("[::1]:8787"), "[::1]");
  assert.equal(hostnameOf("[::1]"), "[::1]");
  assert.equal(hostnameOf("[::1]x"), null);
  assert.equal(hostnameOf("a b"), null);
  assert.equal(hostnameOf("host:port"), null);
  assert.equal(hostnameOf(undefined), null);
});
