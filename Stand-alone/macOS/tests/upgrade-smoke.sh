#!/bin/sh
set -eu
# Node 22+ is a pilot-runner dependency, not an installed-application dependency.
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$HERE/../../tests/native-upgrade.mjs" "$@"
