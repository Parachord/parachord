// Pick the text colour for a brand-coloured fill: white when it reads (3:1
// or better), else whichever of white or near-black contrasts more. A colour that is not a
// hex string (a CSS variable, nothing) gets white, the accent's text colour.
// It returns the theme tokens (both the same in either theme); the RGB
// values are only for the contrast sums and must match index.html's.

const LIGHT = 'var(--on-accent)'; // white
const DARK = 'var(--on-art-ink)'; // gray-900
const LIGHT_RGB = [255, 255, 255];
const DARK_RGB = [17, 24, 39];

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
  // White wins whenever it reads (3:1, WCAG's floor for bold and large text
  // and UI controls): the plug-in's header is white on the same colour, and
  // most services' own buttons are (Apple Music's red, SoundCloud's orange).
  // Only a fill too light for white (Spotify's green, Amazon's cyan) takes
  // near-black. Picking the higher contrast alone gave Apple's red
  // near-black text under a white header (2026-11-17).
  const onWhite = contrast(luminance(LIGHT_RGB), l);
  if (onWhite >= 3) return LIGHT;
  return onWhite >= contrast(l, luminance(DARK_RGB)) ? LIGHT : DARK;
}

module.exports = { readableTextOn, LIGHT_RGB, DARK_RGB };
