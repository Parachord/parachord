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

# Embed provisioning profile if available
# Look for: 1) PROVISIONING_PROFILE env var, 2) embedded.provisionprofile in script dir
PROFILE_PATH="${PROVISIONING_PROFILE:-embedded.provisionprofile}"
if [ -f "$PROFILE_PATH" ]; then
    echo "Embedding provisioning profile: $PROFILE_PATH"
    cp "$PROFILE_PATH" "$CONTENTS_DIR/embedded.provisionprofile"
else
    echo "Warning: No provisioning profile found at $PROFILE_PATH"
    echo "  MusicKit entitlement requires a provisioning profile."
    echo "  Place your profile at: $SCRIPT_DIR/embedded.provisionprofile"
    echo "  Or set PROVISIONING_PROFILE=/path/to/profile.provisionprofile"
fi

echo "App bundle created successfully"

# Create output directory for Electron
OUTPUT_DIR="../../resources/bin/darwin"
mkdir -p "$OUTPUT_DIR"

# Sign the app bundle
# Prefer APPLE_SIGNING_IDENTITY env var, otherwise try to find a valid identity
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY"
else
    # Try to find a Developer ID or Apple Development certificate
    SIGNING_IDENTITY=$(security find-identity -v -p codesigning | grep -E "(Developer ID Application|Apple Development)" | head -1 | sed 's/.*"\(.*\)".*/\1/' || echo "")
fi

if [ -n "$SIGNING_IDENTITY" ]; then
    echo "Signing with identity: $SIGNING_IDENTITY"
    codesign --force --deep --sign "$SIGNING_IDENTITY" \
        --entitlements MusicKitHelper.entitlements \
        --options runtime \
        "$APP_DIR"
else
    echo "Warning: No signing identity found, using ad-hoc signing"
    echo "  Ad-hoc signing won't work with MusicKit entitlement."
    echo "  Set APPLE_SIGNING_IDENTITY or install a Developer certificate."
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
