# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

`text-to-excalidraw` is an AI coding assistant skill and CLI tool that converts natural language descriptions into Excalidraw diagram files (`.excalidraw`). Compatible with Claude Code, OpenCode, and OpenClaw. It has two components:

1. **Skill** (`SKILL.md`) — a slash command skill that orchestrates diagram generation (AgentSkills-compatible format)
2. **CLI** (`scripts/`) — Node.js CLI with two entry points: `wrap.js` (elements JSON → `.excalidraw`) and `convert.js` (`.excalidraw` → SVG/PNG)

## Platform Support

| Tool | Install Command | Skill Location |
|---|---|---|
| Claude Code | `./install.sh` | `~/.claude/skills/text-to-excalidraw/` |
| OpenCode | `./install.sh` | `~/.claude/skills/text-to-excalidraw/` (OpenCode reads this path natively) |
| OpenClaw | `./install.sh openclaw` | `~/.openclaw/skills/text-to-excalidraw/` |

## Commands

```bash
# Run tests
cd scripts && npm test

# Run tests (alternative)
cd scripts && node --test

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

**Skill layer** (`SKILL.md`): AI analyzes the description, picks a layout strategy (Mermaid-style reasoning for structured diagrams, coordinate-based for free-layout), and generates an Excalidraw `elements` JSON array directly — without browser APIs (which `@excalidraw/mermaid-to-excalidraw` would require).

**CLI layer** (`scripts/`):
- `wrap.js` — CLI: reads elements JSON array from stdin, writes `.excalidraw` file. Imports nothing from npm.
- `convert.js` — CLI: reads `.excalidraw` file, exports to SVG or PNG. Options: `--format svg|png`, `--scale`, `--dark`, `--padding`, `--background-color`, `--no-background`
- `dom-polyfill.js` — shared module: installs JSDOM globals + Path2D/FontFace stubs + font-proxy fetch on `globalThis` for the duration of each export call; serializes concurrent calls via a promise queue
- Dependencies: `@excalidraw/utils` (SVG rendering + bundled TTF fonts), `@resvg/resvg-js` (SVG→PNG via pre-built WASM), `jsdom` (DOM environment)

**Install:** `git clone` directly into `~/.claude/skills/text-to-excalidraw/`, or use `install.sh` to create a symlink from the skills directory to the repo.

## Key Constraints

- Node.js >= 18 required (uses built-in test runner and `--input-type=module`)
- `npm install` is run automatically by `install.sh` — required before using `convert.js`
- `wrap.js` imports nothing from npm packages — safe to run without `node_modules`
- `@resvg/resvg-js` uses pre-built WASM binaries — no native compilation required, cross-platform
- Excalidraw elements must be a JSON array; `wrap.js` throws `TypeError` on non-array input
- PNG font rendering: `@resvg/resvg-js` ignores CSS `@font-face` — bundled TTF fonts from `@excalidraw/utils/assets/` are passed via `fontDirs`
