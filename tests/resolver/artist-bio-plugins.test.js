/**
 * The biography capability (#1539 step 6): Last.fm's artist.getinfo, the
 * Wikipedia bio (through Wikidata) and the Discogs profile, moved out of
 * app.js (getLastfmBio, getWikipediaBio, getDiscogsBio) into the plug-ins.
 * Loads the built plug-ins (plugins/*.axe, from scripts/build-axes.js)
 * through the real loader, so `this.lib` and the instance are as in the app.
 */
const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

const axeOf = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, `../../plugins/${id}.axe`), 'utf8'));

let loader;
let calls;
const reply = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });
const mockFetch = (handler) => {
  calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
};

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  loader = new ResolverLoader();
  await loader.loadResolvers(['lastfm', 'wikipedia', 'discogs'].map(axeOf));
});
afterEach(() => {
  delete global.fetch;
  jest.restoreAllMocks();
});

const KEY = 'secret-key-123';
const RADIOHEAD = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';

describe('manifests', () => {
  test('Last.fm, Wikipedia and Discogs declare biography and implement getArtistBio', () => {
    for (const id of ['lastfm', 'wikipedia', 'discogs']) {
      const axe = axeOf(id);
      expect(axe.capabilities.biography).toBe(true);
      expect(typeof axe.implementation.getArtistBio).toBe('string');
    }
    expect(loader.getBiographyResolvers().map((r) => r.id).sort()).toEqual(['discogs', 'lastfm', 'wikipedia']);
  });
});

describe('Last.fm getArtistBio', () => {
  const content = 'Radiohead are an English rock band formed in Abingdon, Oxfordshire, in 1985. The band &amp; friends.\n\n'
    + '<a href="https://www.last.fm/music/Radiohead">Read more on Last.fm</a>. User-contributed text is available under the Creative Commons By-SA License; additional terms may apply.';
  const summary = 'Radiohead are an English rock band formed in Abingdon, Oxfordshire, in 1985. <a href="https://www.last.fm/music/Radiohead">Read more on Last.fm</a>';

  test('asks artist.getinfo and answers the bio without its link and licence line', async () => {
    mockFetch(() => reply({ artist: { name: 'Radiohead', url: 'https://www.last.fm/music/Radiohead', bio: { content, summary } } }));
    const bio = await loader.getArtistBio('lastfm', { name: 'Radiohead' }, { apiKey: KEY });
    expect(bio).toEqual({
      text: 'Radiohead are an English rock band formed in Abingdon, Oxfordshire, in 1985. The band & friends.',
      summary: 'Radiohead are an English rock band formed in Abingdon, Oxfordshire, in 1985.',
      url: 'https://www.last.fm/music/Radiohead',
    });
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('method')).toBe('artist.getinfo');
    expect(u.searchParams.get('artist')).toBe('Radiohead');
  });

  test('an empty or stub bio, or error 6, is a miss', async () => {
    mockFetch(() => reply({ artist: { name: 'X', bio: { content: '', summary: ' <a href="https://www.last.fm/music/X">Read more on Last.fm</a>' } } }));
    await expect(loader.getArtistBio('lastfm', { name: 'X' }, { apiKey: KEY })).resolves.toBeNull();
    mockFetch(() => reply({ error: 6, message: 'The artist you supplied could not be found' }));
    await expect(loader.getArtistBio('lastfm', { name: 'Nobody' }, { apiKey: KEY })).resolves.toBeNull();
  });

  test('a failure, an error body or no key throws, and never shows the key', async () => {
    mockFetch(() => reply(null, { ok: false, status: 500 }));
    const err = await loader.getArtistBio('lastfm', { name: 'Radiohead' }, { apiKey: KEY }).catch((e) => e);
    expect(err.message).toContain('500');
    expect(err.message).not.toContain(KEY);
    mockFetch(() => reply({ error: 29, message: 'Rate limit exceeded' }));
    await expect(loader.getArtistBio('lastfm', { name: 'Radiohead' }, { apiKey: KEY })).rejects.toThrow('error 29');
    mockFetch(() => reply({}));
    await expect(loader.getArtistBio('lastfm', { name: 'Radiohead' }, {})).rejects.toThrow('no API key');
    expect(calls).toHaveLength(0);
  });
});

describe('Wikipedia getArtistBio', () => {
  const lead = 'Radiohead are an English rock band formed in Abingdon, Oxfordshire, in 1985.';
  const answers = (url) => {
    if (url.includes('list=search')) return reply({ query: { search: [{ title: 'Q44190' }] } });
    if (url.includes('wbgetentities')) return reply({ entities: { Q44190: { sitelinks: { enwiki: { title: 'Radiohead (band)' } } } } });
    if (url.includes('prop=extracts')) return reply({ query: { pages: { 123: { extract: `${lead}\n\n== References ==\nA ref` } } } });
    throw new Error(`unexpected ${url}`);
  };

  test('finds the article through Wikidata and trims it', async () => {
    mockFetch(answers);
    const bio = await loader.getArtistBio('wikipedia', { name: 'Radiohead', mbid: RADIOHEAD }, {});
    expect(bio).toEqual({ text: lead, url: 'https://en.wikipedia.org/wiki/Radiohead_(band)' });
    expect(calls[0].url).toContain(encodeURIComponent(`haswbstatement:P434=${RADIOHEAD}`));
    expect(calls[2].url).toContain('prop=extracts&explaintext=1');
    expect(calls.some((c) => c.url.includes('musicbrainz.org'))).toBe(false);
  });

  test('the Wikidata id is kept for the session: a second bio skips the search', async () => {
    mockFetch(answers);
    await loader.getArtistBio('wikipedia', { name: 'Radiohead', mbid: RADIOHEAD }, {});
    calls.length = 0;
    await loader.getArtistBio('wikipedia', { name: 'Radiohead', mbid: RADIOHEAD }, {});
    expect(calls.some((c) => c.url.includes('list=search'))).toBe(false);
  });

  test('falls back to MusicBrainz url-rels, in the background lane, when Wikidata has no P434', async () => {
    mockFetch((url, options) => {
      if (url.includes('list=search')) return reply({ query: { search: [] } });
      if (url.includes('musicbrainz.org')) {
        expect(options.mbBackground).toBe(true);
        return reply({ relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q44190' } }] });
      }
      return answers(url);
    });
    await expect(loader.getArtistBio('wikipedia', { name: 'Radiohead', mbid: RADIOHEAD }, {})).resolves.toMatchObject({ text: lead });
  });

  test('no MBID, no Wikidata entry or no English article is a miss', async () => {
    mockFetch(answers);
    await expect(loader.getArtistBio('wikipedia', { name: 'Radiohead' }, {})).resolves.toBeNull();
    expect(calls).toHaveLength(0);
    mockFetch((url) => (url.includes('list=search') ? reply({ query: { search: [] } }) : reply({ relations: [] })));
    await expect(loader.getArtistBio('wikipedia', { name: 'X', mbid: RADIOHEAD }, {})).resolves.toBeNull();
    mockFetch((url) => (url.includes('wbgetentities') ? reply({ entities: { Q44190: { sitelinks: {} } } }) : answers(url)));
    await expect(loader.getArtistBio('wikipedia', { name: 'X', mbid: RADIOHEAD.replace('a', 'b') }, {})).resolves.toBeNull();
  });

  test('a failed request throws', async () => {
    mockFetch((url) => (url.includes('prop=extracts') ? reply(null, { ok: false, status: 503 }) : answers(url)));
    await expect(loader.getArtistBio('wikipedia', { name: 'Radiohead', mbid: RADIOHEAD }, {})).rejects.toThrow('503');
    mockFetch((url) => (url.includes('list=search') ? reply(null, { ok: false, status: 500 }) : reply(null, { ok: false, status: 503 })));
    await expect(loader.getArtistBio('wikipedia', { name: 'Radiohead', mbid: 'c74b1b7f-71a5-4011-9441-d0b5e4122711' }, {})).rejects.toThrow('MusicBrainz');
  });
});

describe('Discogs getArtistBio', () => {
  const TOKEN = 'discogs-token-xyz';
  const profile = 'renie cares is a [b]Ukrainian[/b] band.\r\n[a17632854] – vocals\r\n[l99] – label';
  const answers = (url) => {
    if (url.includes('/database/search')) return reply({ results: [{ id: 1, title: 'Renie Cares (2)' }, { id: 15225678, title: 'renie cares' }] });
    if (url.endsWith('/artists/15225678')) return reply({ id: 15225678, uri: 'https://www.discogs.com/artist/15225678-renie-cares', profile, members: [{ id: 17632854, name: 'Iryna Panchuk (2)' }] });
    if (url.endsWith('/labels/99')) return reply({ name: 'Some Label' });
    throw new Error(`unexpected ${url}`);
  };

  test('takes the same-named result, resolves references and keeps the tags', async () => {
    mockFetch(answers);
    const bio = await loader.getArtistBio('discogs', { name: 'Renie Cares' }, { personalAccessToken: TOKEN });
    expect(bio).toEqual({
      text: 'renie cares is a [b]Ukrainian[/b] band.\nIryna Panchuk – vocals\nSome Label – label',
      url: 'https://www.discogs.com/artist/15225678-renie-cares',
      markup: 'bbcode',
    });
    expect(calls[0].options.headers.Authorization).toBe(`Discogs token=${TOKEN}`);
    expect(calls.map((c) => c.url)).not.toContain('https://api.discogs.com/artists/17632854');
  });

  test('no results or no profile is a miss', async () => {
    mockFetch(() => reply({ results: [] }));
    await expect(loader.getArtistBio('discogs', { name: 'Nobody' }, {})).resolves.toBeNull();
    mockFetch((url) => (url.includes('/database/search') ? reply({ results: [{ id: 5, title: 'X' }] }) : reply({ id: 5, profile: '' })));
    await expect(loader.getArtistBio('discogs', { name: 'X' }, {})).resolves.toBeNull();
  });

  test('a failed request throws, and never shows the token', async () => {
    mockFetch(() => reply(null, { ok: false, status: 429 }));
    const err = await loader.getArtistBio('discogs', { name: 'X' }, { personalAccessToken: TOKEN }).catch((e) => e);
    expect(err.message).toContain('429');
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('resolver-loader getArtistBio', () => {
  const register = (id, capabilities, impl) => loader.resolvers.set(id, { id, capabilities, config: {}, ...impl });

  test('keeps text, summary, an https url and bbcode markup; drops the rest', async () => {
    register('a', { biography: true }, { getArtistBio: async () => ({ text: ' A bio. ', summary: '', url: 'javascript:alert(1)', markup: 'html', extra: 1 }) });
    await expect(loader.getArtistBio('a', { name: 'A' })).resolves.toEqual({ text: 'A bio.' });
    register('b', { biography: true }, { getArtistBio: async () => ({ text: 'B', summary: 'S', url: 'https://b.example/x', markup: 'bbcode' }) });
    await expect(loader.getArtistBio('b', { name: 'B' })).resolves.toEqual({ text: 'B', summary: 'S', url: 'https://b.example/x', markup: 'bbcode' });
  });

  test('no text, no capability or no method is null; a throw rejects', async () => {
    register('empty', { biography: true }, { getArtistBio: async () => ({ text: '  ' }) });
    register('nocap', {}, { getArtistBio: async () => ({ text: 'x' }) });
    register('nomethod', { biography: true }, {});
    register('bad', { biography: true }, { getArtistBio: async () => { throw new Error('refused'); } });
    await expect(loader.getArtistBio('empty', { name: 'A' })).resolves.toBeNull();
    await expect(loader.getArtistBio('nocap', { name: 'A' })).resolves.toBeNull();
    await expect(loader.getArtistBio('nomethod', { name: 'A' })).resolves.toBeNull();
    await expect(loader.getArtistBio('missing', { name: 'A' })).resolves.toBeNull();
    await expect(loader.getArtistBio('bad', { name: 'A' })).rejects.toThrow('refused');
    expect(loader.getBiographyResolvers().map((r) => r.id)).toEqual(expect.arrayContaining(['empty', 'bad']));
    expect(loader.getBiographyResolvers().map((r) => r.id)).not.toContain('nomethod');
  });
});
