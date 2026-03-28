# Scripts Colocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `tools/excalidraw-converter/` into `skills/text-to-excalidraw/scripts/` so the skill is fully self-contained in one directory.

**Architecture:** The skill directory (`skills/text-to-excalidraw/`) will contain both `SKILL.md` and a `scripts/` subdirectory with all Node.js CLI files and npm dependencies. `install.sh` installs the entire skill dir in one step and runs `npm install` inside `scripts/`. SKILL.md references scripts via the `BASE_DIR` injected by the skill framework. The `tools/` directory is removed entirely.

**Tech Stack:** bash (install.sh), Node.js ESM (scripts), npm (deps)

---

## Files Changed

| File | Action |
|---|---|
| `tools/excalidraw-converter/` → `skills/text-to-excalidraw/scripts/` | `git mv` (all contents) |
| `install.sh` | Rewrite: remove `TOOLS_TARGET` + `install_tool()`, merge npm install into `install_skill()` |
| `skills/text-to-excalidraw/SKILL.md` | Update Steps 4/5/6 to use `<BASE_DIR>/scripts/` |
| `README.md` | Update 包含内容 table, 安装 steps, 导出 commands, 文件结构, 运行测试 |
| `CLAUDE.md` | Update Commands section and Architecture installed locations |

JS source files (`wrap.js`, `convert.js`, `dom-polyfill.js`, `*.test.mjs`, `package.json`) are **not modified** — only moved.

---

### Task 1: Move scripts into skill directory

**Files:**
- `git mv tools/excalidraw-converter → skills/text-to-excalidraw/scripts`

- [ ] **Step 1: Move the directory**

```bash
git mv tools/excalidraw-converter skills/text-to-excalidraw/scripts
```

- [ ] **Step 2: Verify structure**

```bash
find skills/text-to-excalidraw -not -path '*/node_modules/*' | sort
```

Expected output:
```
skills/text-to-excalidraw
skills/text-to-excalidraw/SKILL.md
skills/text-to-excalidraw/scripts
skills/text-to-excalidraw/scripts/convert.js
skills/text-to-excalidraw/scripts/convert.test.mjs
skills/text-to-excalidraw/scripts/dom-polyfill.js
skills/text-to-excalidraw/scripts/dom-polyfill.test.mjs
skills/text-to-excalidraw/scripts/package-lock.json
skills/text-to-excalidraw/scripts/package.json
skills/text-to-excalidraw/scripts/wrap.js
skills/text-to-excalidraw/scripts/wrap.test.mjs
```

- [ ] **Step 3: Verify tools/ is gone**

```bash
ls tools/ 2>&1
```

Expected: `ls: cannot access 'tools/': No such file or directory`

- [ ] **Step 4: Run tests from new location to confirm nothing broke**

```bash
node --test skills/text-to-excalidraw/scripts/*.test.mjs 2>&1 | tail -10
```

Expected: `fail 0` in output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move excalidraw-converter into skills/text-to-excalidraw/scripts"
```

---

### Task 2: Rewrite install.sh

**Files:**
- Modify: `install.sh`

- [ ] **Step 1: Write the new install.sh**

Replace the entire file with:

```bash
#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
SKILLS_TARGET="$CLAUDE_DIR/skills"
OPENCLAW_SKILLS_TARGET="$HOME/.openclaw/skills"

# ── 颜色输出 ─────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[info]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── 检查依赖 ─────────────────────────────────────────────
check_deps() {
  if ! command -v node &>/dev/null; then
    error "Node.js 未安装。请先安装 Node.js >= 18: https://nodejs.org"
  fi

  NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -lt 18 ]; then
    error "Node.js 版本需要 >= 18，当前版本: $(node --version)"
  fi

  info "Node.js $(node --version) ✓"
}

# ── 安装 skill（含 scripts/）────────────────────────────
install_skill() {
  local skill_name="text-to-excalidraw"
  local src="$REPO_DIR/skills/$skill_name"
  local dst="$SKILLS_TARGET/$skill_name"

  mkdir -p "$SKILLS_TARGET"

  if [ -d "$dst" ]; then
    warn "Skill '$skill_name' 已存在，正在覆盖..."
    rm -rf "$dst"
  fi

  cp -r "$src" "$dst"
  info "正在安装 npm 依赖（@excalidraw/utils + @resvg/resvg-js + jsdom）..."
  npm install --prefix "$dst/scripts" --omit=dev 2>&1 | tail -3
  info "Skill 已安装到 $dst ✓"
}

# ── 安装 skill（OpenClaw）────────────────────────────────
install_skill_openclaw() {
  local skill_name="text-to-excalidraw"
  local src="$REPO_DIR/skills/$skill_name"
  local dst="$OPENCLAW_SKILLS_TARGET/$skill_name"

  mkdir -p "$OPENCLAW_SKILLS_TARGET"

  if [ -d "$dst" ]; then
    warn "OpenClaw Skill '$skill_name' 已存在，正在覆盖..."
    rm -rf "$dst"
  fi

  cp -r "$src" "$dst"
  info "正在安装 npm 依赖（@excalidraw/utils + @resvg/resvg-js + jsdom）..."
  npm install --prefix "$dst/scripts" --omit=dev 2>&1 | tail -3
  info "OpenClaw Skill 已安装到 $dst ✓"
}

# ── 运行测试 ──────────────────────────────────────────────
run_tests() {
  local scripts_dir="${1:-$SKILLS_TARGET/text-to-excalidraw/scripts}"
  info "运行单元测试..."
  if node --test "$scripts_dir"/*.test.mjs 2>&1 | grep -q "fail 0"; then
    info "所有测试通过 ✓"
  else
    warn "部分测试未通过，请检查输出"
    node --test "$scripts_dir"/*.test.mjs
  fi
}

# ── 验证安装 ──────────────────────────────────────────────
verify() {
  local base_dir="${1:-$SKILLS_TARGET/text-to-excalidraw}"
  local skill="$base_dir/SKILL.md"
  local scripts="$base_dir/scripts"

  [ -f "$skill" ]                    || error "Skill 文件未找到: $skill"
  [ -f "$scripts/wrap.js" ]          || error "wrap.js 未找到: $scripts/wrap.js"
  [ -f "$scripts/convert.js" ]       || error "convert.js 未找到: $scripts/convert.js"
  [ -f "$scripts/dom-polyfill.js" ]  || error "dom-polyfill.js 未找到: $scripts/dom-polyfill.js"

  # 快速功能测试（wrap）
  local out
  out=$(echo '[{"id":"v1","type":"rectangle","x":0,"y":0,"width":10,"height":10}]' \
    | node "$scripts/wrap.js" 2>&1)

  if echo "$out" | grep -q '"type": "excalidraw"'; then
    info "功能验证通过 ✓"
  else
    error "功能验证失败，wrap 输出异常:\n$out"
  fi
}

# ── 卸载 ─────────────────────────────────────────────────
uninstall() {
  info "卸载 text-to-excalidraw skill..."
  rm -rf "$SKILLS_TARGET/text-to-excalidraw"
  info "卸载完成"
}

# ── 卸载（OpenClaw）──────────────────────────────────────
uninstall_openclaw() {
  info "卸载 OpenClaw text-to-excalidraw skill..."
  rm -rf "$OPENCLAW_SKILLS_TARGET/text-to-excalidraw"
  info "卸载完成"
}

# ── 主流程 ────────────────────────────────────────────────
case "${1:-install}" in
  install)
    info "开始安装 text-to-excalidraw（Claude Code / OpenCode）..."
    check_deps
    install_skill
    run_tests
    verify
    echo ""
    info "安装完成！"
    echo ""
    echo "  使用方式（Claude Code / OpenCode）："
    echo "    /text-to-excalidraw 画一个登录流程图"
    echo "    或直接描述: 帮我画一张微服务架构图"
    echo ""
    echo "  导出 SVG/PNG："
    echo "    node ~/.claude/skills/text-to-excalidraw/scripts/convert.js ./output.excalidraw --format svg"
    echo "    node ~/.claude/skills/text-to-excalidraw/scripts/convert.js ./output.excalidraw --format png --scale 2"
    echo ""
    ;;
  openclaw)
    info "开始安装 text-to-excalidraw（OpenClaw）..."
    check_deps
    install_skill_openclaw
    run_tests "$OPENCLAW_SKILLS_TARGET/text-to-excalidraw/scripts"
    verify "$OPENCLAW_SKILLS_TARGET/text-to-excalidraw"
    echo ""
    info "OpenClaw 安装完成！"
    echo ""
    echo "  使用方式（OpenClaw）："
    echo "    /text-to-excalidraw 画一个登录流程图"
    echo "    或直接描述: 帮我画一张微服务架构图"
    echo ""
    ;;
  uninstall)
    uninstall
    ;;
  uninstall-openclaw)
    uninstall_openclaw
    ;;
  verify)
    check_deps
    verify
    ;;
  test)
    check_deps
    run_tests
    ;;
  *)
    echo "Usage: $0 [install|openclaw|uninstall|uninstall-openclaw|verify|test]"
    echo ""
    echo "  install            安装到 Claude Code / OpenCode（默认）"
    echo "  openclaw           安装到 OpenClaw"
    echo "  uninstall          卸载 Claude Code / OpenCode 版本"
    echo "  uninstall-openclaw 卸载 OpenClaw 版本"
    echo "  verify             验证安装是否正确"
    echo "  test               只运行单元测试"
    exit 1
    ;;
esac
```

- [ ] **Step 2: Run install to verify it works end-to-end**

```bash
bash install.sh
```

Expected: all steps pass, ending with:
```
[info]  功能验证通过 ✓
[info]  安装完成！
```

- [ ] **Step 3: Confirm installed layout**

```bash
find ~/.claude/skills/text-to-excalidraw -not -path '*/node_modules/*' | sort
```

Expected to include `SKILL.md`, `scripts/wrap.js`, `scripts/convert.js`, `scripts/dom-polyfill.js`, and test files.

- [ ] **Step 4: Confirm tools dir is gone from install target**

```bash
ls ~/.claude/tools/ 2>&1
```

Expected: either empty or directory not found (no `excalidraw-converter` entry).

- [ ] **Step 5: Commit**

```bash
git add install.sh
git commit -m "refactor: merge npm install into install_skill, remove separate tools dir"
```

---

### Task 3: Update SKILL.md script paths

**Files:**
- Modify: `skills/text-to-excalidraw/SKILL.md`

The skill framework injects `Base directory for this skill: <path>` at the top of the prompt. Steps 4, 5, and 6 must reference `<BASE_DIR>/scripts/` instead of the old `~/.claude/tools/excalidraw-converter/` paths.

- [ ] **Step 1: Update Step 4 — install check**

Replace:
```
Before writing the file, check if the tool is installed:

```bash
test -f ~/.claude/tools/excalidraw-converter/wrap.js && \
  test -f ~/.claude/tools/excalidraw-converter/convert.js && \
  echo "installed" || echo "missing"
```
```

With:
```
Before writing the file, check if the scripts are installed. The skill's base directory is shown at the top of this prompt (the `Base directory for this skill:` line). Scripts live at `<BASE_DIR>/scripts/`.

```bash
# Replace <BASE_DIR> with the base directory from the skill header
test -f <BASE_DIR>/scripts/wrap.js && \
  test -f <BASE_DIR>/scripts/convert.js && \
  echo "installed" || echo "missing"
```
```

- [ ] **Step 2: Update Step 5 — wrap.js command**

Replace:
```bash
node ~/.claude/tools/excalidraw-converter/wrap.js --out <output_path> < /tmp/elements.json
```

With:
```bash
node <BASE_DIR>/scripts/wrap.js --out <output_path> < /tmp/elements.json
```

- [ ] **Step 3: Update Step 6 — convert.js commands**

Replace:
```bash
node ~/.claude/tools/excalidraw-converter/convert.js <input.excalidraw> --format svg --out <output.svg>
```
and:
```bash
node ~/.claude/tools/excalidraw-converter/convert.js <input.excalidraw> --format png --out <output.png>
```

With:
```bash
node <BASE_DIR>/scripts/convert.js <input.excalidraw> --format svg --out <output.svg>
```
and:
```bash
node <BASE_DIR>/scripts/convert.js <input.excalidraw> --format png --out <output.png>
```

- [ ] **Step 4: Commit**

```bash
git add skills/text-to-excalidraw/SKILL.md
git commit -m "feat: update SKILL.md — reference scripts via BASE_DIR instead of tools path"
```

---

### Task 4: Update README.md and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README.md "包含内容" table**

Replace:
```
| CLI 工具 | `tools/excalidraw-converter/` | `wrap.js`：elements JSON → `.excalidraw`；`convert.js`：`.excalidraw` → SVG / PNG |
```

With:
```
| CLI 工具 | `skills/text-to-excalidraw/scripts/` | `wrap.js`：elements JSON → `.excalidraw`；`convert.js`：`.excalidraw` → SVG / PNG |
```

- [ ] **Step 2: Update README.md Claude Code 安装步骤**

Replace:
```
1. 检查 Node.js 版本
2. 将 skill 复制到 `~/.claude/skills/text-to-excalidraw/`
3. 将 CLI 工具复制到 `~/.claude/tools/excalidraw-converter/`
4. 运行单元测试（9 项）
5. 执行功能验证
```

With:
```
1. 检查 Node.js 版本
2. 将 skill（含 scripts/）复制到 `~/.claude/skills/text-to-excalidraw/`
3. 在 `scripts/` 目录运行 `npm install`
4. 运行单元测试
5. 执行功能验证
```

- [ ] **Step 3: Update README.md OpenClaw 安装步骤**

Replace:
```
1. 检查 Node.js 版本
2. 将 skill 复制到 `~/.openclaw/skills/text-to-excalidraw/`
3. 将 CLI 工具复制到 `~/.claude/tools/excalidraw-converter/`
4. 运行单元测试（9 项）
5. 执行功能验证
```

With:
```
1. 检查 Node.js 版本
2. 将 skill（含 scripts/）复制到 `~/.openclaw/skills/text-to-excalidraw/`
3. 在 `scripts/` 目录运行 `npm install`
4. 运行单元测试
5. 执行功能验证
```

- [ ] **Step 4: Update README.md 导出 SVG/PNG 手动使用命令**

Replace all three `~/.claude/tools/excalidraw-converter/convert.js` occurrences with `~/.claude/skills/text-to-excalidraw/scripts/convert.js`.

- [ ] **Step 5: Update README.md 运行测试 section**

Replace:
```
```bash
cd tools/excalidraw-converter
node --test
```
```

With:
```
```bash
cd skills/text-to-excalidraw/scripts
node --test
```
```

- [ ] **Step 6: Update README.md 文件结构 section**

Replace:
```
text-to-excalidraw/
├── README.md
├── LICENSE
├── install.sh
├── skills/
│   └── text-to-excalidraw/
│       └── SKILL.md                   # Skill 定义（Claude Code / OpenCode / OpenClaw）
└── tools/
    └── excalidraw-converter/          # CLI 工具：elements[] → .excalidraw → SVG / PNG
        ├── package.json               # deps: @excalidraw/utils, @resvg/resvg-js, jsdom
        ├── wrap.js                    # CLI + 库：elements JSON → .excalidraw 文件
        ├── convert.js                 # CLI：.excalidraw → SVG / PNG（--format, --scale, --out）
        ├── dom-polyfill.js            # 共享模块：JSDOM 环境 + Path2D / FontFace stubs
        ├── wrap.test.mjs              # wrap.js 单元测试
        ├── convert.test.mjs           # convert.js 集成测试
        └── dom-polyfill.test.mjs      # dom-polyfill.js 单元测试
```

With:
```
text-to-excalidraw/
├── README.md
├── LICENSE
├── install.sh
└── skills/
    └── text-to-excalidraw/
        ├── SKILL.md                   # Skill 定义（Claude Code / OpenCode / OpenClaw）
        └── scripts/                   # CLI 工具：elements[] → .excalidraw → SVG / PNG
            ├── package.json           # deps: @excalidraw/utils, @resvg/resvg-js, jsdom
            ├── wrap.js                # CLI + 库：elements JSON → .excalidraw 文件
            ├── convert.js             # CLI：.excalidraw → SVG / PNG（--format, --scale, --out）
            ├── dom-polyfill.js        # 共享模块：JSDOM 环境 + Path2D / FontFace stubs
            ├── wrap.test.mjs          # wrap.js 单元测试
            ├── convert.test.mjs       # convert.js 集成测试
            └── dom-polyfill.test.mjs  # dom-polyfill.js 单元测试
```

- [ ] **Step 7: Update CLAUDE.md — Project Purpose section**

Replace:
```
2. **CLI** (`tools/excalidraw-converter/`) — Node.js CLI with two entry points: `wrap.js` (elements JSON → `.excalidraw`) and `convert.js` (`.excalidraw` → SVG/PNG)
```

With:
```
2. **CLI** (`skills/text-to-excalidraw/scripts/`) — Node.js CLI with two entry points: `wrap.js` (elements JSON → `.excalidraw`) and `convert.js` (`.excalidraw` → SVG/PNG)
```

- [ ] **Step 8: Update CLAUDE.md — Commands section**

Replace:
```
# Run tests
cd tools/excalidraw-converter && npm test

# Run tests (alternative)
cd tools/excalidraw-converter && node --test
```

With:
```
# Run tests
cd skills/text-to-excalidraw/scripts && npm test

# Run tests (alternative)
cd skills/text-to-excalidraw/scripts && node --test
```

- [ ] **Step 9: Update CLAUDE.md — Architecture installed locations**

Replace:
```
**CLI layer** (`tools/excalidraw-converter/`):
```
With:
```
**CLI layer** (`skills/text-to-excalidraw/scripts/`):
```

And replace:
```
**Installed locations:**
- Skill: `~/.claude/skills/text-to-excalidraw/`
- CLI: `~/.claude/tools/excalidraw-converter/`
```

With:
```
**Installed location:** `~/.claude/skills/text-to-excalidraw/` (skill + scripts together)
```

- [ ] **Step 10: Verify no stale tool paths remain**

```bash
grep -n "tools/excalidraw-converter\|\.claude/tools" README.md CLAUDE.md skills/text-to-excalidraw/SKILL.md
```

Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md — scripts colocation, remove tools/ references"
```

---

### Task 5: Final verification and push

- [ ] **Step 1: Run a clean install from scratch**

```bash
rm -rf ~/.claude/skills/text-to-excalidraw && bash install.sh
```

Expected: all steps pass ending with `[info]  安装完成！`

- [ ] **Step 2: Run verify command**

```bash
bash install.sh verify
```

Expected:
```
[info]  Node.js vXX.X.X ✓
[info]  功能验证通过 ✓
```

- [ ] **Step 3: Confirm no tools dir at install target**

```bash
ls ~/.claude/tools/ 2>&1
```

Expected: empty listing or `No such file or directory` (not `excalidraw-converter`).

- [ ] **Step 4: Squash into single initial commit and push**

```bash
git log --oneline
```

Confirm all tasks are committed, then:

```bash
git reset --soft $(git rev-list --max-parents=0 HEAD)
git commit --amend -m "feat: initial commit — text-to-excalidraw skill and CLI tools"
git push --force
```
