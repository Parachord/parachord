/**
 * A compilation's tracklist (2026-11-23): each row names its own artist and
 * is keyed, played and resolved under it. The page used to send every track as
 * "Various Artists", which never matched a source, and showed no artist.
 */

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { ReleasePage } = require('../../src/renderer/components/cards');
const { trackSlug } = require('../../src/renderer/lib/track-slug');

const VA = { id: '89ad4ac3-39f7-470e-963a-56509c546377', name: 'Various Artists' };
const compilation = {
  id: 'rel-1', title: 'Trainspotting', artist: VA, releaseType: 'album', albumArt: null,
  tracks: [
    { position: 1, title: 'Lust for Life', trackArtist: 'Iggy Pop' },
    { position: 2, title: 'Deep Blue Day', trackArtist: 'Brian Eno' },
  ],
};
const album = {
  id: 'rel-2', title: 'OK Computer', artist: { id: 'rh', name: 'Radiohead' }, releaseType: 'album', albumArt: null,
  tracks: [{ position: 1, title: 'Airbag' }, { position: 2, title: 'Paranoid Android' }],
};
const render = (release, extra = {}) => renderToStaticMarkup(React.createElement(ReleasePage, { release, ...extra }));

describe('a compilation\'s tracklist', () => {
  test('each row names its own artist, as a link to that artist', () => {
    const html = render(compilation, { onOpenArtist: () => {} });
    expect(html).toMatch(/<button[^>]*>Iggy Pop<\/button>/);
    expect(html).toMatch(/<button[^>]*>Brian Eno<\/button>/);
  });

  test('each row is keyed under its own artist (the id its sources are kept under)', () => {
    const html = render(compilation);
    expect(html).toContain(`data-track-id="${trackSlug('Iggy Pop', 'Lust for Life', 'Trainspotting')}"`);
    expect(html).not.toContain(`data-track-id="${trackSlug('Various Artists', 'Lust for Life', 'Trainspotting')}"`);
  });

  test('an album by one artist has no artist column, and keeps its ids', () => {
    const html = render(album, { onOpenArtist: () => {} });
    expect(html).not.toContain('>Radiohead</button>');
    expect(html).toContain(`data-track-id="${trackSlug('Radiohead', 'Airbag', 'OK Computer')}"`);
  });

  test('loading, a Various Artists album\'s skeleton has the artist column; another album\'s doesn\'t', () => {
    const columns = (html) => (html.match(/flex:0\.7 1 0/g) || []).length;
    expect(columns(render({ ...compilation, tracks: null }))).toBe(10);
    expect(columns(render({ ...album, tracks: null }))).toBe(0);
  });
});

describe('every path that plays an album\'s tracks uses the same track (lib/album-track-artist.js)', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer', p), 'utf8');
  test('MusicBrainz track lists keep each track\'s own artist', () => {
    const app = read('app.js');
    // The album page's two loads, and the four background track lists.
    expect((app.match(/trackArtist: ownTrackArtist\(track, releaseData\['artist-credit'\]\)/g) || []).length).toBe(5);
    expect(app).toContain("artist: ownTrackArtist(track, releaseData['artist-credit']) || album.artist,");
  });
  test('no page builds an album track by hand under the album\'s artist', () => {
    expect(read('components/artist-page.js')).not.toMatch(/trackSlug\(\w[\w?.]* \|\| 'unknown', t\.title \|\| 'untitled', \w+\.title \|\| 'noalbum'\)/);
    expect(read('components/cards.js')).not.toMatch(/trackSlug\(release\.artist\.name \|\| 'unknown'/);
    expect(read('app.js')).not.toMatch(/trackSlug\(artistName \|\| 'unknown', (track|t)\.title \|\| 'untitled', \w+(\.title)? \|\| 'noalbum'\)/);
  });
});
