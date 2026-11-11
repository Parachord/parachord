/**
 * The edition picker shows a date and a song count on every row (#1312).
 * Bandcamp's and Amazon's album search carry neither, so their rows were
 * blank; the app now looks those editions up when the menu opens (the same
 * session-cached lookup a pick uses), the row shimmers meanwhile, and
 * Bandcamp's album lookup reads its release date from the page.
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const { renderToStaticMarkup } = require('react-dom/server');
const { albumVersionsKey } = require('../../src/renderer/lib/album-catalog');
const { AlbumVersionsMenu } = require('../../src/renderer/components/cards');

const release = {
  id: 'rel-1',
  title: 'For Emma, Forever Ago',
  artist: { id: null, name: 'Bon Iver' },
  tracks: [{ position: 1, title: 'Flume', length: 200000 }],
};
const resolvers = [{ id: 'bandcamp', name: 'Bandcamp', color: '#629aa9' }, { id: 'amazonmusic', name: 'Amazon Music', color: '#25d1da' }];
const menuWith = (catalogs) => renderToStaticMarkup(React.createElement(AlbumVersionsMenu, {
  release,
  versions: { key: albumVersionsKey(release), loading: false, mb: null, catalogs, serviceCount: catalogs.length },
  resolvers,
}));
const bandcampRow = (fields) => [{
  resolverId: 'bandcamp', resolverName: 'Bandcamp',
  albums: [{ id: 'bc-1', name: 'For Emma, Forever Ago', artist: 'Bon Iver', url: 'https://boniver.bandcamp.com/album/for-emma-forever-ago', releaseDate: null, trackCount: null, ...fields }]
}];

describe('the picker\'s service rows', () => {
  test('a looked-up edition shows its date and song count', () => {
    const html = menuWith(bandcampRow({ releaseDate: '2008-02-19', trackCount: 9 }));
    expect(html).toContain('Feb 19, 2008 · 9 songs');
  });

  test('while the lookup runs, each missing detail is a shimmer', () => {
    const html = menuWith(bandcampRow({ detailsPending: true }));
    expect(html).toContain('aria-label="Loading release date"');
    expect(html).toContain('aria-label="Loading song count"');
  });

  test('only the missing detail shimmers', () => {
    const html = menuWith(bandcampRow({ releaseDate: '2008-02-19', detailsPending: true }));
    expect(html).toContain('Feb 19, 2008');
    expect(html).not.toContain('aria-label="Loading release date"');
    expect(html).toContain('aria-label="Loading song count"');
  });

  test('a lookup that came back empty leaves the row without details, not shimmering', () => {
    const html = menuWith(bandcampRow({ detailsPending: false }));
    expect(html).not.toContain('Loading release date');
    expect(html).not.toContain('Loading song count');
  });
});

describe('app.js looks up the editions missing details', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('through the session-cached edition lookup a pick uses', () => {
    expect(app).toMatch(/const fillAlbumEditionDetails = \(key, sections\) => \{/);
    expect(app).toMatch(/if \(!album\?\.url \|\| \(album\.releaseDate && album\.trackCount\)\) continue;/);
    expect(app).toMatch(/patch\(\{ detailsPending: true \}\);\s*lookupAlbumEditionCached\(section\.resolverId, album\.url\)\.then/);
  });

  test('when a service answers, and again on every open for rows still missing them', () => {
    expect(app).toMatch(/if \(previous\) fillAlbumEditionDetails\(key, previous\.catalogs\);\s*if \(previous && previous\.loading\) return;/);
    expect(app).toMatch(/fillAlbumEditionDetails\(key, \[\{ resolverId: resolver\.id, albums: editions \}\]\);/);
  });
});

describe('Bandcamp lookupAlbum reads the release date', () => {
  const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/bandcamp.axe'), 'utf8'));
  const lookupAlbum = new Function('return ' + axe.implementation.lookupAlbum)();

  const withPage = async (ld) => {
    global.fetch = async () => ({ ok: true, text: async () => '<html></html>' });
    // A minimal DOMParser: the plugin reads the og: meta tags and the
    // ld+json scripts.
    global.DOMParser = class {
      parseFromString() {
        return {
          querySelector: () => null,
          querySelectorAll: () => [{ textContent: JSON.stringify(ld) }],
        };
      }
    };
    try {
      return await lookupAlbum('https://boniver.bandcamp.com/album/for-emma-forever-ago', {});
    } finally {
      delete global.fetch;
      delete global.DOMParser;
    }
  };
  const album = (extra) => ({
    '@type': 'MusicAlbum', name: 'For Emma, Forever Ago', byArtist: { name: 'Bon Iver' },
    track: { itemListElement: [{ position: 1, item: { name: 'Flume', duration: 'P00H03M39S' } }] },
    ...extra
  });

  test('datePublished (a UTC midnight) is the calendar day', async () => {
    const result = await withPage(album({ datePublished: '19 Feb 2008 00:00:00 GMT' }));
    expect(result.releaseDate).toBe('2008-02-19');
    expect(result.trackCount).toBe(1);
  });

  test('no datePublished is no date', async () => {
    const result = await withPage(album({}));
    expect(result.releaseDate).toBeNull();
  });
});
