#!/bin/bash

# Generate PNG icons from SVG and create .icns for macOS
# Requires: rsvg-convert (brew install librsvg) OR Inkscape OR built-in qlmanage

set -e

ICONS_DIR="assets/icons"
SVG_FILE="$ICONS_DIR/icon-square.svg"

if [ ! -f "$SVG_FILE" ]; then
    echo "Error: $SVG_FILE not found"
    exit 1
fi

# Backup current icons
BACKUP_DIR="$ICONS_DIR/backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "Backing up current icons to $BACKUP_DIR"
for size in 16 32 48 128 256 512 1024; do
    [ -f "$ICONS_DIR/icon${size}.png" ] && cp "$ICONS_DIR/icon${size}.png" "$BACKUP_DIR/"
done
[ -f "$ICONS_DIR/icon.icns" ] && cp "$ICONS_DIR/icon.icns" "$BACKUP_DIR/"

# Determine which tool to use for SVG conversion
if command -v rsvg-convert &> /dev/null; then
    CONVERTER="rsvg"
    echo "Using rsvg-convert for SVG conversion"
elif command -v inkscape &> /dev/null; then
    CONVERTER="inkscape"
    echo "Using Inkscape for SVG conversion"
elif command -v magick &> /dev/null; then
    CONVERTER="magick"
    echo "Using ImageMagick for SVG conversion"
elif command -v convert &> /dev/null; then
    CONVERTER="convert"
    echo "Using ImageMagick convert for SVG conversion"
else
    echo "Error: No SVG converter found. Install one of:"
    echo "  brew install librsvg    (recommended)"
    echo "  brew install inkscape"
    echo "  brew install imagemagick"
    exit 1
fi

echo "Generating PNG icons from SVG..."

for size in 16 32 48 128 256 512 1024; do
    echo "  Generating icon${size}.png"

    case $CONVERTER in
        rsvg)
            rsvg-convert -w $size -h $size "$SVG_FILE" -o "$ICONS_DIR/icon${size}.png"
            ;;
        inkscape)
            inkscape -w $size -h $size "$SVG_FILE" -o "$ICONS_DIR/icon${size}.png" 2>/dev/null
            ;;
        magick)
            magick -background none -density 300 "$SVG_FILE" -resize ${size}x${size} "$ICONS_DIR/icon${size}.png"
            ;;
        convert)
            convert -background none -density 300 "$SVG_FILE" -resize ${size}x${size} "$ICONS_DIR/icon${size}.png"
            ;;
    esac
done

echo "PNG icons generated."

# Generate .icns file for macOS
echo "Generating icon.icns..."

ICONSET_DIR="$ICONS_DIR/icon.iconset"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

cp "$ICONS_DIR/icon16.png" "$ICONSET_DIR/icon_16x16.png"
cp "$ICONS_DIR/icon32.png" "$ICONSET_DIR/icon_16x16@2x.png"
cp "$ICONS_DIR/icon32.png" "$ICONSET_DIR/icon_32x32.png"
cp "$ICONS_DIR/icon128.png" "$ICONSET_DIR/icon_128x128.png"
cp "$ICONS_DIR/icon256.png" "$ICONSET_DIR/icon_128x128@2x.png"
cp "$ICONS_DIR/icon256.png" "$ICONSET_DIR/icon_256x256.png"
cp "$ICONS_DIR/icon512.png" "$ICONSET_DIR/icon_256x256@2x.png"
cp "$ICONS_DIR/icon512.png" "$ICONSET_DIR/icon_512x512.png"
cp "$ICONS_DIR/icon1024.png" "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$ICONS_DIR/icon.icns"
rm -rf "$ICONSET_DIR"

echo ""
echo "Done! Icons generated from square SVG."
echo "The icon now fills the full canvas - macOS will apply its rounded mask."
echo ""
echo "Clear cache and rebuild:"
echo "  rm -rf ~/Library/Caches/electron-builder dist/"
echo "  npm run build:mac"
