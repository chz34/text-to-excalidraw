import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

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

  // jsdom does not implement HTMLCanvasElement.getContext() without the `canvas`
  // npm package, which requires native compilation and is unavailable offline.
  // @excalidraw/utils uses a 2D canvas context only for font metric queries
  // (ctx.font / ctx.measureText). Stub it out so exports work without canvas.
  dom.window.HTMLCanvasElement.prototype.getContext = function (contextType) {
    if (contextType !== "2d") return null;
    const stub = {
      canvas: this,
      font: "10px sans-serif",
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      textAlign: "start",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      measureText(text) {
        const charWidth = 8;
        const w = (typeof text === "string" ? text.length : 0) * charWidth;
        return {
          width: w,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: w,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 2,
          fontBoundingBoxAscent: 10,
          fontBoundingBoxDescent: 2,
        };
      },
      // drawing / state methods — all no-ops
      save() {}, restore() {},
      scale() {}, rotate() {}, translate() {}, transform() {},
      setTransform() {}, resetTransform() {},
      beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {},
      arc() {}, arcTo() {}, ellipse() {}, rect() {},
      bezierCurveTo() {}, quadraticCurveTo() {},
      fill() {}, stroke() {}, clip() {},
      fillRect() {}, strokeRect() {}, clearRect() {},
      fillText() {}, strokeText() {},
      drawImage() {},
      setLineDash() {}, getLineDash() { return []; },
      createLinearGradient() { return { addColorStop() {} }; },
      createRadialGradient() { return { addColorStop() {} }; },
      createPattern() { return null; },
      getImageData(_x, _y, w, h) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      },
      putImageData() {},
    };
    return stub;
  };

  dom.window.EXCALIDRAW_ASSET_PATH = FONT_PROXY_BASE;

  const originalFetch = globalThis.fetch?.bind(globalThis);
  const fetchOverride = async (input, init) => {
    const url = typeof input === "string" ? input
      : input instanceof URL ? input.href
      : input.url;
    if (url.startsWith(FONT_PROXY_BASE)) {
      const fontFile = decodeURIComponent(url.slice(FONT_PROXY_BASE.length));
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
