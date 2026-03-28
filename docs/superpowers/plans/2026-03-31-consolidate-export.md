# Consolidate Export Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `excalidraw-exporter` into `excalidraw-converter` — one package, two CLIs (`wrap.js` + `convert.js`), all export deps installed by default, PNG font rendering fixed.

**Architecture:** `wrap.js` (zero-dep, stdin → .excalidraw) and `convert.js` (.excalidraw → SVG/PNG) share one package directory. `dom-polyfill.js` sets up JSDOM globals + Path2D/FontFace stubs + a font-proxy fetch, which `convert.js` calls via `withDOMPolyfill()` before importing `@excalidraw/utils`. resvg receives `fontDirs` pointing at `@excalidraw/utils`'s bundled TTF assets so PNG text renders correctly.

**Tech Stack:** Node.js ≥ 18, `@excalidraw/utils@0.1.3-test32`, `@resvg/resvg-js^2.6.2`, `jsdom^28.1.0`, Node built-in test runner.

---

### Task 1: Update package.json and install deps

**Files:**
- Modify: `tools/excalidraw-converter/package.json`

- [ ] **Step 1: Replace package.json with new content**

```json
{
  "name": "excalidraw-converter",
  "version": "2.0.0",
  "description": "CLI tools: wrap Excalidraw elements JSON into .excalidraw; export .excalidraw to SVG/PNG",
  "type": "module",
  "main": "wrap.js",
  "scripts": {
    "test": "node --test"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@excalidraw/utils": "0.1.3-test32",
    "@resvg/resvg-js": "^2.6.2",
    "jsdom": "^28.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run from repo root:
```bash
npm install --prefix tools/excalidraw-converter
```

Expected: `node_modules` directory created under `tools/excalidraw-converter/`, no errors.

- [ ] **Step 3: Verify existing wrap tests still pass**

```bash
cd tools/excalidraw-converter && node --test wrap.test.mjs
```

Expected output contains: `pass 5` and `fail 0`

- [ ] **Step 4: Commit**

```bash
git add tools/excalidraw-converter/package.json tools/excalidraw-converter/package-lock.json
git commit -m "feat: add @excalidraw/utils, @resvg/resvg-js, jsdom to excalidraw-converter"
```

---

### Task 2: Create dom-polyfill.js (TDD)

**Files:**
- Create: `tools/excalidraw-converter/dom-polyfill.test.mjs`
- Create: `tools/excalidraw-converter/dom-polyfill.js`

- [ ] **Step 1: Write the failing tests**

Create `tools/excalidraw-converter/dom-polyfill.test.mjs`:

```mjs
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd tools/excalidraw-converter && node --test dom-polyfill.test.mjs
```

Expected: error `Cannot find module './dom-polyfill.js'` — the file does not exist yet.

- [ ] **Step 3: Create dom-polyfill.js**

Create `tools/excalidraw-converter/dom-polyfill.js`:

```js
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const FONT_PROXY_BASE = "https://excalidraw-fonts.local/";

let cachedAssetsDir = null;
let exportScopeQueue = Promise.resolve();

/**
 * Returns the directory containing @excalidraw/utils bundled TTF font assets.
 * resvg-js cannot parse CSS @font-face, so we pass this dir via fontDirs.
 * Result is cached after first call.
 */
export function getExcalidrawAssetDir() {
  if (cachedAssetsDir) return cachedAssetsDir;
  const utilsEntry = require.resolve("@excalidraw/utils");
  cachedAssetsDir = resolve(dirname(utilsEntry), "assets");
  return cachedAssetsDir;
}

/**
 * Runs callback with browser globals temporarily installed on globalThis.
 * Calls are serialized via a promise queue so concurrent exports don't race.
 */
export async function withDOMPolyfill(callback) {
  const previousRun = exportScopeQueue;
  let releaseQueue;
  exportScopeQueue = new Promise((res) => { releaseQueue = res; });
  await previousRun;
  try {
    const restore = await installDOMPolyfill();
    try {
      return await callback();
    } finally {
      restore();
    }
  } finally {
    releaseQueue();
  }
}

async function installDOMPolyfill() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://localhost",
    pretendToBeVisual: true,
  });

  const restoreGlobals = [];
  const assetsDir = getExcalidrawAssetDir();
  const doc = dom.window.document;

  class Path2DImpl {
    constructor(path) { this.d = path || ""; }
    addPath() {} moveTo() {} lineTo() {}
    bezierCurveTo() {} quadraticCurveTo() {}
    arc() {} arcTo() {} ellipse() {} rect() {} closePath() {}
  }

  class FontFaceImpl {
    constructor(family, source, descriptors = {}) {
      this.family = family;
      this.source = typeof source === "string" ? source : "arraybuffer";
      this.descriptors = descriptors;
      this.status = "loaded";
      this.display = descriptors.display || "swap";
      this.style = descriptors.style || "normal";
      this.weight = descriptors.weight || "400";
      this.unicodeRange = descriptors.unicodeRange || "U+0000-FFFF";
      this.featureSettings = descriptors.featureSettings || "";
      this.loaded = Promise.resolve(this);
    }
    load() { return Promise.resolve(this); }
  }

  const fontSet = new Set();
  const fontFaceSet = {
    add(face) { fontSet.add(face); },
    has(face) { return fontSet.has(face); },
    delete(face) { return fontSet.delete(face); },
    check() { return true; },
    load() { return Promise.resolve([]); },
    forEach(cb) { fontSet.forEach(cb); },
    get size() { return fontSet.size; },
    get status() { return "loaded"; },
    ready: Promise.resolve(),
    [Symbol.iterator]() { return fontSet[Symbol.iterator](); },
  };

  Object.defineProperty(doc, "fonts", {
    value: fontFaceSet, writable: true, configurable: true,
  });

  // Tell @excalidraw/utils to load fonts through our proxy URL
  dom.window.EXCALIDRAW_ASSET_PATH = FONT_PROXY_BASE;

  const originalFetch = globalThis.fetch?.bind(globalThis);
  const fetchOverride = async (input, init) => {
    const url = typeof input === "string" ? input
      : input instanceof URL ? input.href
      : input.url;
    if (url.startsWith(FONT_PROXY_BASE)) {
      const fontFile = decodeURIComponent(url.slice(FONT_PROXY_BASE.length));
      // Prevent path traversal
      if (fontFile.includes("..") || fontFile.startsWith("/") || fontFile.includes("\\")) {
        return new Response(null, { status: 400, statusText: "Invalid font path" });
      }
      const fontPath = resolve(assetsDir, fontFile);
      try {
        const data = await readFile(fontPath);
        return new Response(data, { status: 200, headers: { "Content-Type": "font/ttf" } });
      } catch {
        return new Response(null, { status: 404, statusText: "Font not found" });
      }
    }
    if (!originalFetch) throw new Error("fetch is not available in this Node runtime");
    return originalFetch(input, init);
  };

  function overrideGlobal(key, value) {
    const g = globalThis;
    const existing = Object.getOwnPropertyDescriptor(g, key);
    if (existing && existing.configurable === false) {
      if ("writable" in existing && existing.writable) {
        const prev = g[key];
        g[key] = value;
        return () => { g[key] = prev; };
      }
      throw new Error(`Cannot temporarily override globalThis.${key}`);
    }
    Object.defineProperty(g, key, { configurable: true, writable: true, value });
    return () => {
      if (existing) { Object.defineProperty(g, key, existing); return; }
      delete g[key];
    };
  }

  restoreGlobals.push(overrideGlobal("window", dom.window));
  restoreGlobals.push(overrideGlobal("document", doc));
  restoreGlobals.push(overrideGlobal("navigator", dom.window.navigator));
  restoreGlobals.push(overrideGlobal("DOMParser", dom.window.DOMParser));
  restoreGlobals.push(overrideGlobal("Node", dom.window.Node));
  restoreGlobals.push(overrideGlobal("devicePixelRatio", 1));
  restoreGlobals.push(overrideGlobal("Path2D", Path2DImpl));
  restoreGlobals.push(overrideGlobal("FontFace", FontFaceImpl));
  restoreGlobals.push(overrideGlobal("fetch", fetchOverride));

  return () => {
    for (let i = restoreGlobals.length - 1; i >= 0; i--) restoreGlobals[i]();
    dom.window.close();
  };
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd tools/excalidraw-converter && node --test dom-polyfill.test.mjs
```

Expected: `pass 7`, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add tools/excalidraw-converter/dom-polyfill.js tools/excalidraw-converter/dom-polyfill.test.mjs
git commit -m "feat: add dom-polyfill.js — JSDOM globals + Path2D/FontFace/fetch for @excalidraw/utils"
```

---

### Task 3: Rewrite convert.test.mjs (write failing tests first)

**Files:**
- Modify: `tools/excalidraw-converter/convert.test.mjs`

The current `convert.test.mjs` tests stdin → .excalidraw behavior. These tests are incompatible with the new `convert.js` interface (file input → SVG/PNG). Replace the file entirely.

- [ ] **Step 1: Replace convert.test.mjs**

Overwrite `tools/excalidraw-converter/convert.test.mjs`:

```mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { wrapElements } from "./wrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "convert.js");

const SAMPLE_ELEMENTS = [
  {
    id: "r1", type: "rectangle", x: 100, y: 100, width: 200, height: 80,
    strokeColor: "#1e1e1e", backgroundColor: "#e7f5ff", fillStyle: "solid",
    strokeWidth: 2, roughness: 1, opacity: 100, angle: 0, version: 1,
    versionNonce: 1, isDeleted: false, groupIds: [], boundElements: [], updated: 1,
    link: null, locked: false,
  },
  {
    id: "t1", type: "text", x: 108, y: 128, width: 184, height: 44,
    text: "Hello", fontSize: 20, fontFamily: 1,
    textAlign: "center", verticalAlign: "middle", containerId: "r1",
    originalText: "Hello", lineHeight: 1.25,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, roughness: 1, opacity: 100, angle: 0, version: 1,
    versionNonce: 2, isDeleted: false, groupIds: [], boundElements: [], updated: 1,
    link: null, locked: false,
  },
];

function makeTempExcalidraw() {
  const dir = mkdtempSync(join(tmpdir(), "excalidraw-test-"));
  const filePath = join(dir, "test.excalidraw");
  writeFileSync(filePath, JSON.stringify(wrapElements(SAMPLE_ELEMENTS)), "utf8");
  return filePath;
}

// ── Error handling (no heavy deps needed) ──────────────────────────────────

test("exits with code 1 and prints Usage when no input file given", () => {
  const result = spawnSync("node", [CLI], { encoding: "utf8" });
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
  assert.ok(result.stderr.includes("Usage:"), `expected 'Usage:' in stderr: ${result.stderr}`);
});

test("exits with code 1 when input file does not exist", () => {
  const result = spawnSync("node", [CLI, "/nonexistent/missing.excalidraw"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("Cannot read input file"), `stderr: ${result.stderr}`);
});

test("exits with code 1 for unknown --format value", () => {
  const inputFile = makeTempExcalidraw();
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "gif"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("Unknown format"), `stderr: ${result.stderr}`);
  } finally {
    unlinkSync(inputFile);
  }
});

// ── Integration tests (require installed npm deps) ─────────────────────────

test("exports valid SVG from .excalidraw file", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const outFile = inputFile.replace(".excalidraw", ".svg");
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "svg", "--out", outFile], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(outFile), "SVG output file should exist");
    const svg = readFileSync(outFile, "utf8");
    assert.ok(svg.trimStart().startsWith("<svg"), `SVG should start with <svg, got: ${svg.slice(0, 80)}`);
    assert.ok(svg.includes("</svg>"), "SVG should close with </svg>");
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  }
});

test("exports valid PNG from .excalidraw file", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const outFile = inputFile.replace(".excalidraw", ".png");
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "png", "--out", outFile], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(outFile), "PNG output file should exist");
    const buf = readFileSync(outFile);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    assert.equal(buf[0], 0x89, "byte 0 should be 0x89");
    assert.equal(buf[1], 0x50, "byte 1 should be 0x50 (P)");
    assert.equal(buf[2], 0x4e, "byte 2 should be 0x4E (N)");
    assert.equal(buf[3], 0x47, "byte 3 should be 0x47 (G)");
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  }
});

test("auto-derives output path when --out is omitted", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const expectedOut = inputFile.replace(".excalidraw", ".svg");
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "svg"], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(expectedOut), "auto-named output file should exist");
    assert.ok(result.stdout.includes(expectedOut), `stdout should mention output path: ${result.stdout}`);
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(expectedOut)) unlinkSync(expectedOut);
  }
});

test("--scale 2 produces a larger PNG than --scale 1", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const out1x = inputFile.replace(".excalidraw", "-1x.png");
  const out2x = inputFile.replace(".excalidraw", "-2x.png");
  try {
    spawnSync("node", [CLI, inputFile, "--format", "png", "--scale", "1", "--out", out1x], {
      encoding: "utf8", timeout: 60000,
    });
    spawnSync("node", [CLI, inputFile, "--format", "png", "--scale", "2", "--out", out2x], {
      encoding: "utf8", timeout: 60000,
    });
    assert.ok(existsSync(out1x) && existsSync(out2x), "both PNG files should exist");
    const size1 = readFileSync(out1x).length;
    const size2 = readFileSync(out2x).length;
    assert.ok(size2 > size1, `2x PNG (${size2}B) should be larger than 1x PNG (${size1}B)`);
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(out1x)) unlinkSync(out1x);
    if (existsSync(out2x)) unlinkSync(out2x);
  }
});

test("--dark flag is accepted without error", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const outFile = inputFile.replace(".excalidraw", "-dark.svg");
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "svg", "--dark", "--out", outFile], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(outFile), "dark SVG output should exist");
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  }
});
```

- [ ] **Step 2: Run tests to confirm they fail against old convert.js**

```bash
cd tools/excalidraw-converter && node --test convert.test.mjs
```

Expected: "exits with code 1 and prints Usage when no input file given" should **fail** (old convert.js prints `Error reading stdin`, not `Usage:`). The integration tests should also fail or time out. This confirms the tests describe new behavior.

- [ ] **Step 3: Commit**

```bash
git add tools/excalidraw-converter/convert.test.mjs
git commit -m "test: rewrite convert.test.mjs for new file-input export interface"
```

---

### Task 4: Rewrite convert.js

**Files:**
- Modify: `tools/excalidraw-converter/convert.js`

- [ ] **Step 1: Replace convert.js**

Overwrite `tools/excalidraw-converter/convert.js`:

```js
#!/usr/bin/env node
/**
 * convert.js — Export a .excalidraw file to SVG or PNG.
 *
 * Usage:
 *   node convert.js <input.excalidraw> [--format svg|png] [--out <path>]
 *   node convert.js <input.excalidraw> --format png --scale 2 --dark
 *   node convert.js <input.excalidraw> --format svg --padding 30 --background-color "#f0f0f0"
 *   node convert.js <input.excalidraw> --format png --no-background
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolve, parse, format } from "node:path";
import { withDOMPolyfill, getExcalidrawAssetDir } from "./dom-polyfill.js";

function swapExtension(filePath, newExt) {
  const parsed = parse(filePath);
  return format({ ...parsed, base: undefined, ext: `.${newExt}` });
}

async function renderSvg(diagram, opts) {
  const { exportToSvg } = await import("@excalidraw/utils");
  const appState = {
    ...diagram.appState,
    exportBackground: opts.exportBackground,
    viewBackgroundColor: opts.viewBackgroundColor ?? diagram.appState?.viewBackgroundColor ?? "#ffffff",
    exportWithDarkMode: opts.dark ?? false,
    exportEmbedScene: false,
  };
  const svg = await exportToSvg({
    elements: diagram.elements ?? [],
    appState,
    files: diagram.files ?? {},
    exportPadding: opts.padding ?? 20,
  });
  return svg.outerHTML;
}

async function exportSvg(diagram, opts) {
  return withDOMPolyfill(async () => {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      const msg = String(args[0] || "");
      if (msg.includes("font-face") || msg.includes("Path2D")) return;
      originalConsoleError.apply(console, args);
    };
    try {
      return await renderSvg(diagram, opts);
    } finally {
      console.error = originalConsoleError;
    }
  });
}

async function exportPng(diagram, opts) {
  const svgString = await exportSvg(diagram, opts);
  const { Resvg } = await import("@resvg/resvg-js");

  const widthMatch = svgString.match(/width="([^"]+)"/);
  const naturalWidth = widthMatch ? parseFloat(widthMatch[1]) : 800;
  const scale = typeof opts.scale === "number" && Number.isFinite(opts.scale)
    ? Math.min(Math.max(opts.scale, 0.1), 10) : 1;
  const scaledWidth = Math.max(1, Math.round(naturalWidth * scale));

  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: scaledWidth },
    background: opts.exportBackground !== false
      ? (opts.viewBackgroundColor ?? "#ffffff")
      : undefined,
    font: { loadSystemFonts: false, fontDirs: [getExcalidrawAssetDir()] },
  });
  return resvg.render().asPng();
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      format:             { type: "string",  short: "f", default: "svg" },
      out:                { type: "string",  short: "o" },
      scale:              { type: "string",  default: "1" },
      dark:               { type: "boolean", default: false },
      padding:            { type: "string",  default: "20" },
      "no-background":    { type: "boolean", default: false },
      "background-color": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });

  const [inputRel] = positionals;
  if (!inputRel) {
    process.stderr.write(
      "Usage: node convert.js <input.excalidraw> [--format svg|png] [--out <path>]\n" +
      "       [--scale 2] [--dark] [--padding 20] [--no-background] [--background-color #ffffff]\n"
    );
    process.exit(1);
  }

  const { format } = values;
  if (format !== "svg" && format !== "png") {
    process.stderr.write(`Unknown format: "${format}". Use --format svg or --format png\n`);
    process.exit(1);
  }

  const absInput = resolve(inputRel);
  const absOut = values.out ? resolve(values.out) : swapExtension(absInput, format);

  let diagram;
  try {
    diagram = JSON.parse(readFileSync(absInput, "utf8"));
  } catch (e) {
    process.stderr.write(`Cannot read input file: ${e.message}\n`);
    process.exit(1);
  }

  const opts = {
    dark: values.dark,
    padding: parseInt(values.padding, 10) || 20,
    scale: parseFloat(values.scale) || 1,
    exportBackground: !values["no-background"],
    viewBackgroundColor: values["background-color"],
  };

  if (format === "svg") {
    const svgString = await exportSvg(diagram, opts);
    writeFileSync(absOut, svgString, "utf8");
  } else {
    const pngBuffer = await exportPng(diagram, opts);
    writeFileSync(absOut, pngBuffer);
  }

  process.stdout.write(`Exported: ${absOut}\n`);
}

main().catch((e) => {
  process.stderr.write(`Error: ${e.message || e}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Run the full test suite**

```bash
cd tools/excalidraw-converter && node --test
```

Expected: all tests pass — `wrap.test.mjs` (5), `dom-polyfill.test.mjs` (7), `convert.test.mjs` (8). Integration tests may take up to 30s each. Total: `pass 20`, `fail 0`.

> Note: If `@excalidraw/utils` emits console warnings about fonts or Path2D during the integration tests, that is expected — `convert.js` suppresses them internally. Test output should still show pass.

- [ ] **Step 3: Commit**

```bash
git add tools/excalidraw-converter/convert.js
git commit -m "feat: rewrite convert.js — .excalidraw to SVG/PNG with proper font support"
```

---

### Task 5: Update install.sh

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Replace install_tool function** (add rm -rf + npm install, fix overwrite bug)

Find this block in `install.sh`:
```bash
# ── 安装 CLI 工具 ─────────────────────────────────────────
install_tool() {
  local tool_name="excalidraw-converter"
  local src="$REPO_DIR/tools/$tool_name"
  local dst="$TOOLS_TARGET/$tool_name"

  mkdir -p "$TOOLS_TARGET"

  if [ -d "$dst" ]; then
    warn "Tool '$tool_name' 已存在，正在覆盖..."
  fi

  cp -r "$src" "$dst"
  info "Tool 已安装到 $dst ✓"
}
```

Replace with:
```bash
# ── 安装 CLI 工具 ─────────────────────────────────────────
install_tool() {
  local tool_name="excalidraw-converter"
  local src="$REPO_DIR/tools/$tool_name"
  local dst="$TOOLS_TARGET/$tool_name"

  mkdir -p "$TOOLS_TARGET"

  if [ -d "$dst" ]; then
    warn "Tool '$tool_name' 已存在，正在覆盖..."
    rm -rf "$dst"
  fi

  cp -r "$src" "$dst"
  info "正在安装 npm 依赖（@excalidraw/utils + @resvg/resvg-js + jsdom）..."
  npm install --prefix "$dst" --omit=dev 2>&1 | tail -3
  info "Tool 已安装到 $dst ✓"
}
```

- [ ] **Step 2: Delete install_export_tools function and the export-tools case**

Remove this entire function:
```bash
# ── 安装导出工具 ──────────────────────────────────────────
install_export_tools() {
  local tool_name="excalidraw-exporter"
  local src="$REPO_DIR/tools/$tool_name"
  local dst="$TOOLS_TARGET/$tool_name"

  mkdir -p "$TOOLS_TARGET"

  if [ -d "$dst" ]; then
    warn "Tool '$tool_name' 已存在，正在覆盖..."
    rm -rf "$dst"
  fi

  cp -r "$src" "$dst"
  info "正在安装 npm 依赖（excalidraw-to-svg + @resvg/resvg-js）..."
  npm install --prefix "$dst" --omit=dev 2>&1 | tail -3
  info "excalidraw-exporter 已安装到 $dst ✓"
}
```

And remove this case from the `case` block:
```bash
  export-tools)
    check_deps
    install_export_tools
    echo ""
    info "导出工具安装完成！"
    echo ""
    echo "  SVG 导出: node ~/.claude/tools/excalidraw-exporter/export.js ./output.excalidraw --format svg"
    echo "  PNG 导出: node ~/.claude/tools/excalidraw-exporter/export.js ./output.excalidraw --format png"
    echo ""
    ;;
```

- [ ] **Step 3: Update verify function** (test wrap.js instead of convert.js for stdin, add dom-polyfill.js check)

Find:
```bash
# ── 验证安装 ──────────────────────────────────────────────
verify() {
  local skill="$SKILLS_TARGET/text-to-excalidraw/SKILL.md"
  local converter="$TOOLS_TARGET/excalidraw-converter/convert.js"
  local wrap="$TOOLS_TARGET/excalidraw-converter/wrap.js"

  [ -f "$skill" ]     || error "Skill 文件未找到: $skill"
  [ -f "$converter" ] || error "CLI 工具未找到: $converter"
  [ -f "$wrap" ]      || error "wrap.js 未找到: $wrap"

  # 快速功能测试
  local out
  out=$(echo '[{"id":"v1","type":"rectangle","x":0,"y":0,"width":10,"height":10}]' \
    | node "$converter" 2>&1)

  if echo "$out" | grep -q '"type": "excalidraw"'; then
    info "功能验证通过 ✓"
  else
    error "功能验证失败，converter 输出异常:\n$out"
  fi
}
```

Replace with:
```bash
# ── 验证安装 ──────────────────────────────────────────────
verify() {
  local skill="$SKILLS_TARGET/text-to-excalidraw/SKILL.md"
  local wrap="$TOOLS_TARGET/excalidraw-converter/wrap.js"
  local converter="$TOOLS_TARGET/excalidraw-converter/convert.js"
  local polyfill="$TOOLS_TARGET/excalidraw-converter/dom-polyfill.js"

  [ -f "$skill" ]    || error "Skill 文件未找到: $skill"
  [ -f "$wrap" ]     || error "wrap.js 未找到: $wrap"
  [ -f "$converter" ] || error "convert.js 未找到: $converter"
  [ -f "$polyfill" ] || error "dom-polyfill.js 未找到: $polyfill"

  # 快速功能测试（wrap）
  local out
  out=$(echo '[{"id":"v1","type":"rectangle","x":0,"y":0,"width":10,"height":10}]' \
    | node "$wrap" 2>&1)

  if echo "$out" | grep -q '"type": "excalidraw"'; then
    info "功能验证通过 ✓"
  else
    error "功能验证失败，wrap 输出异常:\n$out"
  fi
}
```

- [ ] **Step 4: Update install completion message** (remove export-tools hint)

Find in the `install)` case:
```bash
    echo "  使用方式（Claude Code / OpenCode）："
    echo "    /text-to-excalidraw 画一个登录流程图"
    echo "    或直接描述: 帮我画一张微服务架构图"
    echo ""
```

Replace with:
```bash
    echo "  使用方式（Claude Code / OpenCode）："
    echo "    /text-to-excalidraw 画一个登录流程图"
    echo "    或直接描述: 帮我画一张微服务架构图"
    echo ""
    echo "  导出 SVG/PNG："
    echo "    node ~/.claude/tools/excalidraw-converter/convert.js ./output.excalidraw --format svg"
    echo "    node ~/.claude/tools/excalidraw-converter/convert.js ./output.excalidraw --format png --scale 2"
    echo ""
```

- [ ] **Step 5: Update the uninstall function** (remove excalidraw-exporter)

Find:
```bash
uninstall() {
  info "卸载 text-to-excalidraw skill 和相关工具..."
  rm -rf "$SKILLS_TARGET/text-to-excalidraw"
  rm -rf "$TOOLS_TARGET/excalidraw-converter"
  rm -rf "$TOOLS_TARGET/excalidraw-exporter"
  info "卸载完成"
}
```

Replace with:
```bash
uninstall() {
  info "卸载 text-to-excalidraw skill 和相关工具..."
  rm -rf "$SKILLS_TARGET/text-to-excalidraw"
  rm -rf "$TOOLS_TARGET/excalidraw-converter"
  info "卸载完成"
}
```

- [ ] **Step 6: Update the help text** (remove export-tools line)

Find in the `*)` case:
```bash
    echo "  install            安装到 Claude Code / OpenCode（默认）"
    echo "  openclaw           安装到 OpenClaw"
    echo "  export-tools       安装 SVG/PNG 导出工具（可选）"
    echo "  uninstall          卸载 Claude Code / OpenCode 版本"
    echo "  uninstall-openclaw 卸载 OpenClaw 版本"
    echo "  verify             验证安装是否正确"
    echo "  test               只运行单元测试"
```

Replace with:
```bash
    echo "  install            安装到 Claude Code / OpenCode（默认）"
    echo "  openclaw           安装到 OpenClaw"
    echo "  uninstall          卸载 Claude Code / OpenCode 版本"
    echo "  uninstall-openclaw 卸载 OpenClaw 版本"
    echo "  verify             验证安装是否正确"
    echo "  test               只运行单元测试"
```

- [ ] **Step 7: Commit**

```bash
git add install.sh
git commit -m "feat: update install.sh — merge export into default install, remove export-tools command"
```

---

### Task 6: Update SKILL.md

**Files:**
- Modify: `skills/text-to-excalidraw/SKILL.md`

- [ ] **Step 1: Update Step 4 — Installation check**

Find:
```markdown
### Step 4 — Install CLI tool if needed

Before writing the file, check if the converter tool is installed:

```bash
test -f ~/.claude/tools/excalidraw-converter/convert.js && \
  test -f ~/.claude/tools/excalidraw-converter/wrap.js && \
  echo "installed" || echo "missing"
```

If missing, create these three files:

**`~/.claude/tools/excalidraw-converter/package.json`:**
```json
{"type":"module","name":"excalidraw-converter","version":"1.0.0"}
```

**`~/.claude/tools/excalidraw-converter/wrap.js`:**
```js
export function wrapElements(elements, appStateOverrides = {}) {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: { gridSize: null, viewBackgroundColor: "#ffffff", ...appStateOverrides },
    files: {},
  };
}
```

**`~/.claude/tools/excalidraw-converter/convert.js`:**
```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { wrapElements } from "./wrap.js";
function readStdin() { return readFileSync(0, "utf8").trim(); }
function main() {
  const { values } = parseArgs({ options: { out: { type: "string", short: "o" } }, strict: true });
  let raw;
  try { raw = readStdin(); } catch (e) { process.stderr.write(`Error reading stdin: ${e.message}\n`); process.exit(1); }
  let elements;
  try { elements = JSON.parse(raw); } catch (e) { process.stderr.write(`Invalid JSON input: ${e.message}\n`); process.exit(1); }
  if (!Array.isArray(elements)) { process.stderr.write("Input must be an array of Excalidraw elements\n"); process.exit(1); }
  const out = JSON.stringify(wrapElements(elements), null, 2);
  if (values.out) { writeFileSync(values.out, out, "utf8"); } else { process.stdout.write(out + "\n"); }
}
main();
```
```

Replace the entire Step 4 block with:

```markdown
### Step 4 — Install CLI tool if needed

Before writing the file, check if the tool is installed:

```bash
test -f ~/.claude/tools/excalidraw-converter/wrap.js && \
  test -f ~/.claude/tools/excalidraw-converter/convert.js && \
  echo "installed" || echo "missing"
```

If missing, tell the user to run `./install.sh` from the project root. The installer copies the tool files and runs `npm install` automatically. Export capabilities (SVG/PNG) are included in the default install — no separate step required.
```

- [ ] **Step 2: Update Step 5 — change convert.js to wrap.js**

Find in Step 5:
```bash
node ~/.claude/tools/excalidraw-converter/convert.js --out <output_path> < /tmp/elements.json
```

Replace with:
```bash
node ~/.claude/tools/excalidraw-converter/wrap.js --out <output_path> < /tmp/elements.json
```

- [ ] **Step 3: Replace Step 6 — Export to SVG / PNG**

Find the entire Step 6 block starting with `### Step 6 — Export to SVG / PNG (optional)` and ending just before `### Step 7`. Replace with:

```markdown
### Step 6 — Export to SVG / PNG (optional)

If the user requested SVG or PNG output, offer to export:

> "要导出为 SVG 或 PNG 吗？(Need SVG or PNG export?)"

**Export to SVG:**

```bash
node ~/.claude/tools/excalidraw-converter/convert.js <input.excalidraw> --format svg --out <output.svg>
```

**Export to PNG:**

```bash
node ~/.claude/tools/excalidraw-converter/convert.js <input.excalidraw> --format png --out <output.png>
```

**Additional options:**

| Option | Default | Description |
|---|---|---|
| `--scale <n>` | `1` | PNG resolution multiplier, e.g. `--scale 2` for 2× |
| `--dark` | off | Export with dark mode |
| `--padding <n>` | `20` | Padding around content in pixels |
| `--background-color <hex>` | `#ffffff` | Background color |
| `--no-background` | off | Transparent/no background (PNG) |

If `--out` is omitted, the output file is placed next to the input with the appropriate extension.

```

- [ ] **Step 4: Commit**

```bash
git add skills/text-to-excalidraw/SKILL.md
git commit -m "feat: update SKILL.md — use wrap.js for step 5, unified convert.js for export"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the entire CLAUDE.md content**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

`text-to-excalidraw` is an AI coding assistant skill and CLI tool that converts natural language descriptions into Excalidraw diagram files (`.excalidraw`). Compatible with Claude Code, OpenCode, and OpenClaw. It has two components:

1. **Skill** (`skills/text-to-excalidraw/SKILL.md`) — a slash command skill that orchestrates diagram generation (AgentSkills-compatible format)
2. **CLI** (`tools/excalidraw-converter/`) — Node.js CLI with two entry points: `wrap.js` (elements JSON → `.excalidraw`) and `convert.js` (`.excalidraw` → SVG/PNG)

## Platform Support

| Tool | Install Command | Skill Location |
|---|---|---|
| Claude Code | `./install.sh` | `~/.claude/skills/text-to-excalidraw/` |
| OpenCode | `./install.sh` | `~/.claude/skills/text-to-excalidraw/` (OpenCode reads this path natively) |
| OpenClaw | `./install.sh openclaw` | `~/.openclaw/skills/text-to-excalidraw/` |

## Commands

```bash
# Run tests
cd tools/excalidraw-converter && npm test

# Run tests (alternative)
cd tools/excalidraw-converter && node --test

# Install for Claude Code / OpenCode
./install.sh

# Install for OpenClaw
./install.sh openclaw

# Verify installation
./install.sh verify

# Uninstall (Claude Code / OpenCode)
./install.sh uninstall

# Uninstall (OpenClaw)
./install.sh uninstall-openclaw
```

## Architecture

Two-layer pipeline:

```
User description → [Skill: generate elements JSON] → [wrap.js: .excalidraw] → [convert.js: SVG / PNG]
```

**Skill layer** (`skills/text-to-excalidraw/SKILL.md`): AI analyzes the description, picks a layout strategy (Mermaid-style reasoning for structured diagrams, coordinate-based for free-layout), and generates an Excalidraw `elements` JSON array directly.

**CLI layer** (`tools/excalidraw-converter/`):
- `wrap.js` — CLI: reads elements JSON array from stdin, writes `.excalidraw` file. Imports nothing from npm.
- `convert.js` — CLI: reads `.excalidraw` file, exports to SVG or PNG. Options: `--format svg|png`, `--scale`, `--dark`, `--padding`, `--background-color`, `--no-background`
- `dom-polyfill.js` — shared module: installs JSDOM globals + Path2D/FontFace stubs + font-proxy fetch on `globalThis` for the duration of each export call; serializes concurrent calls via a promise queue
- Dependencies: `@excalidraw/utils` (SVG rendering + bundled TTF fonts), `@resvg/resvg-js` (SVG→PNG via pre-built WASM), `jsdom` (DOM environment)

**Installed locations:**
- Skill: `~/.claude/skills/text-to-excalidraw/`
- CLI: `~/.claude/tools/excalidraw-converter/`

## Key Constraints

- Node.js >= 18 required (uses built-in test runner and `--input-type=module`)
- `npm install` is run automatically by `install.sh` — required before using `convert.js`
- `wrap.js` imports nothing from npm packages — safe to run without `node_modules`
- `@resvg/resvg-js` uses pre-built WASM binaries — no native compilation required, cross-platform
- Excalidraw elements must be a JSON array; `wrap.js` throws `TypeError` on non-array input
- PNG font rendering: `@resvg/resvg-js` ignores CSS `@font-face` — bundled TTF fonts from `@excalidraw/utils/assets/` are passed via `fontDirs`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — two-component architecture, remove excalidraw-exporter references"
```

---

### Task 8: Delete excalidraw-exporter and final verification

**Files:**
- Delete: `tools/excalidraw-exporter/` (entire directory)

- [ ] **Step 1: Delete the excalidraw-exporter directory**

```bash
rm -rf tools/excalidraw-exporter
```

- [ ] **Step 2: Run the full test suite one final time**

```bash
cd tools/excalidraw-converter && node --test
```

Expected: `pass 20`, `fail 0`. All three test files pass: `wrap.test.mjs` (5), `dom-polyfill.test.mjs` (7), `convert.test.mjs` (8).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: remove excalidraw-exporter — export now built into excalidraw-converter"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Merge two tools into one package → Tasks 1–4
- ✅ `wrap.js` unchanged, zero-dep → Task 4 (`wrap.js` not touched)
- ✅ `convert.js` rewritten with proper DOM polyfill + fontDirs → Task 4
- ✅ `dom-polyfill.js` created → Task 2
- ✅ New options: `--scale`, `--dark`, `--padding`, `--background-color`, `--no-background` → Task 4
- ✅ Default install (no separate export-tools) → Task 5
- ✅ SKILL.md Step 4/5/6 updated → Task 6
- ✅ CLAUDE.md updated → Task 7
- ✅ `excalidraw-exporter` deleted → Task 8
- ✅ TDD throughout (tests written before implementation in Tasks 2 and 3)
