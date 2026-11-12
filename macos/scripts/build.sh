#!/bin/bash
set -euo pipefail
MAC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MAC_ROOT"
cargo build --release --manifest-path engine/Cargo.toml
swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"
APP="$MAC_ROOT/build/PEBS.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Resources"
cp "$BIN_DIR/PEBS" "$APP/Contents/MacOS/PEBS"
cp engine/target/release/pebs-engine "$APP/Contents/Helpers/pebs-engine"
cp Info.plist "$APP/Contents/Info.plist"
if [ -f "$MAC_ROOT/../public/brand/pebs-icon.png" ]; then
  ICONSET="$MAC_ROOT/build/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for SIZE in 16 32 128 256 512; do
    sips -z "$SIZE" "$SIZE" "$MAC_ROOT/../public/brand/pebs-icon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
    DOUBLE=$((SIZE * 2))
    sips -z "$DOUBLE" "$DOUBLE" "$MAC_ROOT/../public/brand/pebs-icon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
fi
codesign --force --sign - "$APP/Contents/Helpers/pebs-engine"
codesign --force --sign - "$APP"
printf 'Built: %s\n' "$APP"
