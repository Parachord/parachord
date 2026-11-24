/**
 * "Various Artists" is MusicBrainz's placeholder on a compilation, not an
 * artist: its page showed 300 unrelated releases, a bio, related artists and
 * tour dates (2026-11-24). It has no page, and nothing links to one.
 */

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { hasArtistPage } = require('../../src/renderer/lib/artist-page-name');
const { AlbumCard } = require('../../src/renderer/components/album-card');
const { TrackRow } = require('../../src/renderer/components/track-lists');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer', p), 'utf8');
const app = read('app.js');
const VA_ID = '89ad4ac3-39f7-470e-963a-56509c546377';

describe('hasArtistPage', () => {
  test('not for Various Artists, by name or by MusicBrainz id', () => {
    expect(hasArtistPage('Various Artists')).toBe(false);
    expect(hasArtistPage(' various artists ')).toBe(false);
    expect(hasArtistPage({ name: 'Various Artists' })).toBe(false);
    expect(hasArtistPage({ name: 'Verschiedene Interpreten', id: VA_ID })).toBe(false);
    expect(hasArtistPage({ name: 'Varios', mbid: VA_ID })).toBe(false);
  });
  test('not for no name', () => {
    for (const none of [null, undefined, '', '  ', {}, { name: '' }]) expect(hasArtistPage(none)).toBe(false);
  });
  test('a real act that only sounds like it has one ("Various" is a band)', () => {
    for (const name of ['Various', 'The Various Artists', 'Various Cruelties', 'Various Artists Genève', 'Radiohead']) expect(hasArtistPage(name)).toBe(true);
  });
});

describe('nothing links to it', () => {
  const card = (artist) => renderToStaticMarkup(React.createElement(AlbumCard, { album: { title: 'Trainspotting', artist }, onOpen: () => {}, onOpenArtist: () => {} }));
  test('an album card names it as plain text; any other artist is a link', () => {
    expect(card('Various Artists')).toContain('Various Artists');
    expect(card('Various Artists')).not.toMatch(/<button[^>]*>Various Artists<\/button>/);
    expect(card('Radiohead')).toMatch(/<button[^>]*>Radiohead<\/button>/);
  });
  const row = (artist) => renderToStaticMarkup(React.createElement(TrackRow, {
    track: { id: 't', title: 'T', artist }, number: '01', sources: { trackSources: {}, playbackResolvers: [], resolverOrder: [] }, allResolvers: [], onOpenArtist: () => {},
  }));
  test('so does a track row', () => {
    expect(row('Various Artists')).not.toMatch(/<button[^>]*>Various Artists<\/button>/);
    expect(row('Radiohead')).toMatch(/<button[^>]*>Radiohead<\/button>/);
  });
  test.each([
    ['components/critics-picks-page.js', 'hasArtistPage(album.artist)'],
    ['components/playbar.js', 'hasArtistPage(currentTrack.artist)'],
    ['components/track-lists.js', 'hasArtistPage(track.artist)'],
  ])('%s checks before linking', (file, check) => {
    expect(read(file)).toContain(check);
  });
});

describe('the album page', () => {
  const page = read('components/artist-page.js');
  const header = page.slice(page.indexOf('// Release page - artist header'), page.indexOf('// Two-column layout: album art'));
  test('names it without a link, a photo or the artist\'s tabs', () => {
    expect(header).toContain('const albumArtist = currentRelease.artist?.name || currentArtist?.name;');
    expect(header).toContain('const artistHasPage = hasArtistPage(currentRelease.artist || currentArtist);');
    expect(header).toMatch(/artistHasPage && artistImage/);
    expect(header).toMatch(/artistHasPage && React\.createElement\('div', \{\s*className: 'flex items-center gap-1',/);
    // The bar's name and the breadcrumb: a button only when there is a page.
    expect((header.match(/artistHasPage \? React\.createElement\('button'/g) || []).length).toBe(1);
    expect(header).toContain('hasArtistPage(currentRelease?.artist || currentArtist) ? React.createElement(\'button\'');
  });
});

describe('app.js', () => {
  const body = (marker, length) => { const s = app.indexOf(marker); expect(s).toBeGreaterThan(-1); return app.slice(s, s + length); };
  test('fetchArtistData refuses it before touching the page, and a restored compilation still opens', () => {
    const fn = body('const fetchArtistData = async (artistName, options = {}) => {', 1400);
    const guard = fn.indexOf('if (!hasArtistPage(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf('setCurrentRelease(null)'));
    expect(fn).toContain('if (pendingReleaseLoad.current) {');
    expect(fn).toContain('setCurrentArtist({ id: null, name: artistName });');
  });
  test('restoring a saved Various Artists page with no album goes Home', () => {
    expect(app).toContain("if (savedLastView.view === 'artist' && savedLastView.artistName && (savedLastView.releaseId || hasArtistPage(savedLastView.artistName))) {");
    expect(app).toContain("} else if (savedLastView.view === 'artist') {");
  });
  test('a deep link and a chat link check before leaving the page they are on', () => {
    expect((app.match(/if \(hasArtistPage\(\w+(\[0\])?\)\) setActiveView\('artist'\);/g) || []).length).toBe(2);
  });
  test('nothing is looked up about it: concerts, bio, related artists, photo', () => {
    expect(app).toContain('if (hasArtistPage(currentArtist)) {\n      loadArtistConcerts(currentArtist.name);');
    expect(app).toContain('if (!currentArtist || !hasArtistPage(currentArtist)) return;');
    expect(body('const getArtistImage = async (', 200)).toContain('if (!hasArtistPage(artistName)) return null;');
  });
  test('search doesn\'t list it, and it can\'t be followed', () => {
    expect(app).toContain('reRankResults([...(mb.artists || []), ...derived].filter(a => hasArtistPage(a)), query');
    expect(app).toContain('artists: (cachedResults.artists || prev.artists).filter(a => hasArtistPage(a)),');
    expect(body('const addArtistToCollection = useCallback((artist) => {', 200)).toContain('if (!hasArtistPage(artist)) return;');
  });
  test('Back leaves the album instead of showing its artist page', () => {
    expect(body('const navigateBack = () => {', 1200)).toContain('|| !hasArtistPage(currentRelease.artist || currentArtist)');
  });
  test('it never joins the artist history (Back from a track\'s artist opened its page)', () => {
    expect(body('const fetchArtistData = async (artistName, options = {}) => {', 2400)).toContain("if (activeView === 'artist' && hasArtistPage(currentArtist) && currentArtist.name !== artistName) {");
  });
  test('a compilation that can\'t be found says so on its page, with a retry', () => {
    expect(app).toMatch(/if \(!hasArtistPage\(album\.artist\)\) \{[\s\S]{0,300}showReleaseLoadError\(placeholderId, [\s\S]{0,120}kind: 'chartsAlbum', album/);
    expect(app).toMatch(/if \(!hasArtistPage\(track\.artist\)\) \{[\s\S]{0,300}showReleaseLoadError\(placeholderId, /);
  });
});
