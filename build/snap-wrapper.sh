#!/bin/sh
# Pre-Electron argv wrapper for Super Productivity on Linux.
#
# Forces --ozone-platform=x11 when launched in a Snap sandbox on a Wayland
# session. This is load-bearing: the programmatic
# app.commandLine.appendSwitch('ozone-platform','x11') in electron/start-app.ts
# is not enough in practice — field reports on issue #7270 (v18.2.4/v18.2.5)
# show Chromium's Ozone init dlopens libEGL/libgbm on the core22 Mesa path
# before appendSwitch is honored, which segfaults under host-vs-snap Mesa
# ABI drift (Ubuntu ≥24.04 host + core22 snap runtime). Putting the flag
# into argv before Electron's argv parser runs bypasses that.
#
# Same mechanism used by Signal Desktop and Mattermost Desktop snaps
# (snapcrafters/signal-desktop, snapcrafters/mattermost-desktop).
#
# Non-Snap launches (AppImage, .deb, .rpm) hit the passthrough branch,
# so behavior for those targets is unchanged.
#
# See docs/research/snap-wayland-gpu-fix-research.md §18.

# Resolve the real path when invoked via /usr/bin/superproductivity symlink
# (deb/rpm install). readlink -f is available on GNU coreutils and BusyBox,
# both of which are guaranteed on every target we ship to.
SELF=$(readlink -f "$0" 2>/dev/null || echo "$0")
BIN_DIR=$(dirname "$SELF")
BIN="$BIN_DIR/superproductivity-bin"

# Respect a user-supplied --ozone-platform= in argv.
for arg in "$@"; do
  case "$arg" in
    --ozone-platform=*|--ozone-platform)
      exec "$BIN" "$@"
      ;;
  esac
done

if [ -n "$SNAP" ] && { [ "$XDG_SESSION_TYPE" = "wayland" ] || [ -n "$WAYLAND_DISPLAY" ]; }; then
  exec "$BIN" --ozone-platform=x11 "$@"
fi

exec "$BIN" "$@"
