/**
 * The Amazon plugin's playlist import (#1356 M7;
 * plugins-src/amazonmusic/implementation.js): the flow that used to live in
 * amazon-web-player.js, moved onto the window.electron.webSession bridge —
 * driven here against the mocked bridge exactly like the track search
 * (amazon-music-plugin-spec-search.test.js) and the album catalog
 * (amazon-music-plugin-catalog.test.js). The pure parsers and the pagination
 * loop (their cases moved out of amazon-music-logic.test.js, whose host
 * copies died with the flow) are pinned here against the plugin's _lib copies.
 *
 * Pinned here (docs/architecture/amazon-music.md, "Playlist import" — the
 * section is the spec; every sentence is a requirement):
 *   - the playlist page loads with the capture window inside the load, and
 *     the captured playlistDetail request is replayed VERBATIM to the
 *     captured URL with the captured headers — firstLimit never raised (the
 *     server serves one page per request however high it goes)
 *   - the pagination is token-driven: each response's pageInfo.token is
 *     passed as the afterCursor variable; the Relay-style endCursor is a
 *     decoy the server ignores, and no other variable name is ever sent
 *   - progress is judged on RAW edges: an all-delisted page (node: null)
 *     advances, a duplicate track first on consecutive pages advances, a
 *     repeated first cursor is no-advance; rows are never deduped
 *   - delisted rows are dropped but trackCount keeps the playlist's own
 *     count; the truncated warning fires only when pages were left unfetched
 *   - the miss (the page never fired playlistDetail) is null with the ops
 *     log (a hornet rename reads as a rename); a wall after the load is
 *     not-signed-in; a refused load is load-failed/superseded, never a miss
 *   - a busy pageFetch (a concurrent navigation holds the gate) is ridden
 *     out by the bounded backoff, never read as a failed page — and the
 *     bound OUTLASTS the host's load budget, so a concurrent load that holds
 *     the gate for its whole navigation budget does not truncate the import
 *   - the load phase rides the per-instance page-flow queue's FOREGROUND
 *     lane (a playlist the user opened goes ahead of every queued background
 *     page flow); the pagination replays after it run parallel-safe (a queued
 *     page flow is not starved behind a long import's pagination)
 *   - a 294 partial answer is accepted for the first page AND every
 *     continuation page (a community playlist imports; the log names the
 *     error paths; a 294 with no usable playlist is a lookup failure, never a
 *     miss) — playlistPartialIsUsable moved here from the host's
 *     amazon-gql-partial.test.js with the flow
 *   - a page whose load budget runs out with the request captured still
 *     imports (the host returns the captures with loadTimedOut — the request
 *     was the point, not the finished page)
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonWebSessionMock,
  amazonPlaylistDetailCapture,
  amazonPlaylistPage
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();

const PLAYLIST_ID = 'PP6417A00A9C99470BBC8834FF3BF6009A';
const PLAYLIST_URL = 'https://music.amazon.com/playlists/' + PLAYLIST_ID;
const USER_URL = 'https://music.amazon.com/user-playlists/e518f7064d964396a9dc211c4a705a80';

const PLAYLIST = {
  id: PLAYLIST_ID,
  name: 'My Discovery Mix',
  owner: 'Amazon',
  albumArt: 'https://m.media-amazon.com/images/I/cover.jpg'
};

const track = (n, over = {}) => ({
  asin: 'B000000000' + n,
  title: 'Track ' + n,
  artist: 'Artist',
  album: 'Album',
  duration: 200 + n,
  ...over
});

// A delisted row: position + itemId only — no ASIN, no title, nothing to
// import (observed stable across runs on the 977-track test playlist).
const delisted = (n) => ({ cursor: n + ':delisted-' + n, node: null });

// The webSession mock for the playlist flow: the playlist page's load
// returns the page's own playlistDetail capture (or `captures`), and
// pageFetch answers `respond(body)` — a function of the parsed request body —
// page after page. respond returns a response payload, or { busy: true } /
// { fetchError } / { status, text } for the failure shapes. Every request
// body the plugin sent is recorded on the mock (ws.sentRequests).
const playlistMock = ({ captures, respond, loadResult, finalUrl, state, loadTimedOut, timing } = {}) => {
  const mockOpts = {
    capturesFor: (url) => (captures !== undefined ? captures
      : (/\/playlists\//.test(String(url)) ? [amazonPlaylistDetailCapture(PLAYLIST_ID)] : [])),
    envelope: {}
  };
  if (loadResult !== undefined) mockOpts.loadResult = loadResult;
  if (finalUrl !== undefined) mockOpts.finalUrl = finalUrl;
  if (loadTimedOut !== undefined) mockOpts.loadTimedOut = loadTimedOut;
  if (timing !== undefined) mockOpts.timing = timing;
  const ws = amazonWebSessionMock(mockOpts);
  if (state) ws.state.mockImplementation(state);
  const sentRequests = [];
  ws.pageFetch.mockImplementation(async (id, request) => {
    const body = JSON.parse(request.body);
    sentRequests.push(body);
    const outcome = respond ? await respond(body) : { data: { playlist: null } };
    if (outcome && outcome.busy) return { success: true, error: 'busy' };
    if (outcome && outcome.fetchError) return { success: true, error: outcome.fetchError };
    if (outcome && outcome.status) return { success: true, status: outcome.status, text: JSON.stringify(outcome.text || {}) };
    return { success: true, status: 200, text: JSON.stringify(outcome) };
  });
  ws.sentRequests = sentRequests;
  return ws;
};

// The pageInfo of a page with more pages: token is the ONLY continuation the
// server honors; endCursor is the Relay-style decoy.
const more = (token) => ({ hasNextPage: true, endCursor: '99:dfeab136-decoy', token });
const last = { hasNextPage: false, endCursor: '99:dfeab136-decoy', token: null };

afterEach(() => {
  if (global.window) delete global.window.__parachordManageAmazonMusic;
  delete global.window;
});

// ── The flow: load, verbatim replay, token-driven pagination ────────────────

describe('lookupPlaylistFlow (the load + the replay + the pagination)', () => {
  test('loads the playlist page with the capture window and replays the captured request verbatim', async () => {
    const ws = playlistMock({
      respond: () => amazonPlaylistPage(PLAYLIST, [track(1), track(2)], last)
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist).toEqual(expect.objectContaining({
      id: PLAYLIST_ID,
      name: 'My Discovery Mix',
      owner: 'Amazon',
      albumArt: 'https://m.media-amazon.com/images/I/cover.jpg',
      trackCount: 2
    }));
    expect(playlist.tracks).toHaveLength(2);
    expect(playlist.tracks[0]).toEqual(expect.objectContaining({
      asin: 'B0000000001',
      title: 'Track 1',
      artist: 'Artist',
      album: 'Album',
      duration: 201,
      explicit: false
    }));
    // The playlist page loaded on the plugin's own session with the gql
    // capture window inside the load — the same window the spec searches
    // use (explicit quietMs: a cold view's first gql fires well after
    // load-finish; never later than the old poll's 15s budget). The budget
    // escape is OPTED IN here, and only here: this flow is the one caller
    // that knows how to judge a half-loaded page's captures.
    expect(ws.load).toHaveBeenCalledTimes(1);
    const [sessionId, url, opts] = ws.load.mock.calls[0];
    expect(sessionId).toBe('amazon-music');
    expect(url).toBe(PLAYLIST_URL);
    expect(opts.capture).toEqual({
      urlPrefixes: ['https://gql.music.amazon.com/*'],
      quietMs: 4500,
      budgetMs: 15000,
      doneWhen: { bodyIncludes: '"playlistDetail"' },
      returnOnTimeout: true
    });
    // The replay went to the captured URL with the captured headers and the
    // page's own firstLimit — never raised, no variables patched.
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
    const [replaySession, replay] = ws.pageFetch.mock.calls[0];
    expect(replaySession).toBe('amazon-music');
    expect(replay.url).toBe('https://gql.music.amazon.com/');
    expect(replay.method).toBe('POST');
    expect(replay.headers['x-api-key']).toBe('amzn1.application.x');
    expect(replay.headers['csrf-token']).toBe('t');
    const body = JSON.parse(replay.body);
    expect(body.operationName).toBe('playlistDetail');
    expect(body.variables.firstLimit).toBe(100);
    expect(body.extensions.persistedQuery.sha256Hash).toBe('playlisthash');
    expect('afterCursor' in body.variables).toBe(false);
  });

  test('the pagination is token-driven: each response token becomes the next afterCursor, never the endCursor decoy', async () => {
    // A 5-track playlist served 2 rows at a time: three pages total, the
    // token from each response driving the next request.
    const FULL = { ...PLAYLIST, trackCount: 5 };
    const ws = playlistMock({
      respond: (body) => {
        const afterCursor = body.variables.afterCursor;
        if (afterCursor == null) return amazonPlaylistPage(FULL, [track(1), track(2)], more('TOKEN_1'));
        if (afterCursor === 'TOKEN_1') return amazonPlaylistPage(FULL, [track(3), track(4)], more('TOKEN_2'));
        if (afterCursor === 'TOKEN_2') return amazonPlaylistPage(FULL, [track(5)], last);
        return { data: { playlist: null } };
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks.map(t => t.asin)).toEqual([
      'B0000000001', 'B0000000002', 'B0000000003', 'B0000000004', 'B0000000005'
    ]);
    // Three requests: the verbatim first page, then TOKEN_1, then TOKEN_2 —
    // each passed as the afterCursor variable. The decoy endCursor
    // ("99:dfeab136-decoy") is never sent as a variable; no other variable
    // name carries a cursor.
    expect(ws.sentRequests).toHaveLength(3);
    expect(ws.sentRequests.map(b => b.variables.afterCursor)).toEqual([undefined, 'TOKEN_1', 'TOKEN_2']);
    for (const body of ws.sentRequests) {
      expect(body.variables).not.toHaveProperty('endCursor');
      expect(body.variables).not.toHaveProperty('cursor');
      expect(body.variables).not.toHaveProperty('after');
      // Everything else stays byte-identical to the capture.
      expect(body.variables.firstLimit).toBe(100);
      expect(body.extensions.persistedQuery.sha256Hash).toBe('playlisthash');
    }
  });

  test('the user-playlists share-link shape loads the same way (the id class accepts dashes)', async () => {
    const id = 'e518f7064d964396a9dc211c4a705a80';
    const ws = playlistMock({
      captures: [amazonPlaylistDetailCapture(id)],
      respond: () => amazonPlaylistPage({ ...PLAYLIST, id }, [track(1)], last)
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(USER_URL);
    expect(playlist.id).toBe(id);
    expect(ws.load.mock.calls[0][1]).toBe(USER_URL);
  });

  test('a page that is entirely delisted rows advances — mapped zero is not a stop', async () => {
    // Review feedback on #1072: an all-null page used to end the import even
    // though later pages exist. Raw edges judge progress, never mapped rows.
    const ws = playlistMock({
      respond: (body) => {
        const afterCursor = body.variables.afterCursor;
        if (afterCursor == null) {
          return amazonPlaylistPage({ ...PLAYLIST, trackCount: 4 }, [track(1)], more('T1'));
        }
        if (afterCursor === 'T1') {
          const page = amazonPlaylistPage({ ...PLAYLIST, trackCount: 4 }, [], more('T2'));
          page.data.playlist.tracks.edges = [delisted(100), delisted(101)];
          return page;
        }
        if (afterCursor === 'T2') {
          return amazonPlaylistPage({ ...PLAYLIST, trackCount: 4 }, [track(2), track(3)], last);
        }
        return { data: { playlist: null } };
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks.map(t => t.asin)).toEqual(['B0000000001', 'B0000000002', 'B0000000003']);
    // trackCount keeps the playlist's own count — the delisted shortfall
    // stays visible.
    expect(playlist.trackCount).toBe(4);
  });

  test('a duplicate track first on two consecutive pages advances — the cursor distinguishes windows, rows are never deduped', async () => {
    // Review feedback on #1072: same asin first on consecutive pages used to
    // read as a repeated window. A likes playlist CAN legitimately hold the
    // same track at two positions.
    const FULL = { ...PLAYLIST, trackCount: 4 };
    const ws = playlistMock({
      respond: (body) => {
        const afterCursor = body.variables.afterCursor;
        if (afterCursor == null) {
          return amazonPlaylistPage(FULL, [{ ...track(1), asin: 'BDUP', title: 'First', cursor: '0:BDUP' }], more('T1'));
        }
        if (afterCursor === 'T1') {
          // The same asin first on the next page, but the per-edge cursor
          // advanced — a genuine new window, not a repeat.
          return amazonPlaylistPage(FULL, [{ ...track(9), asin: 'BDUP', title: 'Dup again', cursor: '100:BDUP' }, track(2)], more('T2'));
        }
        if (afterCursor === 'T2') {
          return amazonPlaylistPage(FULL, [track(3)], last);
        }
        return { data: { playlist: null } };
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(4);
    expect(playlist.tracks.filter(t => t.asin === 'BDUP')).toHaveLength(2);
  });

  test('a repeated window (the same first cursor twice) stops with no-advance and keeps what merged', async () => {
    const ws = playlistMock({
      respond: (body) => {
        const afterCursor = body.variables.afterCursor;
        if (afterCursor == null) {
          return amazonPlaylistPage({ ...PLAYLIST, trackCount: 9 }, [track(1)], more('T1'));
        }
        // The server answers every token with the SAME window (page 1 again
        // — the endCursor-decoy shape): the first cursor repeats, the loop
        // stops, and the truncation is logged (pages were left unfetched).
        const page = amazonPlaylistPage({ ...PLAYLIST, trackCount: 9 }, [track(1)], more('T1'));
        return page;
      }
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(1);
    // The truncated warning fires — this stop left pages unfetched.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/playlist lookup truncated: got 1 of 9 tracks \(no-advance\)/));
    warn.mockRestore();
  });

  test('the natural end with a shortfall is NOT a truncation: delisted rows are simply unimportable', async () => {
    // hasNextPage false with rows missing is the server out of pages —
    // 'playlist complete: N of M rows are importable', never the truncated
    // warning (which fires only when pages were left unfetched).
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = playlistMock({
      respond: (body) => {
        const afterCursor = body.variables.afterCursor;
        if (afterCursor == null) return amazonPlaylistPage({ ...PLAYLIST, trackCount: 3 }, [track(1)], more('T1'));
        if (afterCursor === 'T1') return amazonPlaylistPage({ ...PLAYLIST, trackCount: 3 }, [track(2)], last);
        return { data: { playlist: null } };
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(2);
    expect(playlist.trackCount).toBe(3);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/playlist complete: 2 of 3 rows are importable \(1 unavailable on Amazon\)/));
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    expect(ws.sentRequests).toHaveLength(2);
  });

  test('a failed page stops the pagination with what it kept (page-error), never a throw', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = playlistMock({
      respond: (body) => {
        const afterCursor = body.variables.afterCursor;
        if (afterCursor == null) return amazonPlaylistPage({ ...PLAYLIST, trackCount: 9 }, [track(1)], more('T1'));
        if (afterCursor === 'T1') return { fetchError: 'Amazon playlist query failed (500)' };
        return { data: { playlist: null } };
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(1);
    expect(playlist.trackCount).toBe(9);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/playlist lookup truncated: got 1 of 9 tracks \(page-error\)/));
    warn.mockRestore();
  });

  test('the page never fired playlistDetail (deleted/private/renamed) is the miss, with the ops log', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = playlistMock({
      captures: [{
        url: 'https://gql.music.amazon.com/',
        method: 'POST',
        body: JSON.stringify({ operationName: 'playlistSuggestions', variables: { recsUri: 'uri:///playlist/x/suggested-tracks' } }),
        headers: { 'x-api-key': 'k' }
      }],
      respond: () => ({ data: { playlist: null } })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupPlaylistFlow(PLAYLIST_URL)).resolves.toBeNull();
    // The miss log lists the operations the page DID fire, so a hornet
    // rename of playlistDetail reads as a rename, not "every playlist is
    // deleted". The replay never fires.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/page never requested playlistDetail for PP6417A00A9C99470BBC8834FF3BF6009A; gql operations seen: playlistSuggestions/));
    expect(ws.pageFetch).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('a no-error null playlist is the not-found miss; an error envelope with a null playlist is a lookup failure', async () => {
    // The playlist-specific gql-error rule: errors are fatal unless
    // data.playlist came back. A no-error data.playlist: null — the field
    // present, nulled — is the deleted/private shape the resolver surfaces
    // as "Playlist not found"; an error envelope with a null playlist is a
    // lookup failure (lookup-failed), never a miss (the album section's
    // not-found vs lookup-failed rule, mirrored).
    const miss = playlistMock({ respond: () => ({ data: { playlist: null } }) });
    await expect(instantiateAmazonPlugin(axe).lookupPlaylistFlow(PLAYLIST_URL)).resolves.toBeNull();
    expect(miss.pageFetch).toHaveBeenCalledTimes(1);

    const failed = playlistMock({
      respond: () => ({ errors: [{ message: 'playlistDetail exploded' }], data: { playlist: null } })
    });
    await expect(instantiateAmazonPlugin(axe).lookupPlaylistFlow(PLAYLIST_URL)).rejects.toMatchObject({
      reason: 'lookup-failed',
      message: 'playlistDetail exploded'
    });
    expect(failed.pageFetch).toHaveBeenCalledTimes(1);
  });

  test('captures without headers never match (the host pairs bodies with headers by request id)', async () => {
    // onBeforeSendHeaders fires milliseconds after onBeforeRequest — a
    // header-less body is not a replayable request.
    const bodyOnly = {
      url: 'https://gql.music.amazon.com/',
      method: 'POST',
      body: JSON.stringify({ operationName: 'playlistDetail', variables: { id: PLAYLIST_ID, firstLimit: 100 } })
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = playlistMock({ captures: [bodyOnly], respond: () => ({ data: { playlist: null } }) });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupPlaylistFlow(PLAYLIST_URL)).resolves.toBeNull();
    expect(ws.pageFetch).not.toHaveBeenCalled();
    // The miss log still names the header-less body's operation — the ops
    // list is built from the UNFILTERED captures, so the header-pairing race
    // reads as "playlistDetail fired but never paired" instead of "every
    // playlist is deleted".
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/gql operations seen: playlistDetail$/));
    warn.mockRestore();
  });

  test("the page's own capture is preferred over our echo of the same request", async () => {
    // A re-import of the same playlist can capture the first import's
    // in-flight replay (echo: true). Both answer the right playlist, but the
    // replay must carry the page's own headers — the echo's are session-aged.
    const echoed = amazonPlaylistDetailCapture(PLAYLIST_ID, { echo: true, hash: 'echohash' });
    echoed.headers['x-api-key'] = 'stale-echo-key';
    const ws = playlistMock({
      captures: [echoed, amazonPlaylistDetailCapture(PLAYLIST_ID)],
      respond: () => amazonPlaylistPage(PLAYLIST, [track(1)], last)
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(1);
    expect(ws.pageFetch.mock.calls[0][1].headers['x-api-key']).toBe('amzn1.application.x');
    expect(JSON.parse(ws.pageFetch.mock.calls[0][1].body).extensions.persistedQuery.sha256Hash).toBe('playlisthash');
  });

  test('a busy pageFetch is ridden out, never read as a failed page', async () => {
    // A concurrent navigation (another page flow's load) holds the host's
    // readers/writer gate: the bounded backoff retries the replay instead of
    // truncating the import on page-error.
    let calls = 0;
    const ws = playlistMock({
      respond: (body) => {
        if (body.variables.afterCursor == null) {
          calls += 1;
          if (calls === 1) return { busy: true };
          return amazonPlaylistPage({ ...PLAYLIST, trackCount: 3 }, [track(1), track(2), track(3)], last);
        }
        return { data: { playlist: null } };
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(3);
    expect(ws.pageFetch).toHaveBeenCalledTimes(2);
  });

  test('a busy gate that holds for a whole load budget — a concurrent page flow navigating mid-import — does not truncate the import', async () => {
    // Finding 4 (the #1437 review): the pagination replays run parallel-safe,
    // so a queued page flow's load takes the host's readers/writer gate WHILE
    // the import paginates, and every page through that window answers
    // { error: 'busy' }. A load holds the gate for up to its whole navigation
    // budget (loadTimeoutMs, 30s — the host default; the plugin's load passes
    // no timeoutMs), so the backoff must OUTLAST that budget: the old ~13s
    // bound gave up mid-import and truncated the playlist (page-error) or
    // failed the lookup ('busy').
    const reference = instantiateAmazonPlugin(axe);
    expect(reference.lib.PLAYLIST_BUSY_BACKOFF_MAX_MS).toBeGreaterThan(30000); // the host's loadTimeoutMs default
    jest.useFakeTimers();
    try {
      let gateOpen = false;
      // The concurrent load's whole budget: the gate frees ~31s in — past the
      // old bound, inside the new one.
      setTimeout(() => { gateOpen = true; }, 31000);
      const ws = playlistMock({
        respond: async (body) => {
          if (body.variables.afterCursor == null) {
            if (!gateOpen) return { busy: true };
            return amazonPlaylistPage({ ...PLAYLIST, trackCount: 3 }, [track(1), track(2), track(3)], last);
          }
          return { data: { playlist: null } };
        }
      });
      const resolver = instantiateAmazonPlugin(axe);
      const flow = resolver.lookupPlaylistFlow(PLAYLIST_URL);
      // Ride out the busy window: the first replay hits busy at t=0 and the
      // backoff steps (400ms x3, then 1s) until the gate opens at 31s and the
      // next retry lands the first page.
      await jest.advanceTimersByTimeAsync(33000);
      const playlist = await flow;
      expect(playlist.tracks.map(t => t.asin)).toEqual(['B0000000001', 'B0000000002', 'B0000000003']);
      // The first page rode out the busy window on the backoff (retried well
      // past the old ~13s bound), and hasNextPage false ends the import after
      // one successful page.
      expect(ws.pageFetch.mock.calls.length).toBeGreaterThan(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a page whose load budget runs out with the request captured still imports (the host returns loadTimedOut)', async () => {
    // Finding 2 (the #1437 review): the old host flow waited for the whole
    // page to load before its capture window, so one slow subresource fired
    // the 30s budget with playlistDetail already captured (the #1423 bug). The
    // host's rule-5 escape returns the held captures with loadTimedOut, and
    // the plugin proceeds — the request was the point of the load, not the
    // finished page.
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const ws = playlistMock({
      loadTimedOut: true,
      respond: () => amazonPlaylistPage(PLAYLIST, [track(1), track(2)], last)
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[Amazon] playlist page still loading after the load budget; proceeding with the captured requests');
    log.mockRestore();
  });

  test('the import goes ahead the moment playlistDetail is captured — BEFORE did-finish-load (#1423 slow-subresource shape, restored)', async () => {
    // #1437 review round 2, item 2: on `main` the import went ahead the
    // moment playlistDetail was captured. The bridge's doneWhen names the op
    // (the quoted operation-name value the matcher keys on), so the window
    // ends AT the op — the import answers at the op's landing time, not at
    // the 30s load budget the escape waits out. This timeline: an unrelated
    // gql at 1s, playlistDetail at 4.5s, did-finish-load still 20s out — the
    // import answers at ~4.5s with the page still loading.
    const unrelated = {
      url: 'https://gql.music.amazon.com/',
      method: 'POST',
      body: JSON.stringify({ operationName: 'MusicHomePage', variables: {} }),
      headers: { 'x-api-key': 'k' }
    };
    const ws = playlistMock({
      timing: {
        loadMs: 25000,
        requests: [
          { atMs: 1000, entry: unrelated },
          { atMs: 4500, entry: amazonPlaylistDetailCapture(PLAYLIST_ID) }
        ]
      },
      respond: () => amazonPlaylistPage(PLAYLIST, [track(1), track(2)], last)
    });
    const resolver = instantiateAmazonPlugin(axe);
    jest.useFakeTimers();
    const t0 = Date.now();
    try {
      let settled = false;
      const pending = resolver.lookupPlaylistFlow(PLAYLIST_URL).then((out) => { settled = true; return out; });
      for (let clock = 0; clock < 25000 && !settled; clock += 1) {
        await jest.advanceTimersByTimeAsync(1);
      }
      const playlist = await pending;
      expect(playlist.tracks).toHaveLength(2);
      // The window ended AT the match: the load answered at the op's
      // landing time, not at did-finish-load (25s out) and not at the load
      // budget (30s) the escape would have waited out.
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(25000);
      expect(elapsed).toBe(4500);
      // The named match is the quoted operation-name value, the exact needle
      // the matcher keys on — a rename falls back to the quiet window.
      expect(ws.load.mock.calls[0][2].capture.doneWhen).toEqual({ bodyIncludes: '"playlistDetail"' });
    } finally {
      jest.useRealTimers();
    }
  });

  test('a playlistDetail lagging an early unrelated gql past the shared quiet window still imports (the round-2 concrete miss)', async () => {
    // The maintainer's concrete case: an early unrelated gql at 1s, the page
    // finishes loading at 4s, playlistDetail lands at 4.5s. Under the shared
    // 2.5s window the first quiet poll after load sees 3s of silence and
    // returns without it — "Playlist not found" for a live playlist. The
    // playlist quiet window (the FALLBACK, wider than the shared one) keeps
    // the window open past the lag — and doneWhen ends it AT the op the
    // moment it lands anyway.
    const LAG_MS = 3500; // playlistDetail 3.5s after the last capture
    const unrelated = {
      url: 'https://gql.music.amazon.com/',
      method: 'POST',
      body: JSON.stringify({ operationName: 'MusicHomePage', variables: {} }),
      headers: { 'x-api-key': 'k' }
    };
    const resolver = instantiateAmazonPlugin(axe);
    // The lag sits past the shared quiet window and inside the playlist one
    // — the gap the fallback exists to cover.
    expect(LAG_MS).toBeGreaterThan(resolver.lib.PAGE_CAPTURE_QUIET_MS);
    expect(LAG_MS).toBeLessThan(resolver.lib.PLAYLIST_CAPTURE_QUIET_MS);
    const ws = playlistMock({
      timing: {
        loadMs: 4000,
        requests: [
          { atMs: 1000, entry: unrelated },
          { atMs: 4500, entry: amazonPlaylistDetailCapture(PLAYLIST_ID) }
        ]
      },
      respond: () => amazonPlaylistPage(PLAYLIST, [track(1)], last)
    });
    const playlist = await resolver.lookupPlaylistFlow(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(1);
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
  });

  test('a page that never fires playlistDetail waits out the quiet FALLBACK, then answers the miss (not found)', async () => {
    // The quiet window is now the FALLBACK for "playlistDetail never came"
    // (deleted/private/renamed — or the rename that also defeats doneWhen):
    // an unrelated gql at 1s and did-finish-load at 4s leave the window open
    // to 5.5s (the last capture + the playlist quiet width) before the flow
    // answers its null — the old 2.5s window closed at 4s.
    const unrelated = {
      url: 'https://gql.music.amazon.com/',
      method: 'POST',
      body: JSON.stringify({ operationName: 'playlistSuggestions', variables: {} }),
      headers: { 'x-api-key': 'k' }
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = playlistMock({
      timing: {
        loadMs: 4000,
        requests: [{ atMs: 1000, entry: unrelated }]
      },
      respond: () => ({ data: { playlist: null } })
    });
    const resolver = instantiateAmazonPlugin(axe);
    jest.useFakeTimers();
    const t0 = Date.now();
    try {
      let settled = false;
      const pending = resolver.lookupPlaylistFlow(PLAYLIST_URL).then((out) => { settled = true; return out; });
      // Drive the clock past the OLD window's close (4s): the fallback is
      // still waiting — a playlistDetail that landed at 4.5s would still be
      // inside the window.
      for (let clock = 0; clock < 6000 && !settled; clock += 1) {
        await jest.advanceTimersByTimeAsync(1);
      }
      await expect(pending).resolves.toBeNull();
      // The window ran its full fallback width: last capture 1s + 4.5s.
      expect(Date.now() - t0).toBe(5500);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/page never requested playlistDetail for \w+; gql operations seen: playlistSuggestions/));
      expect(ws.pageFetch).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      jest.useRealTimers();
    }
  });

  test('the playlist lookup goes ahead of queued background page flows (the foreground lane)', async () => {
    // Finding 3 (the #1437 review), the port of the host's playlist-lane test
    // (amazon-lane-queue.test.js, #1423): the plugin's page-flow queue has
    // the host's two lanes, and the playlist load rides the FOREGROUND one. A
    // running job is never interrupted (the playlist waits for the album
    // lookup in progress); it starts before every QUEUED background job.
    const order = [];
    let releaseFirst;
    const firstLoad = new Promise((resolve) => { releaseFirst = resolve; });
    let seenFirst = false;
    const ws = playlistMock({ respond: () => amazonPlaylistPage(PLAYLIST, [track(1)], last) });
    ws.load.mockImplementation(async (id, url) => {
      order.push(url);
      if (!seenFirst) {
        seenFirst = true; // the RUNNING job: never interrupted
        await firstLoad;
      }
      const captures = /\/playlists\//.test(String(url)) ? [amazonPlaylistDetailCapture(PLAYLIST_ID)] : [];
      return { success: true, finalUrl: url, captures };
    });
    const resolver = instantiateAmazonPlugin(axe);
    const running = resolver.lookupAlbumFlow('https://music.amazon.com/albums/B000ALBUM1').catch(() => 'album-failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const bg1 = resolver.lookupAlbumFlow('https://music.amazon.com/albums/B000ALBUM2').catch(() => 'album-failed');
    const bg2 = resolver.lookupAlbumFlow('https://music.amazon.com/albums/B000ALBUM3').catch(() => 'album-failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const playlist = resolver.lookupPlaylistFlow(PLAYLIST_URL);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    await Promise.all([running, bg1, bg2]);
    const imported = await playlist;
    expect(imported.tracks).toHaveLength(1); // the flow completed; the load ORDER is the point
    // The playlist's load fired before both queued background jobs — behind
    // only the one that was already running.
    expect(order).toEqual([
      'https://music.amazon.com/albums/B000ALBUM1',
      PLAYLIST_URL,
      'https://music.amazon.com/albums/B000ALBUM2',
      'https://music.amazon.com/albums/B000ALBUM3'
    ]);
  });

  test('a wall after the load is not-signed-in (the session died mid-flight)', async () => {
    const ws = playlistMock({
      finalUrl: 'https://music.amazon.com/ap/signin',
      respond: () => ({ data: { playlist: null } })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupPlaylistFlow(PLAYLIST_URL)).rejects.toMatchObject({
      reason: 'not-signed-in'
    });
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('a page that left music.amazon.com cannot be replayed from', async () => {
    const ws = playlistMock({
      finalUrl: 'https://www.amazon.com/gp/sign-in.html',
      respond: () => ({ data: { playlist: null } })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupPlaylistFlow(PLAYLIST_URL)).rejects.toMatchObject({
      reason: 'not-ready'
    });
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('a refused load is a readiness failure, never a miss', async () => {
    // superseded too: a sign-out mid-load is a readiness failure — its
    // captures belong to the old account.
    for (const reason of ['load-failed', 'superseded', 'not-ready']) {
      const ws = playlistMock({
        loadResult: { success: false, reason, error: reason + ' happened' },
        respond: () => ({ data: { playlist: null } })
      });
      await expect(instantiateAmazonPlugin(axe).lookupPlaylistFlow(PLAYLIST_URL)).rejects.toMatchObject({ reason });
      expect(ws.pageFetch).not.toHaveBeenCalled();
    }
  });

  test('not signed in is notReady before any load; a non-playlist URL is notReady before that', async () => {
    const ws = playlistMock({
      state: async () => ({ success: true, url: null, signInUrl: null, cookieNames: ['session-id', 'ubid-main'], generation: 0 }),
      respond: () => ({ data: { playlist: null } })
    });
    await expect(instantiateAmazonPlugin(axe).lookupPlaylistFlow(PLAYLIST_URL)).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(ws.load).not.toHaveBeenCalled();
    await expect(instantiateAmazonPlugin(axe).lookupPlaylistFlow('https://open.spotify.com/playlist/abc')).rejects.toMatchObject({ reason: 'not-ready' });
    await expect(instantiateAmazonPlugin(axe).lookupPlaylistFlow('https://music.amazon.com/tracks/B000SNWG5Q')).rejects.toMatchObject({ reason: 'not-ready' });
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('no webSession bridge is notReady', async () => {
    global.window = {};
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupPlaylistFlow(PLAYLIST_URL)).rejects.toMatchObject({ reason: 'not-ready' });
  });

  test('the load phase serializes on the page-flow chain; the pagination replays run parallel-safe after it', async () => {
    // The chain (the M5 pattern) covers the LOAD only: a page flow queued
    // behind a long import's pagination must not wait out the whole
    // pagination — a 120s import would otherwise starve every search behind
    // it. The first import's replay is parked on a gate the test opens; the
    // second flow's load fires while the first is still paginating.
    let releaseReplay;
    const replayGate = new Promise((resolve) => { releaseReplay = resolve; });
    const loadOrder = [];
    const ws = playlistMock({
      respond: async (body) => {
        if (body.variables.afterCursor == null) {
          await replayGate;
          return amazonPlaylistPage({ ...PLAYLIST, trackCount: 3 }, [track(1), track(2), track(3)], last);
        }
        return { data: { playlist: null } };
      }
    });
    ws.load.mockImplementation(async (id, url, o) => {
      loadOrder.push(url);
      const captures = /\/playlists\//.test(String(url)) ? [amazonPlaylistDetailCapture(PLAYLIST_ID)] : [];
      return { success: true, finalUrl: url, captures };
    });
    const resolver = instantiateAmazonPlugin(axe);
    const first = resolver.lookupPlaylistFlow(PLAYLIST_URL);
    // Let the first import's load finish and its replay start (parked on the
    // gate); then queue a second flow on the chain.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = resolver.lookupPlaylistFlow(PLAYLIST_URL);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second load fired BEFORE the first import's replay resolved — the
    // chain was released after the load phase, not held for the pagination.
    expect(loadOrder).toEqual([PLAYLIST_URL, PLAYLIST_URL]);
    releaseReplay();
    const [a, b] = await Promise.all([first, second]);
    expect(a.tracks).toHaveLength(3);
    expect(b.tracks).toHaveLength(3);
  });
});

// ── HTTP 294: a community playlist answers playlistDetail with a partial answer ──
// Ported from the host's amazon-gql-partial.test.js with the flow (#1437
// review, finding 1): the live-captured, trimmed 294 response — a complete
// data.playlist plus an error on playlist.capabilities.setOnDemand (the
// collaborators service fails with a 500 for a playlist the user doesn't
// own). Amazon's own page renders it; the import does too. The host's copy
// of the rule (gqlReplayOutcome) stays pinned there for the host's remaining
// replay flows — the music-home fallback reads a 294's status.

const COMMUNITY_ID = 'd1670975fc554eed80edd41f03d355f4sune';
const COMMUNITY_URL = 'https://music.amazon.com/user-playlists/' + COMMUNITY_ID;

// The live-captured 294 answer, trimmed to two rows (2026-11-15, #1423).
const communityRow = (id, title, artist, i) => ({
  cursor: `${i}:row-${i}`,
  node: {
    __typename: 'Track', id, title, duration: 239,
    contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: artist } }] },
    album: { shortTitle: 'Album ' + i },
    images: []
  }
});

const PARTIAL_RESPONSE = {
  errors: [{
    message: 'Request to PlaylistCustomerRelationshipService API ListPlaylistCollaborators failed',
    path: ['playlist', 'capabilities', 'setOnDemand'],
    extensions: { code: 'SERVICE_ERROR' }
  }],
  data: {
    playlist: {
      id: COMMUNITY_ID,
      __typename: 'Playlist',
      title: 'Melancholy Alternatives',
      url: COMMUNITY_URL,
      curator: { name: 'A curator' },
      description: 'A melancholic alternative playlist.',
      trackCount: 2,
      images: [],
      capabilities: { appendTracks: { isAllowed: false }, setOnDemand: null },
      tracks: {
        edges: [
          communityRow('B000002UB3', 'Creep', 'Radiohead', 0),
          communityRow('B000002H3Q', 'How Soon Is Now?', 'The Smiths', 1)
        ],
        pageInfo: { hasNextPage: false, token: null, endCursor: '1:row-1' }
      }
    }
  }
};

describe('HTTP 294 — the community playlist imports from the partial answer', () => {
  test('imports the tracks from the 294 answer, logging the error paths', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const ws = playlistMock({
      captures: [amazonPlaylistDetailCapture(COMMUNITY_ID)],
      respond: () => ({ status: 294, text: PARTIAL_RESPONSE })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(COMMUNITY_URL);
    expect(playlist.name).toBe('Melancholy Alternatives');
    expect(playlist.tracks.map(t => [t.title, t.artist])).toEqual([
      ['Creep', 'Radiohead'],
      ['How Soon Is Now?', 'The Smiths']
    ]);
    // The 294 log line names the error paths, so a new failing field reads
    // as a hornet change, not a silent swallow.
    expect(log).toHaveBeenCalledWith('[Amazon] playlist partial answer (HTTP 294), using data.playlist; errors at: playlist.capabilities.setOnDemand');
    expect(ws.pageFetch).toHaveBeenCalledTimes(1); // hasNextPage false: no second page
    log.mockRestore();
  });

  test('a 294 on a CONTINUATION page is accepted too — every page opts in', async () => {
    // The acceptPartial option rides the replay for the first page AND every
    // continuation page: each page is its own 294 candidate (a long community
    // playlist answers 294 page after page).
    const FULL = { id: COMMUNITY_ID, name: 'Melancholy Alternatives', trackCount: 3 };
    let page = 0;
    const ws = playlistMock({
      captures: [amazonPlaylistDetailCapture(COMMUNITY_ID)],
      respond: (body) => {
        if (body.variables.afterCursor == null) {
          page = 1;
          return amazonPlaylistPage(FULL, [track(1)], more('T1'));
        }
        page = 2;
        // The continuation answers 294: complete data.playlist plus the
        // collaborators error.
        const partial = JSON.parse(JSON.stringify(PARTIAL_RESPONSE));
        partial.data.playlist.id = COMMUNITY_ID;
        partial.data.playlist.title = FULL.name;
        partial.data.playlist.trackCount = 3;
        partial.data.playlist.tracks.edges = [communityRow('B0000000002', 'Track 2', 'Artist', 1)];
        partial.data.playlist.tracks.pageInfo = last;
        return { status: 294, text: partial };
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const playlist = await resolver.lookupPlaylistFlow(COMMUNITY_URL);
    expect(playlist.tracks.map(t => t.asin)).toEqual(['B0000000001', 'B0000000002']);
    expect(ws.pageFetch).toHaveBeenCalledTimes(2);
    expect(page).toBe(2);
  });

  test('a 294 with no usable playlist is still a lookup failure, never a miss', async () => {
    // The predicate decides: data.playlist null (or no track rows block) is
    // not a playlist we can import, so the 294 is the plain failure with its
    // status — the same rule the host's music-home fallback depends on.
    const ws = playlistMock({
      respond: () => ({ status: 294, text: { errors: [{ message: 'x' }], data: { playlist: null } } })
    });
    await expect(instantiateAmazonPlugin(axe).lookupPlaylistFlow(PLAYLIST_URL))
      .rejects.toMatchObject({ reason: 'lookup-failed', message: 'Amazon gql query failed (294)' });
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
  });
});

// ── playlistPartialIsUsable (the _lib copy, moved from amazon-gql-partial.test.js) ──

describe('playlistPartialIsUsable (the _lib copy)', () => {
  const lib = instantiateAmazonPlugin(axe).lib;

  test('data.playlist with track edges is usable', () => {
    expect(lib.playlistPartialIsUsable(PARTIAL_RESPONSE)).toBe(true);
  });

  test('a playlist with empty edges is still usable (an empty playlist)', () => {
    const empty = { data: { playlist: { id: 'x', tracks: { edges: [] } } } };
    expect(lib.playlistPartialIsUsable(empty)).toBe(true);
  });

  test('no playlist, or no track rows block, is not', () => {
    expect(lib.playlistPartialIsUsable({ data: { playlist: null } })).toBe(false);
    expect(lib.playlistPartialIsUsable({ data: { playlist: { id: 'x' } } })).toBe(false);
    expect(lib.playlistPartialIsUsable({ data: null })).toBe(false);
    expect(lib.playlistPartialIsUsable(null)).toBe(false);
  });
});

// ── The moved parsers (the _lib copies, ported from amazon-music-logic.test.js) ──

describe('the moved parsers (the _lib copies)', () => {
  const lib = instantiateAmazonPlugin(axe).lib;

  describe('amazonPlaylistIdFromUrl', () => {
    test('reads the id off shared/brand, my-music and user-playlist pages', () => {
      expect(lib.amazonPlaylistIdFromUrl('https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A'))
        .toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
      expect(lib.amazonPlaylistIdFromUrl('https://music.amazon.com/my/playlists/PP6417A00A9C99470BBC8834FF3BF6009A?ref=dm_sh'))
        .toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
      // /user-playlists/<uuid> is the share-link shape for user-created
      // playlists (observed 2026-10); ids come bare-hex AND dashed — a dashed
      // id truncated at its first dash never matches the page's own request.
      expect(lib.amazonPlaylistIdFromUrl('https://music.amazon.com/user-playlists/e518f7064d964396a9dc211c4a705a80'))
        .toBe('e518f7064d964396a9dc211c4a705a80');
      expect(lib.amazonPlaylistIdFromUrl('https://music.amazon.com/user-playlists/1ff61395-8d2c-4c12-a5de-8fc0b69bdf02'))
        .toBe('1ff61395-8d2c-4c12-a5de-8fc0b69bdf02');
    });

    test('track, album and non-Amazon URLs are not playlists', () => {
      expect(lib.amazonPlaylistIdFromUrl('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
      expect(lib.amazonPlaylistIdFromUrl('https://music.amazon.com/albums/B000031W1M')).toBeNull();
      expect(lib.amazonPlaylistIdFromUrl('https://open.spotify.com/playlist/abc')).toBeNull();
      expect(lib.amazonPlaylistIdFromUrl('')).toBeNull();
    });
  });

  describe('amazonPlaylistDetailRequest', () => {
    const detail = (id) => JSON.stringify({
      operationName: 'playlistDetail',
      variables: { id, firstLimit: 100, isAuthenticated: true, includeCollaborators: false },
      extensions: { persistedQuery: { version: 1, sha256Hash: '41c5f472' } }
    });

    test('finds the playlistDetail request for our playlist among the captured gql bodies', () => {
      const bodies = [
        JSON.stringify({ operationName: 'Transport', variables: {} }),
        detail('PP6417A00A9C99470BBC8834FF3BF6009A'),
        JSON.stringify({ operationName: 'playlistSuggestions', variables: { recsUri: 'uri:///playlist/x/suggested-tracks' } }),
        '{not json'
      ];
      const req = lib.amazonPlaylistDetailRequest(bodies, 'PP6417A00A9C99470BBC8834FF3BF6009A');
      expect(req.operationName).toBe('playlistDetail');
      expect(req.variables.id).toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
      expect(req.extensions.persistedQuery.sha256Hash).toBe('41c5f472');
    });

    test('a playlistDetail for another playlist is not ours', () => {
      expect(lib.amazonPlaylistDetailRequest([detail('PPOTHER')], 'PP6417A00A9C99470BBC8834FF3BF6009A')).toBeNull();
      expect(lib.amazonPlaylistDetailRequest([detail('pp6417a00a9c99470bbc8834ff3bf6009a')], 'PP6417A00A9C99470BBC8834FF3BF6009A')).not.toBeNull();
      expect(lib.amazonPlaylistDetailRequest([], 'PP6417A00A9C99470BBC8834FF3BF6009A')).toBeNull();
      expect(lib.amazonPlaylistDetailRequest(null, 'x')).toBeNull();
    });
  });

  describe('trackFromGqlEdge (the playlist edge mapper)', () => {
    const edge = (node) => ({ node });

    test('maps a track node with artists, album, and duration', () => {
      const t = lib.trackFromGqlEdge(edge({
        id: 'B00136J8K8',
        title: 'Metal Health (Bang Your Head)',
        duration: 317,
        contributingArtists: {
          edges: [
            { role: 'PRIMARY', node: { name: 'Quiet Riot' } },
            { role: 'FEATURED', node: { name: 'Someone Else' } }
          ]
        },
        album: { id: 'B00136JQEQ', shortTitle: 'Metal Health' },
        images: [{ url: 'https://m.media-amazon.com/images/I/500.jpg', width: 500, height: 500, imageType: 'PRIMARY' }, { url: 'https://m.media-amazon.com/images/I/1400.jpg', width: 1400, height: 1400, imageType: 'PRIMARY' }]
      }));
      expect(t).toEqual({
        asin: 'B00136J8K8',
        title: 'Metal Health (Bang Your Head)',
        artist: 'Quiet Riot',
        album: 'Metal Health',
        albumAsin: 'B00136JQEQ',
        albumArt: 'https://m.media-amazon.com/images/I/1400.jpg',
        duration: 317,
        explicit: false
      });
    });

    test('strips the in-title explicit marker, drops marker-only titles, joins non-PRIMARY artists', () => {
      expect(lib.trackFromGqlEdge(edge({
        id: 'B0H7NMPYBC', title: 'Kunnioita [Explicit]',
        contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Turmion Kätilöt' } }] },
        album: { id: 'B0H7NSSY32', shortTitle: 'Resodance' }
      }))).toEqual(expect.objectContaining({ title: 'Kunnioita', explicit: true }));
      expect(lib.trackFromGqlEdge(edge({
        id: 'B1', title: '[Explicit]',
        contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'A' } }] }
      }))).toBeNull();
      const joined = lib.trackFromGqlEdge(edge({
        id: 'B1', title: 'Song',
        contributingArtists: { edges: [{ node: { name: 'A' } }, { role: 'FEATURED', node: { name: 'B' } }] },
        album: { id: 'B2', title: 'Full Album Title' }
      }));
      expect(joined.artist).toBe('A, B');
      expect(joined.album).toBe('Full Album Title');
      expect(joined.albumArt).toBeNull();
    });

    test('drops rows without asin, title, or artist; drops non-Track nodes when __typename says so', () => {
      expect(lib.trackFromGqlEdge(edge({ id: 'B1', title: 'No artists', contributingArtists: { edges: [] } }))).toBeNull();
      expect(lib.trackFromGqlEdge(edge({ title: 'No asin', contributingArtists: { edges: [{ node: { name: 'A' } }] } }))).toBeNull();
      expect(lib.trackFromGqlEdge(null)).toBeNull();
      // The search response asks for __typename; the playlist detail response
      // does not. An Album node must never import as a track.
      expect(lib.trackFromGqlEdge(edge({
        __typename: 'Album', id: 'B0ALBUM123', title: 'Kid A',
        contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Radiohead' } }] }
      }))).toBeNull();
      expect(lib.trackFromGqlEdge(edge({
        id: 'B1', title: 'Song', contributingArtists: { edges: [{ node: { name: 'A' } }] }
      }))).not.toBeNull();
    });
  });

  describe('playlistFromGql', () => {
    const gqlPlaylist = (overrides = {}) => ({
      id: 'PP6417A00A9C99470BBC8834FF3BF6009A',
      title: 'My Discovery Mix',
      trackCount: 2,
      images: [
        { url: 'https://m.media-amazon.com/images/I/banner.jpg', width: 4188, height: 2094, imageType: null },
        { url: 'https://m.media-amazon.com/images/I/cover.jpg', width: 2400, height: 2400, imageType: 'PRIMARY' }
      ],
      curator: { name: 'Amazon' },
      tracks: {
        edges: [
          { node: { id: 'B00136J8K8', title: 'Metal Health (Bang Your Head)', duration: 317, contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Quiet Riot' } }] }, album: { id: 'B00136JQEQ', shortTitle: 'Metal Health' } } },
          { node: { id: 'B07XLSKGGK', title: 'Master of Puppets (Remastered)', duration: 515, contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Metallica' } }] }, album: { id: 'B000031W1M', shortTitle: 'Master of Puppets' } } }
        ]
      },
      ...overrides
    });

    test('maps the response playlist with the PRIMARY cover', () => {
      const out = lib.playlistFromGql({ playlist: gqlPlaylist() });
      expect(out.id).toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
      expect(out.name).toBe('My Discovery Mix');
      expect(out.owner).toBe('Amazon');
      expect(out.albumArt).toBe('https://m.media-amazon.com/images/I/cover.jpg');
      expect(out.trackCount).toBe(2);
      expect(out.tracks).toHaveLength(2);
      // The playlist detail response carries no track images: albumArt is
      // null even though the mapper could pick one.
      expect(out.tracks[0]).toEqual({
        asin: 'B00136J8K8',
        title: 'Metal Health (Bang Your Head)',
        artist: 'Quiet Riot',
        album: 'Metal Health',
        albumAsin: 'B00136JQEQ',
        albumArt: null,
        duration: 317,
        explicit: false
      });
    });

    test('null playlist (deleted/private) maps to null, not an empty import', () => {
      expect(lib.playlistFromGql({ playlist: null })).toBeNull();
      expect(lib.playlistFromGql(null)).toBeNull();
    });

    test('curator variants: string curator, algorithmic null curator, widest non-PRIMARY fallback', () => {
      expect(lib.playlistFromGql({ playlist: gqlPlaylist({ curator: 'Rhino' }) }).owner).toBe('Rhino');
      expect(lib.playlistFromGql({ playlist: gqlPlaylist({ curator: null }) }).owner).toBeNull();
      const noPrimary = lib.playlistFromGql({
        playlist: gqlPlaylist({ images: [{ url: 'https://x/small.jpg', width: 300, imageType: null }, { url: 'https://x/big.jpg', width: 3000, imageType: null }] })
      });
      expect(noPrimary.albumArt).toBe('https://x/big.jpg');
    });
  });

  describe('playlistPageInfoFromGql', () => {
    test('reads the connection pageInfo when present', () => {
      const data = { playlist: { tracks: { pageInfo: { hasNextPage: true, endCursor: 'CUR_100', token: 'TOKEN_100' } } } };
      expect(lib.playlistPageInfoFromGql(data)).toEqual({ hasNextPage: true, endCursor: 'CUR_100', token: 'TOKEN_100' });
    });

    test('last page: hasNextPage false still carries the cursor', () => {
      const data = { playlist: { tracks: { pageInfo: { hasNextPage: false, endCursor: 'CUR_977', token: 'TOKEN_977' } } } };
      expect(lib.playlistPageInfoFromGql(data)).toEqual({ hasNextPage: false, endCursor: 'CUR_977', token: 'TOKEN_977' });
    });

    test('absent pageInfo (or absent playlist) maps to null — caller falls back to scroll', () => {
      expect(lib.playlistPageInfoFromGql({ playlist: { tracks: {} } })).toBeNull();
      expect(lib.playlistPageInfoFromGql({ playlist: null })).toBeNull();
      expect(lib.playlistPageInfoFromGql(null)).toBeNull();
    });

    test('partial pageInfo: missing fields are null, not undefined', () => {
      expect(lib.playlistPageInfoFromGql({ playlist: { tracks: { pageInfo: { hasNextPage: true } } } }))
        .toEqual({ hasNextPage: true, endCursor: null, token: null });
    });
  });

  describe('playlistEdgesFromGql', () => {
    const edge = (asin, title) => ({ node: { id: asin, title } });

    test('the playlistDetail envelope: data.playlist.tracks.edges', () => {
      const data = { playlist: { tracks: { edges: [edge('B1', 'One'), edge('B2', 'Two')] } } };
      expect(lib.playlistEdgesFromGql(data)).toHaveLength(2);
    });

    test('a different envelope is found by the shape scan (continuation operations can rename it)', () => {
      const data = { playlistTracks: { edges: [edge('B1', 'One')] } };
      expect(lib.playlistEdgesFromGql(data)).toHaveLength(1);
    });

    test('nothing edge-shaped maps to null, not an empty array', () => {
      expect(lib.playlistEdgesFromGql({ playlist: { tracks: {} } })).toBeNull();
      expect(lib.playlistEdgesFromGql(null)).toBeNull();
      expect(lib.playlistEdgesFromGql({ other: { edges: [{}] } })).toBeNull();
    });
  });
});

describe('paginatePlaylistTracks (the pure loop)', () => {
  const lib = instantiateAmazonPlugin(axe).lib;
  const edge = (position, asin, title) => ({
    cursor: `${position}:dfeab136-0000-0000-0000-${String(position).padStart(12, '0')}`,
    node: asin == null ? null : {
      id: asin,
      title: title || `Track ${asin}`,
      duration: 200,
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Artist' } }] },
      album: { id: 'B0ALBUM', shortTitle: 'Album' }
    }
  });
  const pageData = (positions, over = {}) => ({
    playlist: {
      id: 'PP1',
      title: 'Test',
      trackCount: over.trackCount != null ? over.trackCount : positions.length,
      tracks: {
        edges: positions.map(p => (Array.isArray(p) ? edge(p[0], p[1], p[2]) : edge(p, 'B0' + String(p).padStart(8, '0')))),
        pageInfo: over.pageInfo != null ? over.pageInfo : { hasNextPage: false }
      }
    }
  });
  const pageInfo = (over = {}) => ({ hasNextPage: true, endCursor: '99:x', token: 'TOKEN', ...over });
  // fetchPage over a script of canned pages; records the tokens it was called with
  const fetcher = (pages) => {
    const calls = [];
    const fn = async (token) => {
      calls.push(token);
      const next = pages.shift();
      if (!next) return { error: 'no more pages' };
      if (next.error) return { error: next.error };
      return { data: next.data };
    };
    fn.calls = calls;
    return fn;
  };

  test('follows the token page over page until trackCount is reached', async () => {
    const first = pageData([0, 1], { trackCount: 4, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([2, 3], { trackCount: 4, pageInfo: pageInfo({ token: 'T2' }) }) }
    ];
    const r = await lib.paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('complete');
    expect(r.pages).toBe(1);
    expect(r.playlist.tracks).toHaveLength(4);
    expect(r.playlist.trackCount).toBe(4);
  });

  test('no token on the first page and hasNextPage false both end naturally (exhausted)', async () => {
    const noToken = await lib.paginatePlaylistTracks({
      firstPageData: pageData([0, 1], { trackCount: 5, pageInfo: pageInfo({ token: null }) }),
      fetchPage: fetcher([])
    });
    expect(noToken.stop).toBe('exhausted');
    expect(noToken.pages).toBe(0);
    expect(noToken.playlist.tracks).toHaveLength(2);

    const lastPage = await lib.paginatePlaylistTracks({
      firstPageData: pageData([0, 1], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) }),
      fetchPage: fetcher([{ data: pageData([2], { trackCount: 3, pageInfo: { hasNextPage: false, token: null } }) }])
    });
    expect(lastPage.stop).toBe('exhausted');
    expect(lastPage.playlist.tracks).toHaveLength(3);
  });

  test('a page that is entirely delisted rows (node:null) advances — mapped zero is not a stop', async () => {
    // review feedback on #1072: an all-null page used to end the import even
    // though later pages exist.
    const first = pageData([0], { trackCount: 4, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([[100, null], [101, null]], { trackCount: 4, pageInfo: pageInfo({ token: 'T2' }) }) },
      { data: pageData([200, 201], { trackCount: 4, pageInfo: { hasNextPage: false, token: null } }) }
    ];
    const r = await lib.paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('exhausted');
    expect(r.pages).toBe(2);
    expect(r.playlist.tracks.map(t => t.asin)).toHaveLength(3); // row 0 + rows 200-201
  });

  test('a duplicate track first on two consecutive pages advances — the cursor distinguishes windows', async () => {
    // review feedback on #1072: same asin first on consecutive pages used to
    // read as a repeated window.
    const first = pageData([[0, 'BDUP', 'First']], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([[100, 'BDUP', 'Dup again'], [101, 'B0X', 'Other']], { trackCount: 5, pageInfo: pageInfo({ token: 'T2' }) }) },
      { data: pageData([200], { trackCount: 4, pageInfo: { hasNextPage: false, token: null } }) }
    ];
    const r = await lib.paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('exhausted');
    expect(r.playlist.tracks).toHaveLength(4);
    expect(r.playlist.tracks.filter(t => t.asin === 'BDUP')).toHaveLength(2);
  });

  test('a repeated window (same first cursor) stops with no-advance', async () => {
    const first = pageData([0], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([100, 101], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) }) },
      { data: pageData([100, 101], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) }) }
    ];
    const r = await lib.paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('no-advance');
    expect(r.pages).toBe(2);
    expect(r.playlist.tracks).toHaveLength(3); // first page + one real page
  });

  test('a page error stops and keeps what merged (page-error)', async () => {
    const first = pageData([0], { trackCount: 9, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [{ error: 'Amazon playlist query failed (500)' }];
    const r = await lib.paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('page-error');
    expect(r.playlist.tracks).toHaveLength(1);
  });

  test('an empty page (zero raw edges) stops (empty-page)', async () => {
    const first = pageData([0], { trackCount: 9, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [{ data: pageData([], { trackCount: 9, pageInfo: pageInfo({ token: 'T2' }) }) }];
    const r = await lib.paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('empty-page');
    expect(r.playlist.tracks).toHaveLength(1);
  });

  test('the page cap stops the loop (page-limit)', async () => {
    const first = pageData([0], { trackCount: 9999, pageInfo: pageInfo({ token: 'T0' }) });
    const pages = [];
    for (let i = 1; i <= 10; i++) pages.push({ data: pageData([i * 100], { trackCount: 9999, pageInfo: pageInfo({ token: 'T' + i }) }) });
    const r = await lib.paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages), maxPages: 3 });
    expect(r.stop).toBe('page-limit');
    expect(r.pages).toBe(3);
    expect(r.playlist.tracks).toHaveLength(4); // first page + 3
  });

  test('the default caps are MAX_PAGES 40 / MAX_MS 120s', () => {
    // The doc's budget: a long import's hold is bounded. The defaults are the
    // plugin's constants (the caller never overrides them in the flow).
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../plugins/amazonmusic.axe'), 'utf8');
    expect(src).toMatch(/maxPages = 40, maxMs = 120000/);
  });

  test('the time cap stops the loop (time-limit)', async () => {
    let clock = 0;
    const first = pageData([0], { trackCount: 9999, pageInfo: pageInfo({ token: 'T0' }) });
    const pages = [];
    for (let i = 1; i <= 10; i++) pages.push({ data: pageData([i * 100], { trackCount: 9999, pageInfo: pageInfo({ token: 'T' + i }) }) });
    const r = await lib.paginatePlaylistTracks({
      firstPageData: first,
      fetchPage: fetcher(pages),
      maxMs: 1000,
      now: () => (clock += 400) // crosses the cap on the third check
    });
    expect(r.stop).toBe('time-limit');
    expect(r.playlist.tracks.length).toBeGreaterThanOrEqual(1);
  });

  test('a null first page (deleted/private) reports no-playlist', async () => {
    const r = await lib.paginatePlaylistTracks({ firstPageData: { playlist: null }, fetchPage: fetcher([]) });
    expect(r.playlist).toBeNull();
    expect(r.stop).toBe('no-playlist');
  });

  test('trackCount can grow from later responses', async () => {
    const first = pageData([0], { trackCount: 2, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([100], { trackCount: 3, pageInfo: pageInfo({ token: 'T2' }) }) },
      { data: pageData([200], { trackCount: 3, pageInfo: { hasNextPage: false, token: null } }) }
    ];
    const r = await lib.paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    // trackCount grew to 3 and the second page reached it — complete, not exhausted
    expect(r.stop).toBe('complete');
    expect(r.playlist.trackCount).toBe(3);
    expect(r.playlist.tracks).toHaveLength(3);
  });
});
