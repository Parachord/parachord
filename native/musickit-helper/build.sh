#!/bin/bash

# Build script for MusicKit Helper (.app bundle)
# Requires: macOS 14+, Xcode Command Line Tools

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Building MusicKit Helper App..."

# Build release binary
swift build -c release

# Get the built binary path
BINARY_PATH=".build/release/musickit-helper"

if [ ! -f "$BINARY_PATH" ]; then
    echo "Error: Binary not found at $BINARY_PATH"
    exit 1
fi

# Create .app bundle structure
APP_NAME="MusicKitHelper.app"
APP_DIR=".build/release/$APP_NAME"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

echo "Creating app bundle at $APP_DIR..."

# Clean previous bundle
rm -rf "$APP_DIR"

# Create directories
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy executable
cp "$BINARY_PATH" "$MACOS_DIR/MusicKitHelper"

# Copy Info.plist
cp "Info.plist" "$CONTENTS_DIR/"

# Create PkgInfo
echo -n "APPL????" > "$CONTENTS_DIR/PkgInfo"

echo "App bundle created successfully"

# Create output directory for Electron
OUTPUT_DIR="../../resources/bin/darwin"
mkdir -p "$OUTPUT_DIR"

# Sign the app bundle
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    echo "Signing with identity: $APPLE_SIGNING_IDENTITY"
    codesign --force --deep --sign "$APPLE_SIGNING_IDENTITY" \
        --entitlements MusicKitHelper.entitlements \
        --options runtime \
        "$APP_DIR"
else
    echo "Signing ad-hoc..."
    # Ad-hoc signing for development
    codesign --force --deep --sign - \
        --entitlements MusicKitHelper.entitlements \
        "$APP_DIR"
fi

# Verify signature
echo "Verifying signature..."
codesign -vv "$APP_DIR" 2>&1 || true

# Copy app bundle to output directory
echo "Copying to $OUTPUT_DIR..."
rm -rf "$OUTPUT_DIR/MusicKitHelper.app"
cp -R "$APP_DIR" "$OUTPUT_DIR/"

echo ""
echo "Build complete!"
echo "  App bundle: $OUTPUT_DIR/MusicKitHelper.app"
echo "  Executable: $OUTPUT_DIR/MusicKitHelper.app/Contents/MacOS/MusicKitHelper"
echo ""

# Show bundle contents
echo "Bundle contents:"
ls -la "$OUTPUT_DIR/MusicKitHelper.app/Contents/"
ls -la "$OUTPUT_DIR/MusicKitHelper.app/Contents/MacOS/"
