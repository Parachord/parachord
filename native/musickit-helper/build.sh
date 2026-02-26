#!/bin/bash

# Build script for MusicKit Helper (.app bundle)
# Requires: macOS 14+, Xcode Command Line Tools

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Building MusicKit Helper App..."

# Build universal (arm64 + x86_64) release binary
swift build -c release --arch arm64 --arch x86_64

# Get the built binary path
# When building with --arch flags, Swift PM outputs to .build/apple/Products/Release/
# When building single-arch, it outputs to .build/release/
BINARY_PATH=".build/apple/Products/Release/musickit-helper"
if [ ! -f "$BINARY_PATH" ]; then
    BINARY_PATH=".build/release/musickit-helper"
fi

if [ ! -f "$BINARY_PATH" ]; then
    echo "Error: Binary not found at .build/apple/Products/Release/musickit-helper or .build/release/musickit-helper"
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

# Fallback: if CSC_LINK is available but identity wasn't found, import the
# certificate into a temporary keychain (matches what electron-builder does)
if [ -z "$SIGNING_IDENTITY" ] && [ -n "$CSC_LINK" ]; then
    echo "Importing signing certificate from CSC_LINK..."
    TEMP_P12="$(mktemp /tmp/codesign_cert.XXXXXX).p12"
    TEMP_KEYCHAIN="$(mktemp /tmp/codesign_keychain.XXXXXX).keychain-db"
    TEMP_KC_PASS="$(openssl rand -base64 12)"
    trap 'rm -f "$TEMP_P12"; security delete-keychain "$TEMP_KEYCHAIN" 2>/dev/null || true' EXIT

    echo "$CSC_LINK" | base64 --decode > "$TEMP_P12"
    security create-keychain -p "$TEMP_KC_PASS" "$TEMP_KEYCHAIN"
    security set-keychain-settings -lut 21600 "$TEMP_KEYCHAIN"
    security unlock-keychain -p "$TEMP_KC_PASS" "$TEMP_KEYCHAIN"
    security import "$TEMP_P12" -P "${CSC_KEY_PASSWORD:-}" -A -t cert -f pkcs12 -k "$TEMP_KEYCHAIN"
    security set-key-partition-list -S apple-tool:,apple: -k "$TEMP_KC_PASS" "$TEMP_KEYCHAIN" 2>/dev/null || true
    security list-keychains -d user -s "$TEMP_KEYCHAIN" $(security list-keychains -d user | tr -d '"')

    SIGNING_IDENTITY=$(security find-identity -v -p codesigning "$TEMP_KEYCHAIN" | grep -E "(Developer ID Application|Apple Development)" | head -1 | sed 's/.*"\(.*\)".*/\1/' || echo "")
    if [ -n "$SIGNING_IDENTITY" ]; then
        echo "Imported signing identity: $SIGNING_IDENTITY"
    else
        echo "Warning: Could not extract signing identity from CSC_LINK"
    fi
    rm -f "$TEMP_P12"
fi

if [ -n "$SIGNING_IDENTITY" ]; then
    echo "Signing with identity: $SIGNING_IDENTITY"
    # Sign the inner binary first, then the bundle (Apple recommends against --deep)
    codesign --force --sign "$SIGNING_IDENTITY" \
        --entitlements MusicKitHelper.entitlements \
        --options runtime \
        --timestamp \
        "$APP_DIR/Contents/MacOS/MusicKitHelper"
    codesign --force --sign "$SIGNING_IDENTITY" \
        --entitlements MusicKitHelper.entitlements \
        --options runtime \
        --timestamp \
        "$APP_DIR"
else
    echo "Warning: No signing identity found, using ad-hoc signing"
    echo "  Ad-hoc signing won't work with MusicKit entitlement."
    echo "  Set APPLE_SIGNING_IDENTITY or install a Developer certificate."
    codesign --force --sign - \
        --entitlements MusicKitHelper.entitlements \
        "$APP_DIR/Contents/MacOS/MusicKitHelper"
    codesign --force --sign - \
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
