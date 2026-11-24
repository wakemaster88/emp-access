import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { startVisiblePolling, type VisibilitySource } from "./visible-polling";

function fakeSource(hidden = false) {
  const listeners = new Set<() => void>();
  const src = {
    hidden,
    addEventListener: (_: "visibilitychange", l: () => void) => void listeners.add(l),
    removeEventListener: (_: "visibilitychange", l: () => void) => void listeners.delete(l),
    set(h: boolean) {
      src.hidden = h;
      for (const l of listeners) l();
    },
    listeners,
  };
  return src as VisibilitySource & { hidden: boolean; set(h: boolean): void; listeners: Set<() => void> };
}

test("sichtbar: sofort und dann im Takt", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const src = fakeSource();
    let n = 0;
    const stop = startVisiblePolling(() => n++, 1000, { source: src });
    assert.equal(n, 1);
    mock.timers.tick(3000);
    assert.equal(n, 4);
    stop();
    mock.timers.tick(3000);
    assert.equal(n, 4);
    assert.equal(src.listeners.size, 0);
  } finally {
    mock.timers.reset();
  }
});

test("Hintergrund pausiert, Zurückkommen ruft sofort ab", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const src = fakeSource();
    let n = 0;
    const stop = startVisiblePolling(() => n++, 1000, { source: src });
    src.set(true);
    mock.timers.tick(10_000);
    assert.equal(n, 1);
    src.set(false);
    assert.equal(n, 2);
    mock.timers.tick(1000);
    assert.equal(n, 3);
    // Doppeltes "sichtbar" startet keinen zweiten Takt.
    src.set(false);
    mock.timers.tick(1000);
    assert.equal(n, 4);
    stop();
  } finally {
    mock.timers.reset();
  }
});

test("runOnStart false und Start im Hintergrund", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const src = fakeSource(true);
    let n = 0;
    const stop = startVisiblePolling(() => n++, 1000, { source: src, runOnStart: false });
    mock.timers.tick(5000);
    assert.equal(n, 0);
    src.set(false);
    assert.equal(n, 1);
    mock.timers.tick(2000);
    assert.equal(n, 3);
    stop();
  } finally {
    mock.timers.reset();
  }
});
