#!/bin/bash

# Fix macOS dock icon gray outline by filling transparent areas with background color
# Requires ImageMagick: brew install imagemagick

set -e

ICONS_DIR="assets/icons"
BG_COLOR="#1e2939"  # Dark background color from the icon

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo "Error: ImageMagick is required. Install with: brew install imagemagick"
    exit 1
fi

# First, restore from backup if one exists
LATEST_BACKUP=$(ls -td "$ICONS_DIR"/backup-* 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ] && [ -d "$LATEST_BACKUP" ]; then
    echo "Restoring icons from backup: $LATEST_BACKUP"
    for file in "$LATEST_BACKUP"/*.png; do
        if [ -f "$file" ]; then
            cp "$file" "$ICONS_DIR/"
        fi
    done
fi

# Backup original icons
BACKUP_DIR="$ICONS_DIR/backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "Backing up current icons to $BACKUP_DIR"

for size in 16 32 48 128 256 512 1024; do
    if [ -f "$ICONS_DIR/icon${size}.png" ]; then
        cp "$ICONS_DIR/icon${size}.png" "$BACKUP_DIR/"
    fi
done
cp "$ICONS_DIR/icon.icns" "$BACKUP_DIR/" 2>/dev/null || true

# Fill transparent areas with background color
echo "Filling transparent corners with background color..."

for size in 16 32 48 128 256 512 1024; do
    if [ -f "$ICONS_DIR/icon${size}.png" ]; then
        echo "  Processing icon${size}.png"

        # Flatten the image onto a background of the dark color
        # This removes ALL transparency, filling corners with the bg color
        convert "$ICONS_DIR/icon${size}.png" \
            -background "$BG_COLOR" \
            -flatten \
            "$ICONS_DIR/icon${size}.png"
    fi
done

echo "Transparent areas filled."

# Regenerate .icns file for macOS
echo "Regenerating icon.icns..."

ICONSET_DIR="$ICONS_DIR/icon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Copy icons to iconset with proper naming
cp "$ICONS_DIR/icon16.png" "$ICONSET_DIR/icon_16x16.png"
cp "$ICONS_DIR/icon32.png" "$ICONSET_DIR/icon_16x16@2x.png"
cp "$ICONS_DIR/icon32.png" "$ICONSET_DIR/icon_32x32.png"
cp "$ICONS_DIR/icon128.png" "$ICONSET_DIR/icon_128x128.png"
cp "$ICONS_DIR/icon256.png" "$ICONSET_DIR/icon_128x128@2x.png"
cp "$ICONS_DIR/icon256.png" "$ICONSET_DIR/icon_256x256.png"
cp "$ICONS_DIR/icon512.png" "$ICONSET_DIR/icon_256x256@2x.png"
cp "$ICONS_DIR/icon512.png" "$ICONSET_DIR/icon_512x512.png"
cp "$ICONS_DIR/icon1024.png" "$ICONSET_DIR/icon_512x512@2x.png"

# Generate .icns
iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"

# Cleanup
rm -rf "$ICONSET_DIR"

echo ""
echo "Done! The icons now have square corners (no transparency)."
echo "macOS will apply its own rounded mask without adding a gray background."
echo ""
echo "Rebuild the app with: npm run build:mac"
