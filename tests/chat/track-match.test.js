/**
 * pickTrackMatch: which search result, if any, is the track that was asked for.
 *
 * Every path that plays a named track (parachord://play, the AI play and
 * queue_add tools, chat links) goes through this. A search result carries its
 * own names, so once it reaches handlePlay it validates against itself: this is
 * the only place that can refuse a wrong song (#1241).
 */

const fs = require('fs');
const path = require('path');
const { pickTrackMatch } = require('../../sync-providers/track-match');

const ROOT = path.join(__dirname, '..', '..');

describe('pickTrackMatch', () => {
  describe('refuses a different song', () => {
    test('the #1241 case: nothing in the results is the requested track', () => {
      const results = [
        { artist: 'The Avett Brothers', title: 'Untitled #4' },
        { artist: 'Someone Else', title: 'Another Song' },
      ];
      expect(pickTrackMatch(results, 'Biohio', 'Happy Me')).toBeNull();
    });

    test('the right title by another artist', () => {
      expect(pickTrackMatch([{ artist: 'Radio Dept.', title: 'Creep' }], 'Radiohead', 'Creep')).toBeNull();
    });

    test('another title by the right artist', () => {
      expect(pickTrackMatch([{ artist: 'Radiohead', title: 'Karma Police' }], 'Radiohead', 'Creep')).toBeNull();
    });

    test('non-Latin names do not collapse into a match', () => {
      expect(pickTrackMatch([{ artist: 'Хлеб', title: 'Молоко' }], 'Хлеб', 'Яйца')).toBeNull();
    });

    test('no results, or a result with no names', () => {
      expect(pickTrackMatch([], 'A', 'B')).toBeNull();
      expect(pickTrackMatch(null, 'A', 'B')).toBeNull();
      expect(pickTrackMatch([{ title: 'B' }, { artist: 'A' }], 'A', 'B')).toBeNull();
    });
  });

  describe('accepts the same song written differently', () => {
    test.each([
      ['case', 'radiohead', 'creep', 'Radiohead', 'Creep'],
      ['a curly apostrophe', 'Queen', 'Don’t Stop Me Now', 'Queen', "Don't Stop Me Now"],
      ['a missing apostrophe', 'Queen', 'Dont Stop Me Now', 'Queen', "Don't Stop Me Now"],
      ['accents', 'Beyoncé', 'Déjà Vu', 'Beyonce', 'Deja Vu'],
      ['punctuation', 'R.E.M.', 'Losing My Religion', 'REM', 'Losing My Religion'],
      ['a catalog suffix', 'Queen', 'Bohemian Rhapsody - Remastered 2011', 'Queen', 'Bohemian Rhapsody'],
      ['a featured artist', 'Drake feat. Rihanna', 'Take Care', 'Drake', 'Take Care'],
      ['a full band name', 'Tom Petty and the Heartbreakers', 'Refugee', 'Tom Petty', 'Refugee'],
      ['non-Latin names', '東京事変', '群青日和', '東京事変', '群青日和'],
    ])('%s', (_label, resultArtist, resultTitle, artist, title) => {
      const result = { artist: resultArtist, title: resultTitle };
      expect(pickTrackMatch([result], artist, title)).toBe(result);
    });
  });

  describe('order of preference', () => {
    test('an exact match beats an earlier partial one', () => {
      const partial = { artist: 'Radiohead', title: 'Creep - Remastered' };
      const exact = { artist: 'Radiohead', title: 'Creep' };
      expect(pickTrackMatch([partial, exact], 'Radiohead', 'Creep')).toBe(exact);
    });

    test('the plain version beats an earlier cover or live cut', () => {
      const live = { artist: 'Radiohead', title: 'Creep (Live)' };
      const plain = { artist: 'Radiohead', title: 'Creep - Remastered' };
      expect(pickTrackMatch([live, plain], 'Radiohead', 'Creep')).toBe(plain);
    });

    test('another version still plays when it is all there is', () => {
      const live = { artist: 'Radiohead', title: 'Creep (Live)' };
      expect(pickTrackMatch([live], 'Radiohead', 'Creep')).toBe(live);
    });

    test('a version the request names is an exact match, not another version', () => {
      const plain = { artist: 'The Strokes', title: 'Take Me Out' };
      const live = { artist: 'The Strokes', title: 'Take Me Out (Live)' };
      expect(pickTrackMatch([plain, live], 'The Strokes', 'Take Me Out (Live)')).toBe(live);
    });

    test('a recording id beats the names', () => {
      const byName = { artist: 'Radiohead', title: 'Creep' };
      const byMbid = { artist: 'Radiohead', title: 'Creep (Acoustic)', mbid: 'abc' };
      expect(pickTrackMatch([byName, byMbid], 'Radiohead', 'Creep', { mbid: 'abc' })).toBe(byMbid);
    });

    test('an ISRC beats the names, ignoring case and spaces', () => {
      const byName = { artist: 'Radiohead', title: 'Creep' };
      const byIsrc = { artist: 'Radiohead', title: 'Creep (Acoustic)', isrc: 'gbayd9200001 ' };
      expect(pickTrackMatch([byName, byIsrc], 'Radiohead', 'Creep', { isrc: 'GBAYD9200001' })).toBe(byIsrc);
    });
  });
});

describe('no play path falls back to the first result', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
  const tools = fs.readFileSync(path.join(ROOT, 'tools/dj-tools.js'), 'utf8');

  // A name check followed by `|| results[0]` is the #1241 bug.
  const FALLBACK = /r\.title\?\.toLowerCase\(\)[^;]*?\|\|\s*results\[0\]/;

  test('app.js', () => expect(app).not.toMatch(FALLBACK));
  test('tools/dj-tools.js', () => expect(tools).not.toMatch(FALLBACK));

  test('a parachord://play link that finds nothing leaves the queue alone', () => {
    const start = app.indexOf('// Default: parachord://play?artist=X&title=Y');
    expect(start).toBeGreaterThan(-1);
    const block = app.slice(start, app.indexOf("case 'control':", start));
    const picked = block.indexOf('pickTrackMatch(');
    expect(picked).toBeGreaterThan(-1);
    expect(block.indexOf('clearQueue()')).toBeGreaterThan(picked);
    expect(block.indexOf('exitSpinoffRef.current()')).toBeGreaterThan(picked);
    expect(block.indexOf('deactivateListenAlongRef.current()')).toBeGreaterThan(picked);
  });

  // The handler swapped in a loading placeholder before the switch, which took
  // the current track off the playbar for a link that then found nothing.
  test('a parachord://play link changes nothing while it searches', () => {
    const start = app.indexOf('// Surface a quick acknowledgment toast for commands');
    expect(start).toBeGreaterThan(-1);
    const end = app.indexOf('_protocolLoading: true', start);
    expect(end).toBeGreaterThan(start);
    const guard = app.slice(app.lastIndexOf('if (', app.indexOf('const placeholderTitle', start)), end);
    expect(guard).not.toMatch(/if \(command === 'play'/);
    expect(app.slice(start, end)).toMatch(/\['album', 'playlist', 'radio'\]\.includes\(playKind\)/);
  });

  test('a chat link that finds nothing says so', () => {
    const start = app.indexOf('// Handle common protocol commands from chat links');
    expect(start).toBeGreaterThan(-1);
    const block = app.slice(start, app.indexOf("case 'queue':", start));
    expect(block).toContain('pickTrackMatch(');
    expect(block).toContain('Could not find');
  });
});

describe('the packaged app can load the matcher', () => {
  // package.json build.files excludes src/, and main.js loads tools/dj-tools.js
  // through services/mcp-server.js. A require into src/ from any of these works
  // in dev and jest, then crashes the packaged app at launch.
  test.each([
    'tools/dj-tools.js',
    'sync-providers/track-match.js',
    'sync-providers/track-variants.js',
  ])('%s requires nothing under src/', (file) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(source).not.toMatch(/require\(['"][^'"]*\bsrc\//);
  });
});
