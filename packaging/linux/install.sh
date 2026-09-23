#!/bin/sh
# SyncDrop installer. Run as your normal user (no sudo):
#   curl -fsSL https://github.com/neosoft-nvm/SyncDrop/releases/latest/download/install.sh | sh
# Set SYNCDROP_BINARY=/path/to/syncdrop to install a local build instead of downloading.
set -eu

BIN_DIR="${HOME}/.local/bin"
TARGET="${BIN_DIR}/syncdrop"
URL="https://github.com/neosoft-nvm/SyncDrop/releases/latest/download/syncdrop-linux-x64.gz"

if [ "$(id -u)" -eq 0 ]; then
  echo "Please run this as your normal user, not root/sudo." >&2
  exit 1
fi
if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  echo "This installer supports 64-bit Intel/AMD Linux only (found $(uname -s) $(uname -m))." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
TMP="$(mktemp "${BIN_DIR}/.syncdrop.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

if [ -n "${SYNCDROP_BINARY:-}" ]; then
  cp "$SYNCDROP_BINARY" "$TMP"
else
  echo "Downloading SyncDrop..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" | gunzip > "$TMP"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$URL" | gunzip > "$TMP"
  else
    echo "Need curl or wget to download SyncDrop." >&2
    exit 1
  fi
fi
chmod 755 "$TMP"
"$TMP" --version >/dev/null   # refuse to install a broken download
mv -f "$TMP" "$TARGET"
trap - EXIT
echo "Installed $TARGET"

# When piped from curl, stdin is this script, so hand the keyboard to setup explicitly.
if [ -t 0 ]; then
  "$TARGET" setup
elif ( : </dev/tty ) 2>/dev/null; then
  "$TARGET" setup </dev/tty
else
  echo "No terminal available. Finish by running: $TARGET setup"
fi
