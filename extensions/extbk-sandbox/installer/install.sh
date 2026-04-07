#!/usr/bin/env bash
# extbk-sandbox installer (Linux / macOS)
# Copies the sandbox + bundled React app to ~/.extbk-sandbox and links extbk-sandbox globally.

set -euo pipefail

INSTALL_DIR="${HOME}/.extbk-sandbox"
BIN_DIR="/usr/local/bin"
SANDBOX_BIN="extbk-sandbox"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC}  $1"; }
warn() { echo -e "${YELLOW}!${NC}  $1"; }
die()  { echo -e "${RED}✘${NC}  $1" >&2; exit 1; }

echo ""
echo "  extbk-sandbox installer"
echo "  ────────────────────────────────────────"

# ── Node.js check ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  die "Node.js is required (>= 18). Install from https://nodejs.org"
fi

NODE_VER=$(node -e "process.stdout.write(process.version.replace('v',''))")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js >= 18 required (found v${NODE_VER})"
fi
ok "Node.js v${NODE_VER}"

# ── Source directory ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"

if [ ! -f "${SRC_DIR}/src/index.js" ]; then
  die "Source not found at ${SRC_DIR}. Run install.sh from inside the extbk-sandbox directory."
fi

# ── Install directory ─────────────────────────────────────────────────────────
echo ""
echo "  Installing to ${INSTALL_DIR} ..."
rm -rf "${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"

# Copy sandbox source
cp -r "${SRC_DIR}/src"          "${INSTALL_DIR}/src"
cp    "${SRC_DIR}/package.json" "${INSTALL_DIR}/package.json"

# Copy bundled React app if present (placed here by the CI build)
if [ -d "${SRC_DIR}/app" ]; then
  cp -r "${SRC_DIR}/app" "${INSTALL_DIR}/app"
  ok "Bundled React app included"
else
  warn "No bundled app/ directory found — sandbox will run without the preview pane"
fi

# ── npm install ───────────────────────────────────────────────────────────────
echo ""
echo "  Running npm install ..."
(cd "${INSTALL_DIR}" && npm install --omit=dev --silent)
ok "Dependencies installed"

# ── Launcher script ───────────────────────────────────────────────────────────
LAUNCHER="${INSTALL_DIR}/bin/extbk-sandbox"
mkdir -p "${INSTALL_DIR}/bin"
cat > "${LAUNCHER}" << 'LAUNCHER_EOF'
#!/usr/bin/env bash
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "${INSTALL_DIR}/src/index.js" "$@"
LAUNCHER_EOF
chmod +x "${LAUNCHER}"

# ── Global symlink ────────────────────────────────────────────────────────────
echo ""
if [ -w "${BIN_DIR}" ]; then
  ln -sf "${LAUNCHER}" "${BIN_DIR}/${SANDBOX_BIN}"
  ok "Linked: extbk-sandbox -> ${BIN_DIR}/${SANDBOX_BIN}"
else
  warn "${BIN_DIR} is not writable. Run with sudo to install globally, or add ${INSTALL_DIR}/bin to your PATH."
  echo "  Add this to your shell profile:"
  echo '  export PATH="'"${INSTALL_DIR}"'/bin:$PATH"'
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ────────────────────────────────────────"
ok "extbk-sandbox installed!"
echo ""
echo "  Usage:"
echo "    extbk-sandbox ./my-extension        # from the extension directory"
echo "    extbk-sandbox ./my-extension -p 4000 # custom port"
echo ""
