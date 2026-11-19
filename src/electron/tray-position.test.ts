import assert from "node:assert/strict";
import test from "node:test";
import { computeTrayPanelPosition } from "./tray-position.js";

const panel = { width: 256, height: 226 };

test("places the panel above a bottom taskbar icon", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const icon = { x: 1800, y: 1040, width: 24, height: 24 };
  assert.deepEqual(computeTrayPanelPosition(icon, panel, workArea), { x: 1656, y: 806 });
});

test("places the panel below a top menu bar icon", () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };
  const icon = { x: 1200, y: 0, width: 24, height: 24 };
  assert.deepEqual(computeTrayPanelPosition(icon, panel, workArea), { x: 1084, y: 33 });
});

test("clamps the panel inside the work area near the right edge", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const icon = { x: 1910, y: 1040, width: 10, height: 10 };
  assert.deepEqual(computeTrayPanelPosition(icon, panel, workArea), { x: 1656, y: 806 });
});
