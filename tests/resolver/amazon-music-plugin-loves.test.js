/**
 * Amazon loves (#1559, step 3b): the like and the likes list
 * (plugins-src/amazonmusic/implementation.js "Loves").
 *
 * Amazon's love signal is the track's LIKE (the Like/Unlike button on every
 * track row) — a signal separate from the library, written by the likeTrack
 * mutation and listed by the LikedSongsPage query, both over the web-session
 * bridge. The shapes are live-captured (2026-11-27;
 * docs/architecture/amazon-music.md "Loves").
 *
 * Pinned here:
 *   - the mutation body is FULL TEXT (no persisted-query hash — a hash
 *     renumbers on every hornet redeploy), likeState LIKE only (never an
 *     unlike), and the reply must echo the like
 *   - the likes parser keeps LIKE rows only (a non-LIKE row never becomes a
 *     love), with the row's own source record on this service, lovedAt null
 *     (Amazon publishes no like dates), and the explicit marker stripped
 *   - loveTrack: no ASIN is no-match, never a guess; signed out throws;
 *     a minted gql entry is reused across likes; a failed mutation throws
 *     (the push retries) and drops the entry so the retry re-mints
 *   - getLovedPage: the first page rides the /my/songs page flow (the load
 *     ends at the page's own LikedSongsPage request — doneWhen — and opts
 *     into judging a half-loaded page), a continuation replays the kept
 *     request with afterCursor, and the page's token pages until
 *     hasNextPage says the end
 *   - structural failures are not-ready, never an empty list: a page that
 *     never asked for the likes, a response that is not the list's shape
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonWebSessionMock,
  amazonLikedSongsCapture,
  amazonLikedSong,
  amazonLikedSongsPage,
  amazonLikeTrackReply,
  serveAmazonLikes
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();
const lib = instantiateAmazonPlugin(axe).requireLib();

const LIKED_A = { asin: 'B073T6BV33', title: 'Soibleed', artist: 'Grendel', album: 'Soibleed EP', albumAsin: 'BALBUM0001' };
const LIKED_B = { asin: 'B0C35Q9C5Y', title: '¡Vamos, Brandito!', artist: 'Nuclear Power Trio', album: 'Wet Ass Plutonium', albumAsin: 'BALBUM0002' };

function pluginWith(pages, opts = {}) {
  const ws = amazonWebSessionMock(opts.ws || {});
  const served = serveAmazonLikes(ws, pages, opts.serve || {});
  const plugin = instantiateAmazonPlugin(axe);
  return { plugin, ws, served };
}

afterEach(() => {
  delete global.window;
});

// ── The pure pieces ──────────────────────────────────────────────────────────

describe('likeTrackBody', () => {
  test('is full text with LIKE, no persisted-query hash', () => {
    const body = lib.likeTrackBody(LIKED_A.asin);
    expect(body.operationName).toBe('likeTrack');
    expect(body.variables).toEqual({ trackId: LIKED_A.asin, likeState: 'LIKE' });
    expect(body.query).toBe(lib.LIKE_TRACK_MUTATION);
    expect(String(body.query)).toContain('setTrackLikeState');
    expect(body.extensions).toBeUndefined();
  });
});

describe('likeTrackReplyOk', () => {
  test('ok only when Amazon echoed the like back', () => {
    expect(lib.likeTrackReplyOk(amazonLikeTrackReply(LIKED_A.asin).data)).toBe(true);
    expect(lib.likeTrackReplyOk(amazonLikeTrackReply(LIKED_A.asin, 'NEUTRAL').data)).toBe(false);
    expect(lib.likeTrackReplyOk(null)).toBe(false);
    expect(lib.likeTrackReplyOk({})).toBe(false);
    expect(lib.likeTrackReplyOk({ setTrackLikeState: null })).toBe(false);
  });
});

describe('lovedItemsFromLikedSongsGql', () => {
  test('maps LIKE rows to love items with their own source, lovedAt null', () => {
    const page = lib.lovedItemsFromLikedSongsGql(amazonLikedSongsPage([amazonLikedSong(LIKED_A), amazonLikedSong(LIKED_B)]).data);
    expect(page.envelope).toBe(true);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      artist: 'Grendel',
      title: 'Soibleed',
      album: 'Soibleed EP',
      lovedAt: null
    });
    expect(page.items[0].source).toMatchObject({
      title: 'Soibleed',
      artist: 'Grendel',
      album: 'Soibleed EP',
      duration: 200,
      albumArt: `https://m.media-amazon.com/images/I/${LIKED_A.asin}.jpg`,
      amazonAsin: LIKED_A.asin,
      albumAsin: 'BALBUM0001',
      explicit: false
    });
    // No credential ever rides the source.
    expect(JSON.stringify(page.items[0].source)).not.toMatch(/token|cookie|csrf|session/i);
  });

  test('a non-LIKE row is never a love; an unmappable row is skipped', () => {
    const data = amazonLikedSongsPage([
      amazonLikedSong(LIKED_A),
      amazonLikedSong({ ...LIKED_B, state: 'NEUTRAL' }),
      { node: { __typename: 'NotATrack' } }
    ]).data;
    const page = lib.lovedItemsFromLikedSongsGql(data);
    expect(page.items.map((i) => i.title)).toEqual(['Soibleed']);
    expect(page.skipped).toBe(2);
  });

  test('the explicit marker is stripped from the title, like the search mapper', () => {
    const data = amazonLikedSongsPage([amazonLikedSong({ ...LIKED_A, explicitMarker: true })]).data;
    const page = lib.lovedItemsFromLikedSongsGql(data);
    expect(page.items[0].title).toBe('Soibleed');
    expect(page.items[0].source.explicit).toBe(true);
  });

  test('an answer with no likes connection is not an envelope; neither is a connection with no edges', () => {
    expect(lib.lovedItemsFromLikedSongsGql({ user: { somethingElse: 1 } }).envelope).toBe(false);
    expect(lib.lovedItemsFromLikedSongsGql({ user: { tracks: {} } }).envelope).toBe(false);
    expect(lib.lovedItemsFromLikedSongsGql({ user: { tracks: { edges: [] } } }).envelope).toBe(true);
    expect(lib.lovedItemsFromLikedSongsGql(null).envelope).toBe(false);
  });
});

// ── loveTrack (the write) ──────────────────────────────────────────────────

describe('loveTrack', () => {
  test('no ASIN is no-match, never a guess', async () => {
    const { plugin } = pluginWith({ first: amazonLikedSongsPage([]) });
    await expect(plugin.loveTrack({ title: 'Soibleed', artist: 'Grendel', sources: {} }, {}))
      .resolves.toEqual({ ok: false, reason: 'no-match' });
  });

  test('reads the ASIN the host handed in track.sources.amazonmusic', async () => {
    const { plugin, served } = pluginWith({ first: amazonLikedSongsPage([]) });
    const track = {
      title: 'Soibleed', artist: 'Grendel',
      sources: { amazonmusic: { title: 'Soibleed', artist: 'Grendel', amazonAsin: LIKED_A.asin } }
    };
    await expect(plugin.loveTrack(track, {})).resolves.toEqual({ ok: true });
    const like = served.replays.find((r) => r.operationName === 'likeTrack');
    expect(like.variables).toEqual({ trackId: LIKED_A.asin, likeState: 'LIKE' });
  });

  test('signed out throws not-signed-in', async () => {
    const { plugin } = pluginWith({ first: amazonLikedSongsPage([]) }, { ws: { signedIn: false } });
    const track = { sources: { amazonmusic: { amazonAsin: LIKED_A.asin } } };
    await expect(plugin.loveTrack(track, {})).rejects.toMatchObject({ reason: 'not-signed-in' });
  });

  test('mints the gql entry from the /my/songs page flow, then reuses it', async () => {
    const { plugin, served } = pluginWith({ first: amazonLikedSongsPage([]) });
    const track = { sources: { amazonmusic: { amazonAsin: LIKED_A.asin } } };
    await expect(plugin.loveTrack(track, {})).resolves.toEqual({ ok: true });
    await expect(plugin.loveTrack({ sources: { amazonmusic: { amazonAsin: LIKED_B.asin } } }, {})).resolves.toEqual({ ok: true });
    // One page load minted both likes' entry: the flow ran once, and the
    // LikedSongsPage first page was its own replay (not a second like's cost
    // — the second like replays only the mutation).
    expect(served.loads).toHaveLength(1);
    expect(served.loads[0].url).toBe('https://music.amazon.com/my/songs');
    // The load ends at the page's own request (doneWhen) and judges a
    // half-loaded page (returnOnTimeout): the playlist-import page class.
    expect(served.loads[0].capture.doneWhen).toEqual({ bodyIncludes: '"LikedSongsPage"' });
    expect(served.loads[0].capture.returnOnTimeout).toBe(true);
    expect(served.replays.filter((r) => r.operationName === 'likeTrack')).toHaveLength(2);
    expect(served.replays.filter((r) => r.operationName === 'LikedSongsPage')).toHaveLength(1);
  });

  test('a failed mutation throws and drops the entry, so the retry re-mints', async () => {
    const { plugin, served } = pluginWith(
      { first: amazonLikedSongsPage([]) },
      { serve: { likeReplies: [{ status: 500, text: '{}' }] } }
    );
    const track = { sources: { amazonmusic: { amazonAsin: LIKED_A.asin } } };
    await expect(plugin.loveTrack(track, {})).rejects.toThrow(/failed/);
    // The retry (a fresh entry): a second page flow, a second mutation.
    await expect(plugin.loveTrack(track, {})).resolves.toEqual({ ok: true });
    expect(served.loads).toHaveLength(2);
    expect(served.replays.filter((r) => r.operationName === 'likeTrack')).toHaveLength(2);
  });

  test('a reply that does not echo the like is a failure, not a success', async () => {
    const { plugin } = pluginWith(
      { first: amazonLikedSongsPage([]) },
      { serve: { likeReplies: [amazonLikeTrackReply(LIKED_A.asin, 'NEUTRAL')] } }
    );
    await expect(plugin.loveTrack({ sources: { amazonmusic: { amazonAsin: LIKED_A.asin } } }, {}))
      .rejects.toThrow(/failed/);
  });
});

// ── getLovedPage (the list) ────────────────────────────────────────────────

describe('getLovedPage', () => {
  test('the first page rides the page flow; items, no dates, the token pages', async () => {
    const pages = {
      first: amazonLikedSongsPage([amazonLikedSong(LIKED_A)], { token: 'tok-2' }),
      'tok-2': amazonLikedSongsPage([amazonLikedSong(LIKED_B)], { token: 'tok-3' }),
      'tok-3': amazonLikedSongsPage([], { hasNextPage: false, token: 'tok-4' })
    };
    const { plugin, served } = pluginWith(pages);
    const first = await plugin.getLovedPage({ cursor: null }, {});
    expect(first.items.map((i) => i.title)).toEqual(['Soibleed']);
    expect(first.items[0].lovedAt).toBeNull();
    expect(first.next).toBe('tok-2');
    expect(first.total).toBe(0); // unknown: Amazon publishes no count
    expect(first.returned).toBe(1);

    const second = await plugin.getLovedPage({ cursor: first.next }, {});
    expect(second.items.map((i) => i.title)).toEqual(['¡Vamos, Brandito!']);
    expect(second.next).toBe('tok-3');

    // hasNextPage false ends the walk even with a token (the token alone must
    // not page again).
    const last = await plugin.getLovedPage({ cursor: 'tok-3' }, {});
    expect(last.items).toEqual([]);
    expect(last.next).toBeNull();
    expect(served.replays.filter((r) => r.operationName === 'LikedSongsPage' && r.variables.afterCursor === 'tok-4')).toEqual([]);
    // One page load for the whole walk: the continuation pages replay.
    expect(served.loads).toHaveLength(1);
    const continuations = served.replays.filter((r) => r.operationName === 'LikedSongsPage' && r.variables.afterCursor);
    expect(continuations.map((r) => r.variables.afterCursor)).toEqual(['tok-2', 'tok-3']);
  });

  test('signed out throws not-signed-in', async () => {
    const { plugin } = pluginWith({ first: amazonLikedSongsPage([]) }, { ws: { signedIn: false } });
    await expect(plugin.getLovedPage({ cursor: null }, {})).rejects.toMatchObject({ reason: 'not-signed-in' });
  });

  test('a page that never asked for the likes is structural, never an empty list', async () => {
    const ws = amazonWebSessionMock({});
    // No LikedSongsPage among the captures: the page fired other ops only.
    const capture = amazonLikedSongsCapture();
    capture.body = JSON.stringify({ operationName: 'SomethingElse', variables: {} });
    ws.load.mockImplementation(async () => ({ success: true, finalUrl: 'https://music.amazon.com/my/songs', captures: [capture] }));
    const plugin = instantiateAmazonPlugin(axe);
    await expect(plugin.getLovedPage({ cursor: null }, {})).rejects.toMatchObject({ reason: 'not-ready' });
  });

  test('a response whose connection has no edges is structural, never an empty list', async () => {
    const { plugin } = pluginWith({ first: { data: { user: { tracks: {} } } } });
    await expect(plugin.getLovedPage({ cursor: null }, {})).rejects.toMatchObject({ reason: 'not-ready' });
  });

  test('a response that is not the list shape is structural, never an empty list', async () => {
    const { plugin } = pluginWith({ first: { data: { user: { playlists: {} } } } });
    await expect(plugin.getLovedPage({ cursor: null }, {})).rejects.toMatchObject({ reason: 'not-ready' });
  });

  test('a continuation whose kept request expired says to run the import again', async () => {
    const { plugin } = pluginWith({ first: amazonLikedSongsPage([amazonLikedSong(LIKED_A)], { token: 'tok-2' }) });
    const first = await plugin.getLovedPage({ cursor: null }, {});
    // A sign-out dropped the kept request (the generation change the plugin
    // cannot see the event of).
    plugin.dropSessionState();
    await expect(plugin.getLovedPage({ cursor: first.next }, {})).rejects.toThrow(/run the import again/);
  });

  test('a failed continuation drops only the kept list: the entry survives for a like', async () => {
    const pages = {
      first: amazonLikedSongsPage([amazonLikedSong(LIKED_A)], { token: 'tok-2' }),
      'tok-2': { data: null, errors: [{ message: 'boom' }] }
    };
    const { plugin, served } = pluginWith(pages);
    const first = await plugin.getLovedPage({ cursor: null }, {});
    await expect(plugin.getLovedPage({ cursor: first.next }, {})).rejects.toThrow(/failed/);
    // The MUTATION's entry survived the list's failure: the like pays no
    // page load (a regression that drops both costs a second /my/songs load).
    await expect(plugin.loveTrack({ sources: { amazonmusic: { amazonAsin: LIKED_A.asin } } }, {})).resolves.toEqual({ ok: true });
    expect(served.loads).toHaveLength(1);
    // The next first page re-mints the list with its own page flow.
    await expect(plugin.getLovedPage({ cursor: null }, {})).resolves.toMatchObject({ next: 'tok-2' });
    expect(served.loads).toHaveLength(2);
  });

  test('a failed mutation drops only its entry: the kept list survives for a continuation', async () => {
    const pages = {
      first: amazonLikedSongsPage([amazonLikedSong(LIKED_A)], { token: 'tok-2' }),
      'tok-2': amazonLikedSongsPage([amazonLikedSong(LIKED_B)], { token: 'tok-3' })
    };
    const { plugin, served } = pluginWith(
      pages,
      { serve: { likeReplies: [{ status: 500, text: '{}' }] } }
    );
    const first = await plugin.getLovedPage({ cursor: null }, {});
    // A track-specific failure (a delisted ASIN): the mutation drops its own
    // entry only — an in-flight import's continuation still replays the kept
    // list (a regression that drops both kills the walk mid-import).
    await expect(plugin.loveTrack({ sources: { amazonmusic: { amazonAsin: 'B0DELISTED' } } }, {})).rejects.toThrow(/failed/);
    await expect(plugin.getLovedPage({ cursor: first.next }, {})).resolves.toMatchObject({ next: 'tok-3' });
    expect(served.loads).toHaveLength(1);
    expect(served.replays.filter((r) => r.operationName === 'LikedSongsPage' && r.variables.afterCursor)).toHaveLength(1);
  });
});
