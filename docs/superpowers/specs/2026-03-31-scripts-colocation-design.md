# Design: Collocate CLI Scripts Inside Skill Directory

**Date:** 2026-03-31  
**Status:** Approved

## Problem

The current architecture splits the skill and its CLI tools across two install locations:

- `~/.claude/skills/text-to-excalidraw/` — skill prompt only
- `~/.claude/tools/excalidraw-converter/` — Node.js scripts + npm deps

This means `install.sh` must write to two directories, uninstall must clean two locations, and the skill's runtime tools are physically separated from the skill definition.

## Goal

Move CLI scripts into the skill directory as a `scripts/` subdirectory, so the skill is fully self-contained. One install location, one uninstall command.

## Design

### Repository Structure

Before:
```
skills/text-to-excalidraw/SKILL.md
tools/excalidraw-converter/
    package.json
    package-lock.json
    wrap.js  convert.js  dom-polyfill.js
    *.test.mjs
```

After:
```
skills/text-to-excalidraw/
    SKILL.md
    scripts/
        package.json
        package-lock.json
        wrap.js  convert.js  dom-polyfill.js
        *.test.mjs
```

The `tools/` directory is removed entirely from the repo.

### Installed Layout (Claude Code / OpenCode)

```
~/.claude/skills/text-to-excalidraw/
    SKILL.md
    scripts/
        package.json
        node_modules/          ← npm install target
        wrap.js  convert.js  dom-polyfill.js
        *.test.mjs
```

### Installed Layout (OpenClaw)

```
~/.openclaw/skills/text-to-excalidraw/
    SKILL.md
    scripts/
        package.json
        node_modules/
        ...
```

### install.sh Changes

- Remove `TOOLS_TARGET` variable
- Remove `install_tool()` function
- `install_skill()`: copy entire skill dir (includes `scripts/`), then run:
  ```bash
  npm install --prefix "$dst/scripts" --omit=dev
  ```
- `install_skill_openclaw()`: same pattern with `$OPENCLAW_SKILLS_TARGET`
- `run_tests()`: path changes from `$TOOLS_TARGET/excalidraw-converter/` to `$SKILLS_TARGET/text-to-excalidraw/scripts/`
- `verify()`: same path update
- `uninstall()`: remove only `$SKILLS_TARGET/text-to-excalidraw/` (tools dir no longer exists)

### SKILL.md Changes

The skill framework injects the base directory at invocation time:
```
Base directory for this skill: <absolute-path>
```

All script references in SKILL.md use `<BASE_DIR>/scripts/` where `BASE_DIR` is the injected path. This makes the skill platform-agnostic (works for both `~/.claude/skills/` and `~/.openclaw/skills/`).

Step 4 (install check):
```bash
test -f <BASE_DIR>/scripts/wrap.js && \
  test -f <BASE_DIR>/scripts/convert.js && \
  echo "installed" || echo "missing"
```

Step 5 (write .excalidraw):
```bash
node <BASE_DIR>/scripts/wrap.js --out <output_path> < /tmp/elements.json
```

Step 6 (export SVG/PNG):
```bash
node <BASE_DIR>/scripts/convert.js <input.excalidraw> --format svg --out <output.svg>
node <BASE_DIR>/scripts/convert.js <input.excalidraw> --format png --out <output.png>
```

### README Changes

- "包含内容" table: update path column to `skills/text-to-excalidraw/scripts/`
- "导出为 SVG/PNG" section: update command paths
- "文件结构" section: remove `tools/`, show `scripts/` inside skill dir
- "其他脚本命令": no changes needed (commands unchanged)

### CLAUDE.md Changes

- Architecture section: update installed locations
- Remove reference to `~/.claude/tools/excalidraw-converter/`

## What Does Not Change

- All JS source file contents (`wrap.js`, `convert.js`, `dom-polyfill.js`)
- All test file contents
- `package.json` contents
- OpenClaw support
- Skill behavior and diagram generation logic

## Testing

After refactor, `./install.sh` must:
1. Install skill + scripts to single directory
2. Pass all unit tests (running from new path)
3. Pass `verify()` functional check (wrap CLI outputs valid excalidraw JSON)
