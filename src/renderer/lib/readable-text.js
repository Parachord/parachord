// Pick the text colour that reads best on a brand-coloured fill: white or
// near-black, white unless it falls under 3:1, then whichever has the higher WCAG contrast. A colour that is not a
// hex string (a CSS variable, nothing) gets white, the accent's text colour.

const LIGHT = '#ffffff';
const DARK = '#111827';

function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function readableTextOn(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return LIGHT;
  const l = luminance(rgb);
  // White wins while it clears 3:1 (the WCAG floor for bold UI text), which
  // keeps saturated reds such as Apple Music's on white; below that, the
  // higher-contrast of the two.
  const white = contrast(1, l);
  return white >= 3 || white >= contrast(l, luminance(parseHex(DARK))) ? LIGHT : DARK;
}

module.exports = { readableTextOn };
