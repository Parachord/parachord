/**
 * HTTP 294 is the Amazon gql server's partial-success status (GQL_PARTIAL_STATUS
 * in amazon-music-logic.js). A community playlist (/user-playlists/<id>sune)
 * answers playlistDetail with 294 to Amazon's own page: one field
 * (playlist.capabilities.setOnDemand) fails on a collaborators-service 500,
 * and data.playlist is complete. Live-captured 2026-11-15 on a Prime account;
 * the fixture below is that response, trimmed to two rows.
 *
 * Pinned here:
 *   - gqlReplayOutcome: 200 as before; 294 is a failure with its status
 *     unless the flow passes acceptPartial and the predicate finds its data
 *   - playlistPartialIsUsable: data.playlist with track edges, nothing less
 *   - replayGql forwards acceptPartial, and without it a 294 keeps its
 *     status (the music-home fallback reads error.status === 294)
 *   - lookupPlaylist replays the captured playlistDetail request verbatim and
 *     imports the tracks from a 294 answer
 *   - lookupPlaylist goes ahead as soon as the request is captured, even
 *     while the page is still loading; a load failure before any capture
 *     is still load-failed, and the navigation gate is always released
 */

const amazonWebPlayer = require('../../amazon-web-player');
const {
  GQL_PARTIAL_STATUS,
  gqlReplayOutcome,
  playlistPartialIsUsable
} = require('../../amazon-music-logic');

const PLAYLIST_ID = 'd1670975fc554eed80edd41f03d355f4sune';
const PLAYLIST_URL = `https://music.amazon.com/user-playlists/${PLAYLIST_ID}`;

// The page's own request, as captured (hash shortened).
const CAPTURED_BODY = {
  operationName: 'playlistDetail',
  variables: { id: PLAYLIST_ID, firstLimit: 100, isAuthenticated: true, includeCollaborators: false },
  extensions: { persistedQuery: { version: 1, sha256Hash: 'abc123' } }
};
const CAPTURED_HEADERS = {
  'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1',
  'content-type': 'application/json', Cookie: 'session=secret', Origin: 'https://music.amazon.com'
};

const row = (id, title, artist, i) => ({
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
      id: PLAYLIST_ID,
      __typename: 'Playlist',
      title: 'Melancholy Alternatives',
      url: PLAYLIST_URL,
      curator: { name: 'A curator' },
      description: 'A melancholic alternative playlist.',
      trackCount: 2,
      images: [],
      capabilities: { appendTracks: { isAllowed: false }, setOnDemand: null },
      tracks: {
        edges: [row('B000002UB3', 'Creep', 'Radiohead', 0), row('B000002H3Q', 'How Soon Is Now?', 'The Smiths', 1)],
        pageInfo: { hasNextPage: false, token: null, endCursor: '1:row-1' }
      }
    }
  }
};

describe('gqlReplayOutcome', () => {
  const ok = { status: 200, text: JSON.stringify({ data: { x: 1 } }) };
  const partial = { status: 294, text: JSON.stringify(PARTIAL_RESPONSE) };

  test('the partial status is 294', () => {
    expect(GQL_PARTIAL_STATUS).toBe(294);
  });

  test('200 parses as before', () => {
    expect(gqlReplayOutcome(ok)).toEqual({ parsed: { data: { x: 1 } } });
  });

  test('a 200 with errors and no data is the first error', () => {
    const out = gqlReplayOutcome({ status: 200, text: JSON.stringify({ errors: [{ message: 'boom' }] }) });
    expect(out).toEqual({ error: 'boom' });
  });

  test('a fetch error passes through', () => {
    expect(gqlReplayOutcome({ error: 'TypeError: Failed to fetch' })).toEqual({ error: 'TypeError: Failed to fetch' });
    expect(gqlReplayOutcome(null)).toEqual({ error: 'Amazon gql query failed' });
  });

  test('without acceptPartial a 294 is a failure that keeps its status', () => {
    expect(gqlReplayOutcome(partial)).toEqual({ error: 'Amazon gql query failed (294)', status: 294 });
  });

  test('with acceptPartial a usable 294 is the parsed body, marked partial', () => {
    const out = gqlReplayOutcome(partial, { acceptPartial: playlistPartialIsUsable });
    expect(out.partial).toBe(true);
    expect(out.parsed.data.playlist.title).toBe('Melancholy Alternatives');
  });

  test('a 294 whose data the predicate rejects is the plain failure', () => {
    const refused = { status: 294, text: JSON.stringify({ errors: [{ message: 'no' }], data: { playlist: null } }) };
    expect(gqlReplayOutcome(refused, { acceptPartial: playlistPartialIsUsable }))
      .toEqual({ error: 'Amazon gql query failed (294)', status: 294 });
    const notJson = { status: 294, text: '<html>' };
    expect(gqlReplayOutcome(notJson, { acceptPartial: playlistPartialIsUsable }))
      .toEqual({ error: 'Amazon gql query failed (294)', status: 294 });
  });

  test('a predicate that throws is a rejection, not a crash', () => {
    const out = gqlReplayOutcome(partial, { acceptPartial: () => { throw new Error('x'); } });
    expect(out).toEqual({ error: 'Amazon gql query failed (294)', status: 294 });
  });

  test('acceptPartial never rescues any other status', () => {
    for (const status of [204, 400, 403, 500]) {
      expect(gqlReplayOutcome({ status, text: JSON.stringify(PARTIAL_RESPONSE) }, { acceptPartial: () => true }))
        .toEqual({ error: `Amazon gql query failed (${status})`, status });
    }
  });
});

describe('playlistPartialIsUsable', () => {
  test('data.playlist with track edges is usable', () => {
    expect(playlistPartialIsUsable(PARTIAL_RESPONSE)).toBe(true);
  });

  test('a playlist with empty edges is still usable (an empty playlist)', () => {
    const empty = { data: { playlist: { id: 'x', tracks: { edges: [] } } } };
    expect(playlistPartialIsUsable(empty)).toBe(true);
  });

  test('no playlist, or no track rows block, is not', () => {
    expect(playlistPartialIsUsable({ data: { playlist: null } })).toBe(false);
    expect(playlistPartialIsUsable({ data: { playlist: { id: 'x' } } })).toBe(false);
    expect(playlistPartialIsUsable({ data: null })).toBe(false);
    expect(playlistPartialIsUsable(null)).toBe(false);
  });
});

describe('replayGql', () => {
  let evalOn;
  beforeEach(() => { evalOn = jest.spyOn(amazonWebPlayer, 'evalOn'); });
  afterEach(() => { evalOn.mockRestore(); });

  test('without acceptPartial a 294 keeps its status (the music-home fallback reads it)', async () => {
    evalOn.mockResolvedValue({ status: 294, text: JSON.stringify(PARTIAL_RESPONSE) });
    const out = await amazonWebPlayer.replayGql({}, { url: 'https://gql.music.amazon.com/', headers: {} }, CAPTURED_BODY);
    expect(out).toEqual({ error: 'Amazon gql query failed (294)', status: 294 });
  });

  test('acceptPartial is forwarded', async () => {
    evalOn.mockResolvedValue({ status: 294, text: JSON.stringify(PARTIAL_RESPONSE) });
    const out = await amazonWebPlayer.replayGql({}, { url: 'https://gql.music.amazon.com/', headers: {} }, CAPTURED_BODY,
      { acceptPartial: playlistPartialIsUsable });
    expect(out.partial).toBe(true);
  });
});

describe('lookupPlaylist on a community playlist (HTTP 294)', () => {
  const spies = [];
  const spy = (name, impl) => { const s = jest.spyOn(amazonWebPlayer, name).mockImplementation(impl); spies.push(s); return s; };
  let evalOn;
  let savedChain;

  const win = {
    isDestroyed: () => false,
    loadURL: jest.fn().mockResolvedValue(undefined),
    webContents: { isDestroyed: () => false, getURL: () => PLAYLIST_URL }
  };

  beforeEach(() => {
    savedChain = amazonWebPlayer.searchQueue;
    amazonWebPlayer.searchQueue = require('../../amazon-music-logic').createLaneQueue();
    spy('isSignedIn', async () => true);
    spy('ensureWindow', async () => win);
    spy('layoutSearch', async () => 'offscreen');
    spy('cancelSearchViewPark', () => {});
    spy('scheduleParkSearchView', () => {});
    spy('attachGqlCapture', () => ({
      captured: [{ id: 1, url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS, body: JSON.stringify(CAPTURED_BODY) }],
      detach: () => {}
    }));
    evalOn = spy('evalOn', async () => ({ status: 294, text: JSON.stringify(PARTIAL_RESPONSE) }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    while (spies.length) spies.pop().mockRestore();
    console.log.mockRestore();
    console.warn.mockRestore();
    amazonWebPlayer.searchQueue = savedChain;
  });

  test('imports the tracks from the partial answer', async () => {
    const playlist = await amazonWebPlayer.lookupPlaylist(PLAYLIST_URL);
    expect(playlist).toBeTruthy();
    expect(playlist.name).toBe('Melancholy Alternatives');
    expect(playlist.tracks.map(t => [t.title, t.artist])).toEqual([
      ['Creep', 'Radiohead'],
      ['How Soon Is Now?', 'The Smiths']
    ]);
  });

  test('replays the captured request verbatim, to the captured URL, minus browser-managed headers', async () => {
    await amazonWebPlayer.lookupPlaylist(PLAYLIST_URL);
    expect(evalOn).toHaveBeenCalledTimes(1); // hasNextPage false: no second page
    const script = evalOn.mock.calls[0][1];
    expect(script).toContain('fetch("https://gql.music.amazon.com/"');
    expect(script).toContain(JSON.stringify(JSON.stringify(CAPTURED_BODY)));
    expect(script).toContain('"csrf-token":"t"');
    expect(script).not.toContain('session=secret');
    expect(script).not.toContain('"Origin"');
  });

  test('goes ahead once the request is captured, without waiting for the page to finish loading', async () => {
    // A page that never fires did-finish-load (one slow subresource). The
    // old flow sat out the 30s load budget and failed load-failed with the
    // request already captured.
    win.loadURL.mockImplementationOnce(() => new Promise(() => {}));
    const started = Date.now();
    const playlist = await amazonWebPlayer.lookupPlaylist(PLAYLIST_URL);
    expect(playlist.tracks).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(5000);
    // The navigation gate was released: a replay may enter again.
    expect(amazonWebPlayer.replayGate.tryEnterReplay()).toBe(true);
    amazonWebPlayer.replayGate.exitReplay();
  });

  test('a load that fails before any capture is load-failed, and releases the gate', async () => {
    const err = Object.assign(new Error('Amazon Music page did not finish loading within 30000ms'), { reason: 'load-failed' });
    win.loadURL.mockImplementationOnce(() => Promise.reject(err));
    amazonWebPlayer.attachGqlCapture.mockImplementation(() => ({ captured: [], detach: () => {} }));
    await expect(amazonWebPlayer.lookupPlaylist(PLAYLIST_URL)).rejects.toMatchObject({ reason: 'load-failed' });
    expect(evalOn).not.toHaveBeenCalled();
    expect(amazonWebPlayer.replayGate.tryEnterReplay()).toBe(true);
    amazonWebPlayer.replayGate.exitReplay();
  });

  test('a 294 with no playlist is still a lookup failure', async () => {
    evalOn.mockImplementation(async () => ({ status: 294, text: JSON.stringify({ errors: [{ message: 'x' }], data: { playlist: null } }) }));
    await expect(amazonWebPlayer.lookupPlaylist(PLAYLIST_URL))
      .rejects.toMatchObject({ reason: 'lookup-failed', message: 'Amazon gql query failed (294)' });
  });
});
