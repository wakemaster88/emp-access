import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressChangeNeedsPassword,
  cleanReceiverName,
  isHostAddress,
  isIpv4,
  isPrivateIpv4,
  parseDeviceIp,
} from "./net-address";

test("isIpv4: nur Punktschreibweise mit Werten bis 255", () => {
  assert.equal(isIpv4("192.168.1.20"), true);
  assert.equal(isIpv4("0.0.0.0"), true);
  assert.equal(isIpv4("256.1.1.1"), false);
  assert.equal(isIpv4("192.168.1"), false);
  assert.equal(isIpv4("192.168.1.20:80"), false);
  assert.equal(isIpv4("kamera.local"), false);
});

test("isIpv4: führende Nullen werden abgelehnt (URL-Parser lesen sie oktal)", () => {
  for (const ip of ["010.1.2.3", "172.016.0.1", "192.168.001.010", "00.0.0.0"]) {
    assert.equal(isIpv4(ip), false, ip);
    assert.equal(isHostAddress(ip), false, ip);
    assert.equal(isPrivateIpv4(ip), false, ip);
    assert.ok("error" in parseDeviceIp(ip), ip);
  }
  assert.equal(isIpv4("10.0.100.200"), true);
  assert.equal(isIpv4("192.168.0.0"), true);
  assert.equal(isIpv4("255.255.255.255"), true);
});

test("isHostAddress: IPv4 oder Hostname ohne Schema, Port, Pfad, Zugangsdaten", () => {
  assert.equal(isHostAddress("192.168.1.20"), true);
  assert.equal(isHostAddress("kamera-hof.local"), true);
  assert.equal(isHostAddress("cam1"), true);
  assert.equal(isHostAddress(""), false);
  assert.equal(isHostAddress("http://192.168.1.20"), false);
  assert.equal(isHostAddress("192.168.1.20:8080"), false);
  assert.equal(isHostAddress("192.168.1.20/pfad"), false);
  assert.equal(isHostAddress("user:pw@192.168.1.20"), false);
  assert.equal(isHostAddress('192.168.1.20"'), false);
  assert.equal(isHostAddress("192.168.1.20\nx"), false);
  assert.equal(isHostAddress("-cam"), false);
  assert.equal(isHostAddress("300.1.1.1"), false);
});

test("isPrivateIpv4: private Netze und Link-Local", () => {
  for (const ip of ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.10.3", "169.254.1.1"]) {
    assert.equal(isPrivateIpv4(ip), true, ip);
  }
  for (const ip of ["172.15.0.1", "172.32.0.1", "8.8.8.8", "192.169.0.1", "kamera.local", "127.0.0.1"]) {
    assert.equal(isPrivateIpv4(ip), false, ip);
  }
});

test("addressChangeNeedsPassword: nur bei Wechsel auf ein Ziel ausserhalb des LAN", () => {
  const before = { host: "192.168.1.20", httpPort: 80, https: false };
  assert.equal(addressChangeNeedsPassword(before, before), false);
  assert.equal(addressChangeNeedsPassword(before, { ...before, host: "192.168.1.31" }), false);
  assert.equal(addressChangeNeedsPassword(before, { ...before, httpPort: 8080 }), false);
  assert.equal(addressChangeNeedsPassword(before, { ...before, host: "203.0.113.5" }), true);
  assert.equal(addressChangeNeedsPassword(before, { ...before, host: "kamera.example" }), true);
  const named = { host: "kamera.local", httpPort: 80, https: false };
  assert.equal(addressChangeNeedsPassword(named, named), false);
  assert.equal(addressChangeNeedsPassword(named, { ...named, https: true }), true);
  assert.equal(addressChangeNeedsPassword(before, { ...before, host: "010.1.2.3" }), true);
});

test("parseDeviceIp: leer bleibt erlaubt, sonst nur IPv4", () => {
  assert.deepEqual(parseDeviceIp(null), { ip: null });
  assert.deepEqual(parseDeviceIp(undefined), { ip: null });
  assert.deepEqual(parseDeviceIp(""), { ip: null });
  assert.deepEqual(parseDeviceIp(" 192.168.1.50 "), { ip: "192.168.1.50" });
  assert.ok("error" in parseDeviceIp("192.168.1.50/rpc"));
  assert.ok("error" in parseDeviceIp("shelly.local"));
  assert.ok("error" in parseDeviceIp(42));
});

test("cleanReceiverName: entfernt nur Zeichen, die den Wert verlassen koennen", () => {
  assert.equal(cleanReceiverName("Bar & Terrasse (Süd)"), "Bar & Terrasse (Süd)");
  assert.equal(cleanReceiverName('Bar"; x = "y'), "Bar; x = y");
  assert.equal(cleanReceiverName("Bar\\\nzwei\r\t"), "Barzwei");
  assert.equal(cleanReceiverName("  Strand  "), "Strand");
  assert.equal(cleanReceiverName("x".repeat(80)).length, 60);
  assert.equal(cleanReceiverName("x".repeat(150), 100).length, 100);
});
