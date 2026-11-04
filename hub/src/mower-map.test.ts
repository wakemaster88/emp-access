import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCloudMap } from "./mower-map.js";

const square = (lon: number, lat: number, d: number) => [
  [lon, lat],
  [lon + d, lat],
  [lon + d, lat + d],
  [lon, lat + d],
  [lon, lat],
];

test("Zonen, Hindernisse und Station landen in Bildkoordinaten", () => {
  const map = buildCloudMap({
    areas: {
      features: [
        { geometry: { type: "Polygon", coordinates: [square(8.0, 52.0, 0.001)] }, properties: { type_name: "area", title: "Zone 1" } },
        { geometry: { type: "Polygon", coordinates: [square(8.0004, 52.0004, 0.0001)] }, properties: { type_name: "obstacle" } },
        { geometry: { type: "LineString", coordinates: [[8.0, 52.0], [8.001, 52.001]] }, properties: { type_name: "path" } },
      ],
    },
    dock: { lat: 52.0, lon: 8.0 },
  });
  assert.ok(map);
  assert.equal(map.w, 1000);
  assert.equal(map.areas.length, 1);
  assert.equal(map.areas[0].name, "Zone 1");
  assert.equal(map.obstacles.length, 1);
  assert.equal(map.paths.length, 1);
  // Doppelter Schlusspunkt wird nicht entfernt, aber direkt aufeinanderfolgende Duplikate schon.
  for (const p of map.areas[0].pts.split(" ")) {
    const [x, y] = p.split(",").map(Number);
    assert.ok(x >= 0 && x <= map.w && y >= 0 && y <= map.h, `Punkt ${p} ausserhalb`);
  }
  // Station liegt in der linken unteren Ecke der Zone (Norden ist oben).
  assert.ok(map.dock);
  const [dx, dy] = map.dock;
  assert.ok(dx < map.w / 2 && dy > map.h / 2);
  // Projektion fuer Live-Position: Station wieder auf dieselbe Stelle.
  const { kx, minX, minY, scale, offX, offY } = map.proj!;
  const px = (8.0 * kx - minX) * scale + offX;
  const py = map.h - ((52.0 - minY) * scale + offY);
  assert.ok(Math.abs(px - dx) < 0.2 && Math.abs(py - dy) < 0.2);
});

test("ohne Zonen keine Karte", () => {
  assert.equal(buildCloudMap({ areas: { features: [] }, dock: null }), null);
  assert.equal(buildCloudMap(null), null);
});
