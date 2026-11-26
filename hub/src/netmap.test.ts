/**
 * Netz-Karte (netmap.ts) ohne Netz: ARP-Zeilen, MAC-Schreibweisen und die
 * Subnetze aus den Umgebungswerten. Die Interfaces des Rechners ersetzt der
 * Test durch eine feste Liste. Alle Adressen liegen in den
 * Dokumentations-Netzen, alle MACs sind erfunden.
 *
 * netmap.ts liest beim Laden die Hub-Einstellungen (config.ts); der Test
 * setzt die zwei Pflichtwerte vorher und laedt das Modul danach.
 */
import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";

type Netmap = typeof import("./netmap.js");
let netmap: Netmap;

const iface = (address: string, netmask: string, internal = false): os.NetworkInterfaceInfo => ({
  address,
  netmask,
  family: "IPv4",
  mac: "02:00:00:00:00:00",
  internal,
  cidr: null,
});

const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
  lo0: [iface("127.0.0.1", "255.0.0.0", true)],
  en0: [
    iface("192.0.2.10", "255.255.255.0"),
    { ...iface("fe80::1", "ffff:ffff:ffff:ffff::"), family: "IPv6", scopeid: 4 },
  ],
  // Link-local und VPN-Tunnel zaehlen nicht.
  en1: [iface("169.254.10.20", "255.255.0.0")],
  utun3: [iface("198.51.100.200", "255.255.255.0")],
  // Kleines Netz: bleibt /30.
  vlan40: [iface("192.0.2.201", "255.255.255.252")],
};

/** Umgebungswerte der Subnetze fuer einen Test setzen; nicht genannte sind leer. */
function withEnv(values: { HUB_VLANS?: string; HUB_SCAN_EXCLUDE?: string; HUB_SCAN_SUBNETS?: string }, run: () => void) {
  const keys = ["HUB_VLANS", "HUB_SCAN_EXCLUDE", "HUB_SCAN_SUBNETS"] as const;
  const saved = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  }
}

before(async () => {
  process.env.HUB_API_URL ??= "http://127.0.0.1:9";
  process.env.HUB_API_TOKEN ??= "test";
  process.env.HUB_IMPROVE_LOG = "0";
  mock.method(os, "networkInterfaces", () => interfaces);
  // Gilt damit auch fuer `import { networkInterfaces } from "node:os"` in netmap.ts.
  syncBuiltinESMExports();
  netmap = await import("./netmap.js");
});

test("ARP: Zeilen von macOS mit einstelligen Oktetten, Interface und Zusatz", () => {
  const out = [
    "? (192.0.2.4) at 2:0:5e:10:0:1 on en0 ifscope [ethernet]",
    "? (192.0.2.5) at 02:00:5e:10:00:0a on en0 ifscope permanent [ethernet]",
    "? (198.51.100.7) at 2:0:5e:10:0:b on vlan30 ifscope [vlan]",
    "",
  ].join("\n");
  const map = netmap.parseArp(out);
  assert.deepEqual([...map], [
    ["192.0.2.4", { mac: "02:00:5E:10:00:01", iface: "en0" }],
    ["192.0.2.5", { mac: "02:00:5E:10:00:0A", iface: "en0" }],
    ["198.51.100.7", { mac: "02:00:5E:10:00:0B", iface: "vlan30" }],
  ]);
});

test("ARP: unvollstaendige Eintraege, Broadcast und fremde Zeilen fallen weg", () => {
  const out = [
    "? (192.0.2.6) at (incomplete) on en0 ifscope [ethernet]",
    "? (192.0.2.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]",
    "arp: kein Eintrag",
    "? (192.0.2.8) at 2:0:5e:10:0 on en0 ifscope [ethernet]",
  ].join("\n");
  assert.deepEqual([...netmap.parseArp(out)], []);
});

test("ARP: ohne `on <Interface>` direkt nach der MAC bleibt das Interface leer", () => {
  // So schreibt Linux die Tabelle.
  const map = netmap.parseArp("? (192.0.2.9) at 02:00:5e:10:00:0c [ether] on eth0\n");
  assert.deepEqual(map.get("192.0.2.9"), { mac: "02:00:5E:10:00:0C", iface: null });
});

test("MAC: Schreibweisen von ARP, SNMP und Geraete-APIs ergeben dieselbe Form", () => {
  for (const raw of [
    "02:00:5e:10:00:01",
    "2:0:5e:10:0:1",
    "02-00-5E-10-00-01",
    "02005e100001",
    "Hex-STRING: 02 00 5E 10 00 01 ",
    "  02 00 5e 10 00 01",
  ]) {
    assert.equal(netmap.normalizeMac(raw), "02:00:5E:10:00:01", raw);
  }
});

test("MAC: falsche Laenge oder fremde Zeichen ergeben null", () => {
  for (const raw of ["", "02:00:5e:10:00", "02:00:5e:10:00:01:02", "02:00:5e:10:00:zz", "02005e1000", "100:0:5e:10:0:1"]) {
    assert.equal(netmap.normalizeMac(raw), null, raw);
  }
});

test("IP-Helfer: Umrechnung, CIDR mit Vorgabe /24 und Grenzen", () => {
  assert.equal(netmap.ipToInt("192.0.2.10"), 0xc000020a);
  assert.equal(netmap.intToIp(0xc000020a), "192.0.2.10");
  assert.equal(netmap.ipToInt("192.0.2"), null);
  assert.equal(netmap.ipToInt("192.0.2.256"), null);
  assert.equal(netmap.ipToInt("192.0.2.1a"), null);
  assert.deepEqual(netmap.parseCidr("192.0.2.77"), { base: 0xc0000200, prefixLen: 24 });
  assert.deepEqual(netmap.parseCidr(" 198.51.100.130/25 "), { base: 0xc6336480, prefixLen: 25 });
  assert.equal(netmap.parseCidr("192.0.2.0/7"), null);
  assert.equal(netmap.parseCidr("192.0.2.0/31"), null);
  assert.equal(netmap.parseCidr("kein-netz"), null);
});

test("VLANs aus HUB_VLANS: Netz aus beliebiger Adresse, Name als Vorgabe, Ungueltiges faellt weg", () => {
  withEnv({ HUB_VLANS: "1:Verwaltung:192.0.2.77/24, 30::198.51.100.0/24,0:Null:192.0.2.0/24,5000:Zu gross:192.0.2.0/24,40:Ohne Netz,x:Text:192.0.2.0/24" }, () => {
    assert.deepEqual(
      netmap.configuredVlans().map((v) => [v.vlanId, v.name, v.cidr]),
      [
        [1, "Verwaltung", "192.0.2.0/24"],
        [30, "VLAN 30", "198.51.100.0/24"],
      ],
    );
  });
  withEnv({}, () => assert.deepEqual(netmap.configuredVlans(), []));
});

test("Bekannte Subnetze: eigene Interfaces, HUB_VLANS und HUB_SCAN_SUBNETS, sortiert und ohne Doppel", () => {
  withEnv(
    {
      HUB_VLANS: "1:Verwaltung:192.0.2.0/24,30:Kameras:198.51.100.0/24",
      HUB_SCAN_SUBNETS: "192.0.2.128/25, 192.0.2.0/24,kaputt",
    },
    () => {
      const subnets = netmap.knownSubnets();
      assert.deepEqual(
        subnets.map((s) => [s.cidr, s.vlanId, s.vlanName, s.iface, s.hubIp]),
        [
          // Das Interface en0 und VLAN 1 sind dasselbe Netz: ein Eintrag mit Interface.
          ["192.0.2.0/24", 1, "Verwaltung", "en0", "192.0.2.10"],
          // Ein Teilnetz von VLAN 1 gehoert zu VLAN 1.
          ["192.0.2.128/25", 1, "Verwaltung", null, null],
          ["192.0.2.200/30", 1, "Verwaltung", "vlan40", "192.0.2.201"],
          // Nur geroutet erreichbar: ohne Interface.
          ["198.51.100.0/24", 30, "Kameras", null, null],
        ],
      );
      assert.equal(netmap.subnetHosts(subnets[1]).length, 126);
      assert.equal(netmap.subnetHosts(subnets[2]).length, 2);
      assert.deepEqual(netmap.subnetHosts(subnets[2]), ["192.0.2.201", "192.0.2.202"]);
      assert.equal(netmap.subnetForIp("198.51.100.40", subnets)?.vlanName, "Kameras");
      assert.equal(netmap.subnetForIp("192.0.2.130", subnets)?.cidr, "192.0.2.0/24");
      assert.equal(netmap.subnetForIp("198.51.100.40", subnets.slice(0, 3)), null);
      assert.equal(netmap.subnetForIp("kein-ip", subnets), null);
    },
  );
});

test("Bekannte Subnetze: HUB_SCAN_EXCLUDE nimmt VLANs heraus, Netze ohne VLAN bleiben", () => {
  withEnv(
    {
      HUB_VLANS: "1:Verwaltung:192.0.2.0/24,30:Kameras:198.51.100.0/24",
      HUB_SCAN_EXCLUDE: "30, x, 0",
    },
    () => {
      assert.deepEqual(
        netmap.knownSubnets().map((s) => s.cidr),
        ["192.0.2.0/24", "192.0.2.200/30"],
      );
    },
  );
  withEnv({ HUB_SCAN_EXCLUDE: "1" }, () => {
    // Ohne HUB_VLANS haben die Interfaces kein VLAN und bleiben.
    assert.deepEqual(
      netmap.knownSubnets().map((s) => [s.cidr, s.vlanId]),
      [
        ["192.0.2.0/24", null],
        ["192.0.2.200/30", null],
      ],
    );
  });
});
