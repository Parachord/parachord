// Unicode-aware track id slugs (src/renderer/lib/track-slug.js).
//
// The legacy id formula — `${artist}-${title}-${album}`.toLowerCase()
// .replace(/[^a-z0-9-]/g, '') — strips every non-ASCII character, so a
// release by a Cyrillic/CJK/Arabic artist collapsed EVERY track to the same
// id: all rows on the release page showed as playing, all rows shared one
// resolution's badges, and clicking any other row re-scored the shared
// source against the clicked row's title and failed the 0.6 confidence
// floor ("No Enabled Source" with the resolver active). Live-reported 2026-10
// on a Король и Шут release — the regression cases below are that report.

const fs = require('fs');
const path = require('path');
const { trackSlug, slug } = require('../../src/renderer/lib/track-slug');

// The exact formula every id site used before the fix.
const legacy = (artist, title, album) =>
  `${artist}-${title}-${album}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

describe('trackSlug', () => {
  test('byte-identical to the legacy formula for pure-ASCII input (no id/cache churn)', () => {
    const battery = [
      ['Quiet Riot', 'Metal Health (Bang Your Head)', 'Metal Health [Clean]'],
      ['Sigur Rós'.normalize('NFKD'), '( )', '( )'], // NFKD-stable ASCII after decomposition
      ['The xx', 'Intro', 'xx'],
      ['A.B. Skhy', 'Marathon (45 version)', 'Marathon!'],
      ['C418', 'Sweden', 'Minecraft - Volume Alpha'],
      ['Panic! At The Disco', "I Write Sins Not Tragedies", 'A Fever You Can\'t Sweat Out'],
    ];
    for (const [a, t, al] of battery) {
      expect(trackSlug(a, t, al)).toBe(legacy(a, t, al));
    }
  });

  test('the reported regression: two tracks on a non-Latin release get different ids', () => {
    const artist = 'Король и Шут';
    const album = 'Два монаха в одну ночь'; // any non-Latin album title collapses the old formula
    const a = trackSlug(artist, 'Два монаха в одну ночь', album);
    const b = trackSlug(artist, 'Воспоминания о былой любви', album);
    expect(a).not.toBe(b);
    // The old formula gave BOTH of them '--' — every track on the release
    // shared one id, one playing-marker match and one shared resolution.
    expect(legacy(artist, 'Два монаха в одну ночь', album)).toBe('--');
    expect(legacy(artist, 'Воспоминания о былой любви', album)).toBe('--');
    // And the artist part survives instead of vanishing.
    expect(a).toContain('корольишут');
  });

  test('CJK and Arabic keep their scripts (distinct per track)', () => {
    const album = '東京事変';
    expect(trackSlug('東京事変', '群青日和', album)).not.toBe(trackSlug('東京事変', '歌舞伎', album));
    expect(trackSlug('فيروز', 'أطفال الحرب', 'فيروز')).not.toBe(trackSlug('فيروز', 'ناطار', 'فيروز'));
  });

  test('umlauts fold (ö → o), matching the confidence-scoring normalizeStr philosophy', () => {
    expect(trackSlug('Motörhead', 'Ace of Spades', 'Ace of Spades')).toBe(
      trackSlug('Motorhead', 'Ace of Spades', 'Ace of Spades')
    );
  });

  test('fallbacks are the caller\'s choice; two-part and single-part forms', () => {
    expect(trackSlug('', '')).toBe('-');
    expect(trackSlug('unknown', 'untitled', 'noalbum')).toBe('unknown-untitled-noalbum');
    expect(trackSlug('Artist', 'Title')).toBe('artist-title');
    expect(slug('Король и Шут')).toBe('корольишут');
    expect(slug(' artist ')).toBe('artist');
  });

  test('undefined album is two-part, not "undefined"', () => {
    expect(trackSlug('A', 'B', undefined)).toBe('a-b');
    expect(trackSlug('A', 'B')).toBe('a-b');
  });
});

// Drift guard: the ASCII-strip id formula must not come back. Every id site
// routes through lib/track-slug.js; a copy-pasted template with the ASCII
// strip re-collapses every non-Latin track to one id.
describe('track-slug drift guard', () => {
  test('no ASCII-strip id formulas remain in app.js or cards.js', () => {
    const files = [
      path.join(__dirname, '../../src/renderer/app.js'),
      path.join(__dirname, '../../src/renderer/components/cards.js'),
    ];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src.includes(".replace(/[^a-z0-9-]/g, '')")).toBe(false);
    }
  });

  test('app.js and cards.js import the helper (a missed site is a silent regression)', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    const cards = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/cards.js'), 'utf8');
    expect(app).toContain("require('./lib/track-slug')");
    expect(cards).toContain("require('../lib/track-slug')");
  });

  // Born from a real CI failure (PR #1079): the artist-id pass added slug(...)
  // calls while the import destructure still said { trackSlug } — a no-undef
  // eslint caught in cards.js, but app.js is legacy-tier (parse-level lint)
  // and would have thrown ReferenceError at runtime. Assert every helper name
  // the files actually call is in the import destructure.
  test('every helper name called is in the import destructure (no runtime ReferenceError)', () => {
    const files = [
      path.join(__dirname, '../../src/renderer/app.js'),
      path.join(__dirname, '../../src/renderer/components/cards.js'),
    ];
    const callSite = (name) => new RegExp(`(?<![\\w.$'"/])${name}\\(`);
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const m = src.match(/const \{([^}]*)\} = require\('\.{1,2}\/lib\/track-slug'\)/);
      expect(m).toBeTruthy();
      const imported = new Set(m[1].split(',').map(s => s.trim()).filter(Boolean));
      for (const name of ['trackSlug', 'slug']) {
        if (callSite(name).test(src)) {
          expect(imported.has(name)).toBe(true);
        }
      }
    }
  });
});
