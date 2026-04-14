#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
SKILLS_TARGET="$CLAUDE_DIR/skills"
OPENCLAW_SKILLS_TARGET="$HOME/.openclaw/skills"
SKILL_NAME="text-to-excalidraw"

# -- color output -------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[info]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; exit 1; }

# -- check dependencies -------------------------------------------------------
check_deps() {
  if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Please install Node.js >= 18: https://nodejs.org"
  fi

  NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -lt 18 ]; then
    error "Node.js >= 18 required. Current version: $(node --version)"
  fi

  info "Node.js $(node --version) OK"
}

# -- install skill (symlink) --------------------------------------------------
install_skill() {
  local dst="$SKILLS_TARGET/$SKILL_NAME"

  mkdir -p "$SKILLS_TARGET"

  if [ -L "$dst" ]; then
    warn "Skill '$SKILL_NAME' already exists (symlink). Updating..."
    rm "$dst"
  elif [ -d "$dst" ]; then
    if [ -d "$dst/.git" ]; then
      local dst_real repo_real
      dst_real="$(cd "$dst" && pwd -P)"
      repo_real="$(cd "$REPO_DIR" && pwd -P)"
      if [ "$dst_real" = "$repo_real" ]; then
        info "Repo is already in the skill directory. Installing npm dependencies..."
        npm install --prefix "$REPO_DIR/scripts" --omit=dev
        info "Skill installed OK"
        return
      fi
      error "Target path $dst is a different git repo. Please resolve manually before installing."
    fi
    warn "Skill '$SKILL_NAME' already exists (directory). Replacing with symlink..."
    rm -rf "$dst"
  fi

  ln -s "$REPO_DIR" "$dst"
  info "Symlink created: $dst -> $REPO_DIR"

  info "Installing npm dependencies (@excalidraw/utils + @resvg/resvg-js + jsdom)..."
  npm install --prefix "$REPO_DIR/scripts" --omit=dev
  info "Skill installed OK"
}

# -- install skill for OpenClaw (symlink) -------------------------------------
install_skill_openclaw() {
  local dst="$OPENCLAW_SKILLS_TARGET/$SKILL_NAME"

  mkdir -p "$OPENCLAW_SKILLS_TARGET"

  if [ -L "$dst" ]; then
    warn "OpenClaw skill '$SKILL_NAME' already exists (symlink). Updating..."
    rm "$dst"
  elif [ -d "$dst" ]; then
    if [ -d "$dst/.git" ]; then
      local dst_real repo_real
      dst_real="$(cd "$dst" && pwd -P)"
      repo_real="$(cd "$REPO_DIR" && pwd -P)"
      if [ "$dst_real" = "$repo_real" ]; then
        info "Repo is already in the skill directory. Installing npm dependencies..."
        npm install --prefix "$REPO_DIR/scripts" --omit=dev
        info "OpenClaw skill installed OK"
        return
      fi
      error "Target path $dst is a different git repo. Please resolve manually before installing."
    fi
    warn "OpenClaw skill '$SKILL_NAME' already exists (directory). Replacing with symlink..."
    rm -rf "$dst"
  fi

  ln -s "$REPO_DIR" "$dst"
  info "Symlink created: $dst -> $REPO_DIR"

  info "Installing npm dependencies (@excalidraw/utils + @resvg/resvg-js + jsdom)..."
  npm install --prefix "$REPO_DIR/scripts" --omit=dev
  info "OpenClaw skill installed OK"
}

# -- run tests ----------------------------------------------------------------
run_tests() {
  local scripts_dir="${1:-$REPO_DIR/scripts}"
  info "Running unit tests..."

  local test_output exit_code=0
  test_output=$(node --test "$scripts_dir"/*.test.mjs 2>&1) || exit_code=$?

  echo "$test_output"
  echo ""

  if [ "$exit_code" -eq 0 ]; then
    info "All tests passed OK"
  else
    local failed_tests
    failed_tests=$(echo "$test_output" | grep -E "^✖ .+\([0-9.]+ms\)" | sed 's/ ([0-9.]*ms)$//' | sort -u)

    echo -e "${RED}[failed tests]${NC}"
    echo "$failed_tests"
    echo ""

    local first_error
    first_error=$(echo "$test_output" | grep -m1 -E "^\s+(AssertionError|Error:)" | sed 's/^[[:space:]]*//')
    if [ -n "$first_error" ]; then
      warn "First error: $first_error"
    fi

    if echo "$test_output" | grep -q "Cannot find package"; then
      warn "Cause: node_modules not installed. Run: npm install --prefix $scripts_dir"
    fi

    warn "Re-run tests: node --test $scripts_dir/*.test.mjs"
  fi
}

# -- verify installation ------------------------------------------------------
verify() {
  local base_dir="${1:-$SKILLS_TARGET/$SKILL_NAME}"
  local skill="$base_dir/SKILL.md"
  local scripts="$base_dir/scripts"

  [ -f "$skill" ]                    || error "Skill file not found: $skill"
  [ -f "$scripts/wrap.js" ]          || error "wrap.js not found: $scripts/wrap.js"
  [ -f "$scripts/convert.js" ]       || error "convert.js not found: $scripts/convert.js"
  [ -f "$scripts/dom-polyfill.js" ]  || error "dom-polyfill.js not found: $scripts/dom-polyfill.js"

  local out
  out=$(echo '[{"id":"v1","type":"rectangle","x":0,"y":0,"width":10,"height":10}]' \
    | node "$scripts/wrap.js" 2>&1)

  if echo "$out" | grep -q '"type": "excalidraw"'; then
    info "Functional verification passed OK"
  else
    error "Functional verification failed. wrap output:\n$out"
  fi
}

# -- uninstall ----------------------------------------------------------------
uninstall() {
  local dst="$SKILLS_TARGET/$SKILL_NAME"
  info "Uninstalling $SKILL_NAME skill..."
  if [ -L "$dst" ]; then
    rm "$dst"
  elif [ -d "$dst" ]; then
    rm -rf "$dst"
  else
    warn "Skill not found at: $dst"
  fi
  info "Uninstall complete"
}

# -- uninstall (OpenClaw) -----------------------------------------------------
uninstall_openclaw() {
  local dst="$OPENCLAW_SKILLS_TARGET/$SKILL_NAME"
  info "Uninstalling OpenClaw $SKILL_NAME skill..."
  if [ -L "$dst" ]; then
    rm "$dst"
  elif [ -d "$dst" ]; then
    rm -rf "$dst"
  else
    warn "Skill not found at: $dst"
  fi
  info "Uninstall complete"
}

# -- main ---------------------------------------------------------------------
case "${1:-install}" in
  install)
    info "Installing text-to-excalidraw (Claude Code / OpenCode)..."
    check_deps
    install_skill
    run_tests
    verify
    echo ""
    info "Installation complete!"
    echo ""
    echo "  Usage (Claude Code / OpenCode):"
    echo "    /text-to-excalidraw draw a login flowchart"
    echo ""
    echo "  Export SVG/PNG:"
    echo "    node ~/.claude/skills/text-to-excalidraw/scripts/convert.js ./output.excalidraw --format svg"
    echo "    node ~/.claude/skills/text-to-excalidraw/scripts/convert.js ./output.excalidraw --format png --scale 2"
    echo ""
    ;;
  openclaw)
    info "Installing text-to-excalidraw (OpenClaw)..."
    check_deps
    install_skill_openclaw
    run_tests
    verify "$OPENCLAW_SKILLS_TARGET/$SKILL_NAME"
    echo ""
    info "OpenClaw installation complete!"
    echo ""
    echo "  Usage (OpenClaw):"
    echo "    /text-to-excalidraw draw a login flowchart"
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
    echo "  install            Install for Claude Code / OpenCode (default, creates symlink)"
    echo "  openclaw           Install for OpenClaw (creates symlink)"
    echo "  uninstall          Uninstall Claude Code / OpenCode version"
    echo "  uninstall-openclaw Uninstall OpenClaw version"
    echo "  verify             Verify installation"
    echo "  test               Run unit tests only"
    exit 1
    ;;
esac
