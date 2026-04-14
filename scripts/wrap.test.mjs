import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapElements } from "./wrap.js";

test("wrapElements returns valid excalidraw structure", () => {
  const elements = [{ id: "abc", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }];
  const result = wrapElements(elements);

  assert.equal(result.type, "excalidraw");
  assert.equal(result.version, 2);
  assert.equal(result.source, "https://excalidraw.com");
  assert.deepEqual(result.elements, elements);
  assert.deepEqual(result.files, {});
});

test("wrapElements appState has required fields", () => {
  const result = wrapElements([]);
  assert.ok("viewBackgroundColor" in result.appState);
  assert.equal(result.appState.viewBackgroundColor, "#ffffff");
  assert.ok("gridSize" in result.appState);
  assert.equal(result.appState.gridSize, null);
});

test("wrapElements throws TypeError when elements is not an array", () => {
  assert.throws(() => wrapElements(null), TypeError);
  assert.throws(() => wrapElements("string"), TypeError);
  assert.throws(() => wrapElements({ type: "rectangle" }), TypeError);
});

test("wrapElements accepts custom appState overrides", () => {
  const result = wrapElements([], { viewBackgroundColor: "#1e1e2e" });
  assert.equal(result.appState.viewBackgroundColor, "#1e1e2e");
});

test("wrapElements with empty elements produces valid file", () => {
  const result = wrapElements([]);
  assert.ok(Array.isArray(result.elements));
  assert.equal(result.elements.length, 0);
});
