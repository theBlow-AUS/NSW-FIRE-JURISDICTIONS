#!/bin/sh
set -eu
APP='/Library/Application Support/NSW Fire Coverage'
STATE='/Library/Application Support/NSW Fire Coverage Data'
# sysctl detects Apple Silicon even if invoked by a Rosetta-translated shell.
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = '1' ]; then
  ARCH='arm64'
else
  case "$(/usr/bin/uname -m)" in
    x86_64) ARCH='x64' ;;
    *) echo 'Unsupported processor. Intel x64 or Apple Silicon is required.' >&2; exit 1 ;;
  esac
fi
exec "$APP/runtime/darwin-$ARCH/node" "$APP/app/server.mjs" \
  --config "$STATE/server.json" --defaults "$APP/config/server.default.json" "$@"
