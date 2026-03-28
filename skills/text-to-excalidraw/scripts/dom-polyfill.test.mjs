import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { withDOMPolyfill, getExcalidrawAssetDir } from "./dom-polyfill.js";

test("getExcalidrawAssetDir returns an existing directory path", () => {
  const dir = getExcalidrawAssetDir();
  assert.equal(typeof dir, "string");
  assert.ok(dir.includes("assets"), `expected 'assets' in path, got: ${dir}`);
  assert.ok(existsSync(dir), `assets directory does not exist: ${dir}`);
});

test("getExcalidrawAssetDir result is cached (same reference)", () => {
  const a = getExcalidrawAssetDir();
  const b = getExcalidrawAssetDir();
  assert.equal(a, b);
});

test("withDOMPolyfill installs window on globalThis during callback", async () => {
  assert.equal(typeof globalThis.window, "undefined");
  let seen;
  await withDOMPolyfill(async () => { seen = typeof globalThis.window; });
  assert.equal(seen, "object");
  assert.equal(typeof globalThis.window, "undefined");
});

test("withDOMPolyfill installs Path2D on globalThis during callback", async () => {
  assert.equal(typeof globalThis.Path2D, "undefined");
  let seen;
  await withDOMPolyfill(async () => { seen = typeof globalThis.Path2D; });
  assert.equal(seen, "function");
  assert.equal(typeof globalThis.Path2D, "undefined");
});

test("withDOMPolyfill installs document.fonts.check() returning true", async () => {
  let result;
  await withDOMPolyfill(async () => {
    result = globalThis.document.fonts.check("16px sans-serif");
  });
  assert.equal(result, true);
});

test("withDOMPolyfill restores globals even when callback throws", async () => {
  await assert.rejects(
    () => withDOMPolyfill(async () => { throw new Error("intentional"); }),
    /intentional/
  );
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(typeof globalThis.Path2D, "undefined");
});

test("withDOMPolyfill serializes concurrent calls", async () => {
  const order = [];
  await Promise.all([
    withDOMPolyfill(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("a-end");
    }),
    withDOMPolyfill(async () => {
      order.push("b-start");
      order.push("b-end");
    }),
  ]);
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
});
