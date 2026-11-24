import { test } from "node:test";
import assert from "node:assert/strict";
import { isStreamHost, replaceHost } from "./stream-host.js";

test("IPv4 und Hostnamen sind erlaubt", () => {
  assert.equal(isStreamHost("192.168.1.20"), true);
  assert.equal(isStreamHost("10.0.0.1"), true);
  assert.equal(isStreamHost("kamera-1.local"), true);
  assert.equal(isStreamHost("cam"), true);
});

test("Adressen mit Schema, Port, Pfad, Zugangsdaten oder Sonderzeichen werden abgelehnt", () => {
  assert.equal(isStreamHost(""), false);
  assert.equal(isStreamHost("http://192.168.1.20"), false);
  assert.equal(isStreamHost("192.168.1.20:8080"), false);
  assert.equal(isStreamHost("192.168.1.20/pfad"), false);
  assert.equal(isStreamHost("user@192.168.1.20"), false);
  assert.equal(isStreamHost('192.168.1.20"'), false);
  assert.equal(isStreamHost("192.168.1.20\nzeile"), false);
  assert.equal(isStreamHost(" 192.168.1.20"), false);
  assert.equal(isStreamHost("-kamera"), false);
  assert.equal(isStreamHost("kamera."), false);
});

test("Ziffernfolgen ohne gültige IPv4 werden abgelehnt", () => {
  assert.equal(isStreamHost("300.1.1.1"), false);
  assert.equal(isStreamHost("192.168.1"), false);
  assert.equal(isStreamHost("010.1.2.3"), false);
  assert.equal(isStreamHost("172.016.0.1"), false);
  assert.equal(isStreamHost("192.168.001.010"), false);
});

test("replaceHost: IPv4 nur als ganze Adresse ersetzen", () => {
  const text = "a 192.168.1.2 b 192.168.1.20 c 10.192.168.1.2 d rtsp://u:p@192.168.1.2:554/x";
  const r = replaceHost(text, "192.168.1.2", "192.168.1.9");
  assert.equal(r.count, 2);
  assert.equal(r.text, "a 192.168.1.9 b 192.168.1.20 c 10.192.168.1.2 d rtsp://u:p@192.168.1.9:554/x");
});

test("replaceHost: Hostname trifft keine Teile anderer Namen", () => {
  const text = '{"cams":[{"name":"cam-hof","ip":"cam"},{"ip":"cam.local"},{"ip":"mycam"}]}\nrtsp://u:p@cam:554/';
  const r = replaceHost(text, "cam", "192.168.1.21");
  assert.equal(r.count, 2);
  assert.equal(
    r.text,
    '{"cams":[{"name":"cam-hof","ip":"192.168.1.21"},{"ip":"cam.local"},{"ip":"mycam"}]}\nrtsp://u:p@192.168.1.21:554/'
  );
});
