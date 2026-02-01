#!/bin/bash

# Build script for MusicKit Helper
# Requires: macOS 12+, Xcode Command Line Tools

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Building MusicKit Helper..."

# Build release binary
swift build -c release

# Get the built binary path
BINARY_PATH=".build/release/musickit-helper"

if [ ! -f "$BINARY_PATH" ]; then
    echo "Error: Binary not found at $BINARY_PATH"
    exit 1
fi

# Create output directory
OUTPUT_DIR="../../resources/bin/darwin"
mkdir -p "$OUTPUT_DIR"

# Copy binary
cp "$BINARY_PATH" "$OUTPUT_DIR/musickit-helper"

# Sign with entitlements (requires Apple Developer certificate for MusicKit)
# For development, we can sign ad-hoc
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    echo "Signing with identity: $APPLE_SIGNING_IDENTITY"
    codesign --force --sign "$APPLE_SIGNING_IDENTITY" \
        --entitlements MusicKitHelper.entitlements \
        --options runtime \
        "$OUTPUT_DIR/musickit-helper"
else
    echo "Signing ad-hoc (MusicKit may require proper signing)..."
    codesign --force --sign - \
        --entitlements MusicKitHelper.entitlements \
        "$OUTPUT_DIR/musickit-helper"
fi

echo "Build complete: $OUTPUT_DIR/musickit-helper"

# Verify
file "$OUTPUT_DIR/musickit-helper"
