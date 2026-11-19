/**
 * @jest-environment jsdom
 */

/**
 * Bandcamp offers only tracks that stream. An artist can make a track
 * buy-only: Radiohead's own "Nude" and "15 Step" have no audio file on their
 * pages, and Bandcamp's mobile API lists them with no tracks (checked
 * 2026-11-18). The search API doesn't say which tracks stream, so once
 * resolve read 50 rows (#1532) it picked Radiohead's buy-only "Nude": a
 * Bandcamp icon on the row and a failure on play.
 *
 * isStreamable asks the mobile API once per track per session; resolve checks
 * its pick and moves on to the next candidate, search drops what doesn't
 * stream, and album and track pages read it from the page's own player data.
 * Every test mocks fetch: none reaches Bandcamp.
 */

const bandcamp = require('../../plugins-src/bandcamp/implementation');

// A resolver object of its own per test, so the session cache starts empty.
const fresh = () => Object.create(bandcamp);

const SEARCH = 'bcsearch_public_api';
const MOBILE = '/api/mobile/24/tralbum_details';

const row = (id, name, band, extra = {}) => ({
  type: 't', id, band_id: 1000 + id, name, band_name: band, album_name: null,
  item_url_path: `https://x${id}.bandcamp.com/track/t${id}`,
  ...extra,
});

const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const streamable = (id) => json({ id, type: 't', tracks: [{ track_id: id, title: 't', streaming_url: { 'mp3-128': 'https://t4.bcbits.com/stream/x' } }] });
const buyOnly = (id) => json({ id, type: 't', tracks: [] });

// fetch for one test: the search API answers `rows`, the mobile API answers
// from `streams` (track id → true, false, or a reply function).
const install = (rows, streams = {}) => {
  global.fetch = jest.fn(async (url) => {
    if (url.includes(SEARCH)) return json({ auto: { results: rows } });
    if (url.includes(MOBILE)) {
      const id = Number(new URL(url).searchParams.get('tralbum_id'));
      const answer = streams[id];
      if (typeof answer === 'function') return answer(id);
      if (answer === false) return buyOnly(id);
      return streamable(id);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return global.fetch;
};
const mobileCalls = () => global.fetch.mock.calls.filter(([u]) => u.includes(MOBILE));

afterEach(() => { delete global.fetch; });

describe('isStreamable', () => {
  test('a track with a streaming_url streams', async () => {
    install([], {});
    expect(await fresh().isStreamable(1, 2)).toBe(true);
    const [url] = mobileCalls()[0];
    expect(url).toBe('https://bandcamp.com/api/mobile/24/tralbum_details?band_id=1&tralbum_type=t&tralbum_id=2');
  });

  test('an empty track list, or a track without a streaming_url, does not', async () => {
    install([], { 2: false, 3: () => json({ tracks: [{ track_id: 3, title: 'x', streaming_url: null }] }), 4: () => json({ tracks: [{ track_id: 4, title: 'x' }] }) });
    const r = fresh();
    expect(await r.isStreamable(1, 2)).toBe(false);
    expect(await r.isStreamable(1, 3)).toBe(false);
    expect(await r.isStreamable(1, 4)).toBe(false);
  });

  test('an HTTP error, a network error or an odd reply is unknown', async () => {
    install([], {
      2: () => ({ ok: false, status: 503, json: async () => ({}) }),
      3: () => { throw new Error('offline'); },
      4: () => json({ error: true, error_message: 'nope' }),
      5: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } }),
      6: () => json({ tracks: ['nope'] }),
    });
    const r = fresh();
    for (const id of [2, 3, 4, 5, 6]) expect(await r.isStreamable(1, id)).toBeNull();
  });

  test('no ids to check with is unknown, without a request', async () => {
    install([], {});
    expect(await fresh().isStreamable(null, 2)).toBeNull();
    expect(await fresh().isStreamable(1, null)).toBeNull();
    expect(mobileCalls()).toHaveLength(0);
  });

  test('an answer is kept for the session; a failed check is asked again', async () => {
    let fail = true;
    install([], { 2: false, 3: (id) => (fail ? { ok: false, status: 500, json: async () => ({}) } : streamable(id)) });
    const r = fresh();
    expect(await r.isStreamable(1, 2)).toBe(false);
    expect(await r.isStreamable(1, 2)).toBe(false);
    expect(await r.isStreamable(1, 3)).toBeNull();
    fail = false;
    expect(await r.isStreamable(1, 3)).toBe(true);
    expect(await r.isStreamable(1, 3)).toBe(true);
    expect(mobileCalls().map(([u]) => new URL(u).searchParams.get('tralbum_id'))).toEqual(['2', '3', '3']);
  });

  test('checks of the same track at the same time share one request', async () => {
    install([], {});
    const r = fresh();
    const answers = await Promise.all([r.isStreamable(1, 2), r.isStreamable(1, 2), r.isStreamable(1, 2)]);
    expect(answers).toEqual([true, true, true]);
    expect(mobileCalls()).toHaveLength(1);
  });

  test('a check that takes over 2s is unknown', async () => {
    jest.useFakeTimers();
    try {
      install([], { 2: () => new Promise(() => {}) });
      const pending = fresh().isStreamable(1, 2);
      await jest.advanceTimersByTimeAsync(2001);
      expect(await pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('resolve checks its pick', () => {
  test('a buy-only pick comes back purchase-only, and no other Bandcamp copy is tried', async () => {
    install([row(1, 'Nude', 'Radiohead'), row(2, 'Nude', 'Radiohead')], { 1: false });
    const found = await fresh().resolve('Radiohead', 'Nude', 'In Rainbows', {});
    expect(found).toMatchObject({
      bandcampTrackId: 1,
      streamable: false,
      bandcampUrl: 'https://x1.bandcamp.com/track/t1',
      purchaseUrl: 'https://x1.bandcamp.com/track/t1',
    });
    expect(mobileCalls()).toHaveLength(1);
  });

  test('a pick that streams carries no streamable flag', async () => {
    install([row(1, 'Nude', 'Radiohead')], {});
    expect((await fresh().resolve('Radiohead', 'Nude', '', {})).streamable).toBeUndefined();
  });

  test('the first pick that streams costs one check', async () => {
    install([row(1, 'Nude', 'Radiohead'), row(2, 'Nude', 'Radiohead')], {});
    const found = await fresh().resolve('Radiohead', 'Nude', '', {});
    expect(found.bandcampTrackId).toBe(1);
    expect(mobileCalls()).toHaveLength(1);
  });

  test('a failed check keeps its candidate', async () => {
    install([row(1, 'Nude', 'Radiohead'), row(2, 'Nude', 'Radiohead')], { 1: () => ({ ok: false, status: 429, json: async () => ({}) }) });
    expect((await fresh().resolve('Radiohead', 'Nude', '', {})).bandcampTrackId).toBe(1);
  });

  test("a buy-only pick ends the search whoever's page it's on: a fan's copy below it is never taken", async () => {
    const own = row(1, 'Nude', 'Radiohead', { item_url_path: 'https://radiohead.bandcamp.com/track/nude' });
    const fanCopy = row(2, 'nude', 'radiohead', { item_url_path: 'https://meanderpede.bandcamp.com/track/nude' });
    install([own, fanCopy], { 1: false });
    expect(await fresh().resolve('Radiohead', 'Nude', '', {})).toMatchObject({ bandcampTrackId: 1, streamable: false });
    const label = row(3, 'Cleopatra', 'The Lumineers', { item_url_path: 'https://somelabel.bandcamp.com/track/cleopatra' });
    install([label, row(4, 'Cleopatra', 'The Lumineers')], { 3: false });
    expect(await fresh().resolve('The Lumineers', 'Cleopatra', '', {})).toMatchObject({ bandcampTrackId: 3, streamable: false });
    expect(mobileCalls()).toHaveLength(1);
  });

  test('resolve searches without checking every row', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i + 1, `Other ${i}`, `Band ${i}`)).concat([row(99, 'Nude', 'Radiohead')]);
    install(rows, {});
    expect((await fresh().resolve('Radiohead', 'Nude', '', {})).bandcampTrackId).toBe(99);
    expect(mobileCalls()).toHaveLength(1);
  });

  test('a result with no band id is kept unchecked', async () => {
    install([row(1, 'Nude', 'Radiohead', { band_id: undefined })], {});
    expect((await fresh().resolve('Radiohead', 'Nude', '', {})).bandcampTrackId).toBe(1);
    expect(mobileCalls()).toHaveLength(0);
  });
});

describe('search drops what does not stream', () => {
  test('drops buy-only results and keeps unknown ones', async () => {
    install(
      [row(1, 'A', 'X'), row(2, 'B', 'X'), row(3, 'C', 'X'), row(4, 'D', 'X', { band_id: undefined })],
      { 2: false, 3: () => ({ ok: false, status: 500, json: async () => ({}) }) },
    );
    const results = await fresh().search('x', {});
    expect(results.map((r) => r.bandcampTrackId)).toEqual([1, 3, 4]);
    // The row with no band id is never checked.
    expect(mobileCalls()).toHaveLength(3);
  });

  test('checks each track at most once per session', async () => {
    install([row(1, 'A', 'X'), row(2, 'B', 'X')], { 2: false });
    const r = fresh();
    await r.search('x', {});
    await r.search('x again', {});
    expect(mobileCalls()).toHaveLength(2);
    // resolve's pick reuses the answer search got.
    await r.resolve('X', 'A', '', {});
    expect(mobileCalls()).toHaveLength(2);
  });

  test('no more than five checks at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const slow = (id) => {
      inFlight++;
      most = Math.max(most, inFlight);
      return new Promise((resolve) => setTimeout(() => { inFlight--; resolve(streamable(id)); }, 5));
    };
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, `T${i}`, 'X'));
    const streams = {};
    rows.forEach((r) => { streams[r.id] = slow; });
    install(rows, streams);
    expect(await fresh().search('x', {})).toHaveLength(12);
    expect(most).toBe(5);
  });

  test('streamCheck false returns every row unchecked', async () => {
    install([row(1, 'A', 'X'), row(2, 'B', 'X')], { 2: false });
    expect(await fresh().search('x', {}, 20, { streamCheck: false })).toHaveLength(2);
    expect(mobileCalls()).toHaveLength(0);
  });
});

// The page's player data: data-tralbum, HTML-escaped, as Bandcamp serves it.
const tralbumAttr = (data) => JSON.stringify(data).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const FILE = { 'mp3-128': 'https://t4.bcbits.com/stream/x' };

describe('album pages', () => {
  const albumPage = (trackinfo) => {
    const ld = {
      '@type': 'MusicAlbum',
      name: 'In Rainbows',
      byArtist: { name: 'Radiohead' },
      track: {
        itemListElement: [
          { position: 1, item: { name: '15 Step', '@id': 'https://radiohead.bandcamp.com/track/15-step' } },
          { position: 2, item: { name: 'Bodysnatchers', '@id': 'https://radiohead.bandcamp.com/track/bodysnatchers' } },
          { position: 3, item: { name: 'Nude', '@id': 'https://radiohead.bandcamp.com/track/nude' } },
        ],
      },
    };
    const player = trackinfo
      ? `<div id="pagedata"></div><script data-tralbum="${tralbumAttr({ id: 10, item_type: 'album', current: { band_id: 20 }, trackinfo })}"></script>`
      : '';
    return `<html><head><meta property="og:image" content="https://f4.bcbits.com/img/a1_10.jpg"></head><body>${player}<script type="application/ld+json">${JSON.stringify(ld)}</script></body></html>`;
  };
  const installPage = (html) => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => html }));
  };

  test('lists every track, and a buy-only one carries a purchase-only source', async () => {
    installPage(albumPage([
      { track_id: 1, title: '15 Step', title_link: '/track/15-step', file: FILE },
      { track_id: 2, title: 'Bodysnatchers', title_link: '/track/bodysnatchers', file: null },
      { track_id: 3, title: 'Nude', title_link: '/track/nude', file: null },
    ]));
    const album = await fresh().lookupAlbum('https://radiohead.bandcamp.com/album/in-rainbows', {});
    expect(album.tracks.map((t) => t.title)).toEqual(['15 Step', 'Bodysnatchers', 'Nude']);
    expect(album.trackCount).toBe(3);
    expect(album.tracks[0]).toMatchObject({ sources: ['bandcamp'], bandcampUrl: 'https://radiohead.bandcamp.com/track/15-step' });
    expect(album.tracks[0].streamable).toBeUndefined();
    for (const t of album.tracks.slice(1)) {
      expect(t.sources).toEqual(['bandcamp']);
      expect(t.bandcampUrl).toMatch(/^https:\/\/radiohead\.bandcamp\.com\/track\//);
      expect(t.purchaseUrl).toBe(t.bandcampUrl);
      expect(t.streamable).toBe(false);
    }
  });

  test("the page's answers are kept: no request to check them again", async () => {
    installPage(albumPage([
      { track_id: 1, title: '15 Step', title_link: '/track/15-step', file: FILE },
      { track_id: 2, title: 'Bodysnatchers', title_link: '/track/bodysnatchers', file: null },
      { track_id: 3, title: 'Nude', title_link: '/track/nude', file: null },
    ]));
    const r = fresh();
    await r.lookupAlbum('https://radiohead.bandcamp.com/album/in-rainbows', {});
    global.fetch = jest.fn(async () => { throw new Error('no request expected'); });
    expect(await r.isStreamable(20, 3)).toBe(false);
    expect(await r.isStreamable(20, 1)).toBe(true);
    // A playlist track that knows a buy-only page gets a purchase-only source.
    expect(r.sourceFromUrl('https://radiohead.bandcamp.com/track/nude', { title: 'Nude', artist: 'Radiohead' }))
      .toMatchObject({ bandcampUrl: 'https://radiohead.bandcamp.com/track/nude', purchaseUrl: 'https://radiohead.bandcamp.com/track/nude', streamable: false });
    const streams = r.sourceFromUrl('https://radiohead.bandcamp.com/track/15-step', { title: '15 Step', artist: 'Radiohead' });
    expect(streams).toMatchObject({ bandcampUrl: 'https://radiohead.bandcamp.com/track/15-step' });
    expect(streams.streamable).toBeUndefined();
  });

  test('a page without player data keeps every source', async () => {
    installPage(albumPage(null));
    const album = await fresh().lookupAlbum('https://radiohead.bandcamp.com/album/in-rainbows', {});
    expect(album.tracks.every((t) => t.sources[0] === 'bandcamp' && t.bandcampUrl)).toBe(true);
  });
});

describe('track pages', () => {
  const trackPage = (file) => {
    const ld = { '@type': 'MusicRecording', name: 'Nude', duration: 'P00H04M15S', byArtist: { name: 'Radiohead' } };
    const player = file === undefined
      ? ''
      : `<script data-tralbum="${tralbumAttr({ id: 3, item_type: 'track', trackinfo: [{ track_id: 3, title: 'Nude', file }] })}"></script>`;
    return `<html><body>${player}<script type="application/ld+json">${JSON.stringify(ld)}</script></body></html>`;
  };
  const lookup = async (html) => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => html }));
    return fresh().lookupUrl('https://radiohead.bandcamp.com/track/nude', {});
  };

  test('a buy-only track comes back as a purchase-only source', async () => {
    const t = await lookup(trackPage(null));
    expect(t).toMatchObject({
      title: 'Nude', artist: 'Radiohead', duration: 255, sources: ['bandcamp'], streamable: false,
      bandcampUrl: 'https://radiohead.bandcamp.com/track/nude', purchaseUrl: 'https://radiohead.bandcamp.com/track/nude',
    });
  });

  test('a streamable track keeps its source', async () => {
    expect(await lookup(trackPage(FILE))).toMatchObject({ sources: ['bandcamp'], bandcampUrl: 'https://radiohead.bandcamp.com/track/nude' });
  });

  test('no player data keeps the source', async () => {
    expect(await lookup(trackPage(undefined))).toMatchObject({ sources: ['bandcamp'], bandcampUrl: 'https://radiohead.bandcamp.com/track/nude' });
  });
});

describe('capabilities.resolvePicks', () => {
  // The play-time resolve asks the plug-in's resolve instead of picking among
  // its search results: search drops buy-only rows, so a pick among them
  // could only be another account's upload, never the purchase-only answer.
  test('Bandcamp declares it', () => {
    const manifest = require('../../plugins-src/bandcamp/manifest.json');
    expect(manifest.capabilities.resolvePicks).toBe(true);
  });
});
