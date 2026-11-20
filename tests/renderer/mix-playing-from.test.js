/**
 * #1592: a history mix's "Playing from" opens the mix, not Home.
 * The mix context's id is the mix's link (m.url), which is what the
 * service-playlist view needs; a queue saved before the change carries the
 * mix's old id, so both still name the mix.
 */
const fs = require('fs');
const path = require('path');
const m = require('../../src/renderer/lib/home-model');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mixes = [
  { id: 'lb-jams', url: 'https://listenbrainz.org/playlist/aaa', title: 'Daily Jams', resolverId: 'listenbrainz', resolverName: 'ListenBrainz' },
  { id: 'lfm-mix', url: 'https://www.last.fm/player/station/user/x/mix', title: 'Your Mix', resolverId: 'lastfm', resolverName: 'Last.fm' },
];

describe('the mix context', () => {
  test('mixContext keys the context by the mix\'s link', () => {
    expect(m.mixContext(mixes[0])).toEqual({ type: 'mix', id: 'https://listenbrainz.org/playlist/aaa', name: 'Daily Jams' });
  });

  test('mixForContext finds the mix by link, or by the old id', () => {
    expect(m.mixForContext(mixes, { type: 'mix', id: 'https://listenbrainz.org/playlist/aaa' })).toBe(mixes[0]);
    expect(m.mixForContext(mixes, { type: 'mix', id: 'lfm-mix' })).toBe(mixes[1]);
    expect(m.mixForContext(mixes, { type: 'mix', id: 'gone' })).toBeNull();
    expect(m.mixForContext(mixes, { type: 'playlist', id: 'lb-jams' })).toBeNull();
    expect(m.mixForContext(undefined, { type: 'mix', id: 'x' })).toBeNull();
  });

  test('a playing mix is left out of Jump back in, by its link or its old id', () => {
    const byUrl = m.jumpBackInTiles({ playlists: [], loves: [], mixes, active: { playing: m.mixContext(mixes[0]) } });
    expect(byUrl.find((t) => t.kind === 'mix').item.id).toBe('lfm-mix');
    const byOldId = m.jumpBackInTiles({ playlists: [], loves: [], mixes, active: { queued: { type: 'mix', id: 'lb-jams', name: 'Daily Jams' } } });
    expect(byOldId.find((t) => t.kind === 'mix').item.id).toBe('lfm-mix');
  });

  test('isActiveContext matches a mix candidate by link or id', () => {
    const cand = { kind: 'mix', id: 'lb-jams', url: 'https://listenbrainz.org/playlist/aaa' };
    expect(m.isActiveContext(cand, { playing: { type: 'mix', id: 'https://listenbrainz.org/playlist/aaa' } })).toBe(true);
    expect(m.isActiveContext(cand, { playing: { type: 'mix', id: 'lb-jams' } })).toBe(true);
    expect(m.isActiveContext(cand, { playing: { type: 'mix', id: 'other' } })).toBe(false);
  });
});

describe('the code paths', () => {
  test('Home plays and queues a mix with mixContext from home-model', () => {
    const home = read('src/renderer/components/home-page.js');
    expect(home).not.toMatch(/const mixContext = \(m\) =>/);
    expect(home).toMatch(/mixContext\b[^\n]*require\('\.\.\/lib\/home-model'\)|require\('\.\.\/lib\/home-model'\)[^\n]*mixContext/);
  });

  test('"Playing from" for a mix opens the mix (openMixFromContext), not Home', () => {
    const drawer = read('src/renderer/components/queue-drawer.js');
    const i = drawer.indexOf("} else if (playbackContext.type === 'mix') {");
    const branch = drawer.slice(i, drawer.indexOf('} else if', i + 10));
    expect(branch).toMatch(/openMixFromContext\(playbackContext\)/);
    expect(branch).not.toMatch(/navigateTo\('home'\)/);
    expect(drawer).toMatch(/'openMixFromContext',/);
  });

  test('openMixFromContext: the mix on Home, else its link, else Home', () => {
    const app = read('src/renderer/app.js');
    const i = app.indexOf('const openMixFromContext = (ctx) => {');
    expect(i).toBeGreaterThan(0);
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/mixForContext\(homeMixes, ctx\)/);
    expect(fn).toMatch(/openServicePlaylist\(mix, mix\.resolverName\)/);
    expect(fn).toMatch(/findResolverForUrl\(/);
    expect(fn).toMatch(/navigateTo\('home'\)/);
  });
});
