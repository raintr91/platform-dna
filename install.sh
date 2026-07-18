#!/usr/bin/env bash
set -euo pipefail

REPO="${PLATFORM_DNA_REPO:-raintr91/platform-dna}"
INSTALL_DIR="${PLATFORM_DNA_INSTALL_DIR:-$HOME/.platform-dna/bootstrap}"
BIN_DIR="${PLATFORM_DNA_BIN_DIR:-$HOME/.local/bin}"
REF="${PLATFORM_DNA_REF:-v0.2.0}"

command -v node >/dev/null
command -v git >/dev/null
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
git clone --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$tmpdir/src"
rm -rf "$INSTALL_DIR"
mkdir -p "$(dirname "$INSTALL_DIR")" "$BIN_DIR"
mv "$tmpdir/src" "$INSTALL_DIR"
cd "$INSTALL_DIR"
if command -v pnpm >/dev/null; then
  pnpm install --frozen-lockfile
  pnpm build
else
  npm ci
  npm run build
fi
ln -sf "$INSTALL_DIR/bin/platform-dna.mjs" "$BIN_DIR/platform-dna"
chmod +x "$INSTALL_DIR/bin/platform-dna.mjs"
echo "Installed Platform DNA. Next:"
echo "  cd /path/to/product"
echo "  platform-dna init"
