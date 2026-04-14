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

  const outputFormat = values.format;
  if (outputFormat !== "svg" && outputFormat !== "png") {
    process.stderr.write(`Unknown format: "${outputFormat}". Use --format svg or --format png\n`);
    process.exit(1);
  }

  const absInput = resolve(inputRel);
  const absOut = values.out ? resolve(values.out) : swapExtension(absInput, outputFormat);

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

  if (outputFormat === "svg") {
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
