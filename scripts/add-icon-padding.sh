#!/bin/bash

# Add padding to icon files to prevent macOS dock outline effect
# Requires ImageMagick: brew install imagemagick

set -e

ICONS_DIR="assets/icons"
PADDING_PERCENT=12  # 12% padding on each side (icon will be 76% of canvas)

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo "Error: ImageMagick is required. Install with: brew install imagemagick"
    exit 1
fi

# Backup original icons
BACKUP_DIR="$ICONS_DIR/backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "Backing up original icons to $BACKUP_DIR"

for size in 16 32 48 128 256 512 1024; do
    if [ -f "$ICONS_DIR/icon${size}.png" ]; then
        cp "$ICONS_DIR/icon${size}.png" "$BACKUP_DIR/"
    fi
done

# Add padding to each icon size
echo "Adding padding to icons..."

for size in 16 32 48 128 256 512 1024; do
    if [ -f "$ICONS_DIR/icon${size}.png" ]; then
        echo "  Processing icon${size}.png"

        # Calculate the inner size (the actual icon will be smaller)
        inner_size=$(echo "$size * (100 - 2 * $PADDING_PERCENT) / 100" | bc)

        # Resize the icon smaller, then extend canvas with transparent background
        convert "$ICONS_DIR/icon${size}.png" \
            -resize ${inner_size}x${inner_size} \
            -gravity center \
            -background none \
            -extent ${size}x${size} \
            "$ICONS_DIR/icon${size}.png"
    fi
done

echo "Padding added to all PNG icons."

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

echo "Done! icon.icns has been regenerated."
echo "Rebuild the app with: npm run build:mac"
