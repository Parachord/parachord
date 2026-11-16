// src/renderer/lib/motion.js: inline-style transitions on the motion tokens
// (index.html --motion-* / --ease-*, #1450).
//
//   transition('opacity')                      opacity on base, standard
//   transition('opacity transform', 'slow', 'out')
//   transition([['opacity', 'slow', 'out'], ['transform', 'fast']])
//
// Name the properties that change (opacity, transform, colours, a filter),
// never `all`. A size or position (width, height, left, max-width) only
// where it is the design: a progress fill, the hero's collapse. A raw
// "opacity 0.3s ease" string is counted by the drift script
// (rawTransitions), so every inline transition goes through here.
// Loads under plain Node.

const SPEEDS = new Set(['fast', 'base', 'slow', 'deliberate']);
const EASES = new Set(['standard', 'out', 'in']);

function one(property, speed = 'base', ease = 'standard') {
  if (!SPEEDS.has(speed)) throw new Error(`motion: unknown speed "${speed}"`);
  if (!EASES.has(ease)) throw new Error(`motion: unknown easing "${ease}"`);
  if (property === 'all') throw new Error('motion: name the properties, not "all"');
  return `${property} var(--motion-${speed}) var(--ease-${ease})`;
}

function transition(properties, speed, ease) {
  if (Array.isArray(properties)) return properties.map(([p, s, e]) => one(p, s || speed, e || ease)).join(', ');
  return String(properties).trim().split(/\s+/).map((p) => one(p, speed, ease)).join(', ');
}

module.exports = { transition };
