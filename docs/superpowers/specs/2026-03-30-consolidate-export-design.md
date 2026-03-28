# Design: Consolidate Export Capabilities into excalidraw-converter

**Date:** 2026-03-30
**Status:** Approved

## Background

The project currently has two separate tool directories:

- `tools/excalidraw-converter/` — zero-dependency CLI, wraps elements JSON into `.excalidraw` files
- `tools/excalidraw-exporter/` — optional install, exports `.excalidraw` to SVG/PNG via a hacky JSDOM script-injection approach

Problems with the current exporter:
- Installed separately (`./install.sh export-tools`), creating friction
- Loads `@excalidraw/utils` as raw text injected into JSDOM (fragile, hard to maintain)
- PNG export lacks `fontDirs` → text renders incorrectly
- No `--scale`, `--dark`, `--padding`, `--background-color` options
- `package.json` lists `excalidraw-to-svg` but code actually reads `@excalidraw/utils` files directly (inconsistent)

## Goal

Consolidate both tools into a single package (`excalidraw-converter`), replacing the exporter with a clean implementation based on [excalidraw-cli](https://github.com/swiftlysingh/excalidraw-cli)'s approach. Export capability becomes part of the default install.

## Directory Structure

```
tools/excalidraw-converter/       ← merged, replaces both tools
  wrap.js           # CLI: stdin elements JSON → .excalidraw (zero deps, unchanged)
  convert.js        # CLI: .excalidraw → SVG/PNG (rewritten)
  dom-polyfill.js   # NEW: JSDOM globals + Path2D + FontFace + font fetch proxy
  wrap.test.mjs     # existing tests (unchanged)
  convert.test.mjs  # rewritten: old stdin→.excalidraw tests removed, new export tests added
  package.json      # updated with new dependencies

tools/excalidraw-exporter/        ← DELETED
```

## Dependencies

New `package.json`:

```json
{
  "name": "excalidraw-converter",
  "version": "2.0.0",
  "type": "module",
  "engines": { "node": ">=18.0.0" },
  "dependencies": {
    "@excalidraw/utils": "0.1.3-test32",
    "@resvg/resvg-js": "^2.6.2",
    "jsdom": "^28.1.0"
  }
}
```

`wrap.js` imports nothing from these — it remains zero-dependency at the code level.

## CLI Interface

### `wrap.js` (unchanged)

Reads elements JSON array from stdin, writes `.excalidraw` file.

```bash
echo '[...]' | node wrap.js --out diagram.excalidraw
echo '[...]' | node wrap.js          # stdout
```

### `convert.js` (rewritten)

Reads a `.excalidraw` file, exports to SVG or PNG.

```bash
node convert.js <input.excalidraw> --format svg --out diagram.svg
node convert.js <input.excalidraw> --format png --scale 2 --out diagram.png
node convert.js <input.excalidraw> --format png --dark
node convert.js <input.excalidraw> --format svg --background-color "#f0f0f0"
node convert.js <input.excalidraw> --format png --no-background
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `--format` / `-f` | `svg\|png` | `svg` | Output format |
| `--out` / `-o` | string | auto | Output path; defaults to input path with swapped extension |
| `--scale` | number | `1` | PNG resolution multiplier (0.1–10) |
| `--dark` | boolean | false | Export with dark mode |
| `--padding` | number | `20` | Padding around content in pixels |
| `--background-color` | string | `#ffffff` | Background color (hex) |
| `--no-background` | boolean | false | Transparent/no background |

## `dom-polyfill.js`

Ported from excalidraw-cli's `dom-polyfill.ts` (plain JS, no TypeScript).

### Exports

**`getExcalidrawAssetDir()`**
Resolves `@excalidraw/utils` package location via `require.resolve()`, returns the `assets/` subdirectory containing bundled TTF fonts. Result is cached.

**`withDOMPolyfill(callback)`**
Serializes export calls via a promise queue (prevents global state races). For each call:
1. Waits for any prior export to finish
2. Calls `installDOMPolyfill()` → installs globals
3. Runs `callback()`
4. Restores all globals (reverse order)
5. Closes JSDOM window

**`installDOMPolyfill()`** (internal)
Creates a JSDOM instance and installs these globals on `globalThis`:
- `window`, `document`, `navigator`, `DOMParser`, `Node`, `devicePixelRatio`
- `Path2D` — no-op class covering all canvas path methods
- `FontFace` — stub with `status: "loaded"`, `loaded: Promise.resolve(this)`
- `document.fonts` — `FontFaceSet` stub (`check()` returns `true`, `load()` resolves immediately)
- `fetch` — intercepts `https://excalidraw-fonts.local/*` requests, serves TTF files from assets dir; includes path traversal guard; falls through to real `fetch` for other URLs
- Sets `window.EXCALIDRAW_ASSET_PATH = "https://excalidraw-fonts.local/"` so `@excalidraw/utils` loads fonts through the proxy

All globals are restored via `overrideGlobal()` which saves the original descriptor and reinstates it on restore.

## `convert.js` Internal Flow

```
read .excalidraw file (JSON.parse)
  └─ withDOMPolyfill(() => {
       suppress console.error for font-face/Path2D noise
       import('@excalidraw/utils').exportToSvg({
         elements, appState (merged with opts), files, exportPadding
       })
       → svg.outerHTML  (SVG string)
     })
  └─ if format === "svg": writeFile(svgString)
  └─ if format === "png":
       naturalWidth = parse from SVG width attribute
       scaledWidth = naturalWidth * scale (clamped 0.1–10)
       new Resvg(svgString, {
         fitTo: { mode: "width", value: scaledWidth },
         font: { loadSystemFonts: false, fontDirs: [assetDir] },  ← key fix
         background: exportBackground ? viewBackgroundColor : undefined
       })
       writeFile(resvg.render().asPng())
```

## `install.sh` Changes

- **Remove** `export-tools` case entirely
- **Main install** (`./install.sh`): after copying tool files, run `npm install --prefix <dst> --omit=dev`
- **`openclaw` install**: same — also runs `npm install`
- **`verify`**: check `convert.js` exists (in addition to `wrap.js`)
- Update install completion messages (remove references to optional export tools)

## `SKILL.md` Changes

**Step 4 — Check installation:**
Check for `wrap.js` and `convert.js` in the same directory. No separate exporter check.

**Step 6 — Export to SVG/PNG:**
- Remove "check if exporter is installed" block and the "missing → run install.sh export-tools" fallback
- Update command to `node ~/.claude/tools/excalidraw-converter/convert.js`
- Document new options: `--scale`, `--dark`, `--padding`, `--background-color`, `--no-background`

## `CLAUDE.md` Changes

- Update architecture description: two-layer pipeline (export is no longer optional/separate)
- Update "Installed locations" — remove exporter entry
- Update "Key Constraints" — mention `npm install` required, remove export-tools reference
- Update commands table — remove `export-tools` row

## What Is NOT Changing

- `wrap.js` logic (zero-dependency, behavior identical)
- `wrap.test.mjs` (all existing tests pass unchanged)
- `convert.test.mjs` structure (extend with export cases)
- Skill format and overall flow
- OpenClaw support
