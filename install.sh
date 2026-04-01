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
  npm install --prefix "$dst/scripts" --omit=dev
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
  npm install --prefix "$dst/scripts" --omit=dev
  info "OpenClaw Skill 已安装到 $dst ✓"
}

# ── 运行测试 ──────────────────────────────────────────────
run_tests() {
  local scripts_dir="${1:-$SKILLS_TARGET/text-to-excalidraw/scripts}"
  info "运行单元测试..."

  local test_output exit_code=0
  test_output=$(node --test "$scripts_dir"/*.test.mjs 2>&1) || exit_code=$?

  echo "$test_output"
  echo ""

  if [ "$exit_code" -eq 0 ]; then
    info "所有测试通过 ✓"
  else
    # 提取失败的测试名（仅含耗时括号的行，排除 "failing tests:" 标题行）
    local failed_tests
    failed_tests=$(echo "$test_output" | grep -E "^✖ .+\([0-9.]+ms\)" | sed 's/ ([0-9.]*ms)$//' | sort -u)

    echo -e "${RED}[失败的测试]${NC}"
    echo "$failed_tests"
    echo ""

    # 提取第一条具体错误信息（AssertionError / Error: 行）作为提示
    local first_error
    first_error=$(echo "$test_output" | grep -m1 -E "^\s+(AssertionError|Error:)" | sed 's/^[[:space:]]*//')
    if [ -n "$first_error" ]; then
      warn "首条错误：$first_error"
    fi

    # 常见原因提示
    if echo "$test_output" | grep -q "Cannot find package"; then
      warn "原因：node_modules 未安装 → 运行: npm install --prefix $scripts_dir"
    fi

    warn "重新运行测试：node --test $scripts_dir/*.test.mjs"
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
