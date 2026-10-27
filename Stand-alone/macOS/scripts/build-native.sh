#!/bin/sh
# Optional native repackaging of the prepared payload using Apple's own tools.
# First prepare generated-artifacts/standalone-macos/root with the repository build.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
SOURCE="$ROOT/Stand-alone/macOS"
OUTPUT="$ROOT/generated-artifacts/standalone-macos"
VERSION="${INSTALLER_VERSION:-1.1.0}"
if [ "$(/usr/bin/uname -s)" != 'Darwin' ]; then echo 'Run on macOS.' >&2; exit 1; fi
if [ ! -d "$OUTPUT/root" ]; then echo 'Prepare the macOS payload with the documented cross-build first.' >&2; exit 1; fi
mkdir -p "$OUTPUT/native"
/usr/bin/pkgbuild --root "$OUTPUT/root" --scripts "$SOURCE/installer" \
  --identifier au.nswfirecoverage.standalone.macos --version "$VERSION" \
  --install-location / --ownership recommended "$OUTPUT/native/NSWFireCoverage.pkg"
/usr/bin/productbuild --distribution "$OUTPUT/package-work/Distribution" \
  --resources "$OUTPUT/package-work/Resources" --package-path "$OUTPUT/native" \
  "$OUTPUT/native/NSW-Fire-Coverage-$VERSION-macOS-Intel-AppleSilicon.pkg"
echo 'Native package built. Sign and notarize with approved organisation credentials before managed distribution.'
