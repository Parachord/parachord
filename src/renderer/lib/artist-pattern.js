// src/renderer/lib/artist-pattern.js: the stand-in art for an artist with
// no photo: a gradient from one of fifteen palettes and the artist's
// initials, picked by a hash of the name so an artist always gets the same
// one. Moved out of components/cards.js.
//
// These palettes are generated art, not interface colour: they look the
// same in both themes on purpose, so they are hex values (the drift
// script's hexColors exempts this file, as it does lib/page-colors.js).
// Pure; loads under plain Node.

const hashString = require('./hash-string');

const generateArtistPattern = (artistName) => {
  const hash = hashString(artistName.toLowerCase());

  // Color palettes - warm, cool, earthy, vibrant, muted - avoiding generic purple/pink
  const palettes = [
    ['#1a1a2e', '#16213e', '#0f3460', '#e94560'], // Deep blue/red
    ['#2d3436', '#636e72', '#b2bec3', '#dfe6e9'], // Slate monochrome
    ['#0c0c0c', '#1c1c1c', '#2d2d2d', '#ff6b35'], // Dark with orange
    ['#1e3a5f', '#3d5a80', '#98c1d9', '#e0fbfc'], // Ocean blues
    ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c'], // Navy/red
    ['#003049', '#d62828', '#f77f00', '#fcbf49'], // French flag warm
    ['#0a0908', '#22333b', '#eae0d5', '#c6ac8f'], // Coffee tones
    ['#10002b', '#240046', '#3c096c', '#5a189a'], // Deep purple (different from old)
    ['#1b4332', '#2d6a4f', '#40916c', '#52b788'], // Forest green
    ['#212529', '#343a40', '#495057', '#adb5bd'], // Cool gray
    ['#003459', '#007ea7', '#00a8e8', '#ffffff'], // Bright blue
    ['#1d3557', '#457b9d', '#a8dadc', '#f1faee'], // Teal slate
    ['#283618', '#606c38', '#dda15e', '#bc6c25'], // Earth tones
    ['#231942', '#5e548e', '#9f86c0', '#be95c4'], // Lavender depth
    ['#0b090a', '#161a1d', '#660708', '#a4161a'], // Dark red
  ];

  const paletteIndex = hash % palettes.length;
  const palette = palettes[paletteIndex];

  // Different gradient patterns based on hash
  const patternType = (hash >> 4) % 6;
  const angle = ((hash >> 8) % 12) * 30; // 0, 30, 60, ... 330 degrees

  let gradient;
  switch (patternType) {
    case 0: // Linear gradient
      gradient = `linear-gradient(${angle}deg, ${palette[0]} 0%, ${palette[1]} 50%, ${palette[2]} 100%)`;
      break;
    case 1: // Radial gradient
      gradient = `radial-gradient(circle at ${30 + (hash % 40)}% ${30 + ((hash >> 2) % 40)}%, ${palette[2]} 0%, ${palette[1]} 40%, ${palette[0]} 100%)`;
      break;
    case 2: // Diagonal split
      gradient = `linear-gradient(${angle}deg, ${palette[0]} 0%, ${palette[0]} 45%, ${palette[2]} 45%, ${palette[2]} 55%, ${palette[1]} 55%, ${palette[1]} 100%)`;
      break;
    case 3: // Soft radial
      gradient = `radial-gradient(ellipse at ${(hash % 80) + 10}% ${((hash >> 3) % 80) + 10}%, ${palette[3] || palette[2]} 0%, ${palette[1]} 50%, ${palette[0]} 100%)`;
      break;
    case 4: // Corner gradient
      const corners = ['top left', 'top right', 'bottom left', 'bottom right'];
      const corner = corners[(hash >> 6) % 4];
      gradient = `radial-gradient(circle at ${corner}, ${palette[2]} 0%, ${palette[1]} 40%, ${palette[0]} 100%)`;
      break;
    default: // Mesh-like
      gradient = `linear-gradient(${angle}deg, ${palette[0]} 0%, ${palette[1]} 25%, ${palette[2]} 50%, ${palette[1]} 75%, ${palette[0]} 100%)`;
  }

  // Generate initials for overlay
  const initials = artistName.split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');

  return {
    gradient,
    initials,
    textColor: palette[3] || palette[2], // Lighter color for text
    accentColor: palette[3] || palette[2]
  };
};

module.exports = { generateArtistPattern };
