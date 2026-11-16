/**
 * #1388: dialog and empty-state titles are sentence case. A title with two
 * or more capitalised words is Title Case unless the capitals are names
 * (services, Parachord, feature names).
 */
const fs = require('fs');
const path = require('path');

const NAMES = /Apple Music|Amazon Music|Spotify|Parachord|Last\.fm|ListenBrainz|Recent Loves|Fresh Drops|Critical Darlings|Pop of the Tops|Shuffleupagus|Collection|Plug-Ins|Chrome Web Store|Firefox Add-ons/g;
// Sample playlist data, not titles.
const SAMPLES = new Set(['Midnight Dreams', 'Electric Pulse', 'Ocean Breeze', 'Urban Nights', 'Forest Path']);

test('no Title Case titles', () => {
  const dir = path.join(__dirname, '../../src/renderer');
  const files = ['app.js', ...['components', 'hooks'].flatMap((d) => fs.readdirSync(path.join(dir, d)).map((f) => `${d}/${f}`))];
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/title: '([^'$]+)'/g)) {
      const t = m[1];
      if (SAMPLES.has(t)) continue;
      // Settings section headings are Title Case (CLAUDE.md "Copy"); CSS
      // draws them in capitals.
      if (src.slice(Math.max(0, m.index - 30), m.index).endsWith('SettingsSection, { ')) continue;
      const words = t.replace(NAMES, 'x').split(/\s+/).slice(1);
      if (words.filter((w) => /^[A-Z][a-z]/.test(w)).length >= 2) hits.push(`${f}: ${t}`);
    }
  }
  expect(hits).toEqual([]);
});
