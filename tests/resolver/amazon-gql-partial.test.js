/**
 * HTTP 294 is the Amazon gql server's partial-success status (GQL_PARTIAL_STATUS
 * in amazon-music-logic.js). A community playlist (/user-playlists/<id>sune)
 * answers playlistDetail with 294 to Amazon's own page: one field
 * (playlist.capabilities.setOnDemand) fails on a collaborators-service 500,
 * and data.playlist is complete. Live-captured 2026-11-15 on a Prime account;
 * the fixture below is that response, trimmed to two rows.
 *
 * This file pins the HOST's copy of the rule (gqlReplayOutcome, the status
 * rule replayGql in amazon-web-player.js applies for the host's remaining
 * replay flows): 200 as before; 294 is a failure with its status unless the
 * flow passes acceptPartial and the predicate finds its data. The playlist
 * import that opted in moved into the plugin (#1356 M7) — its 294 import,
 * the playlistPartialIsUsable predicate and the plugin's own _lib copy of
 * the rule are pinned in tests/resolver/amazon-music-plugin-playlist.test.js.
 *
 * Pinned here:
 *   - gqlReplayOutcome: 200 as before; 294 is a failure with its status
 *     unless the flow passes acceptPartial and the predicate finds its data
 *   - replayGql forwards acceptPartial over the host's pageFetch, and
 *     without it a 294 keeps its status (the music-home fallback reads
 *     error.status === 294)
 */

const amazonWebPlayer = require('../../amazon-web-player');
const {
  GQL_PARTIAL_STATUS,
  gqlReplayOutcome
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
    const out = gqlReplayOutcome(partial, { acceptPartial: () => true });
    expect(out.partial).toBe(true);
    expect(out.parsed.data.playlist.title).toBe('Melancholy Alternatives');
  });

  test('a 294 whose data the predicate rejects is the plain failure', () => {
    const refused = { status: 294, text: JSON.stringify({ errors: [{ message: 'no' }], data: { playlist: null } }) };
    expect(gqlReplayOutcome(refused, { acceptPartial: () => false }))
      .toEqual({ error: 'Amazon gql query failed (294)', status: 294 });
    const notJson = { status: 294, text: '<html>' };
    expect(gqlReplayOutcome(notJson, { acceptPartial: () => true }))
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

describe('replayGql (the host pageFetch under it)', () => {
  let pageFetch;
  beforeEach(() => { pageFetch = jest.spyOn(amazonWebPlayer.webSession, 'pageFetch'); });
  afterEach(() => { pageFetch.mockRestore(); });

  test('without acceptPartial a 294 keeps its status (the music-home fallback reads it)', async () => {
    pageFetch.mockResolvedValue({ status: 294, text: JSON.stringify(PARTIAL_RESPONSE) });
    const out = await amazonWebPlayer.replayGql({}, { url: 'https://gql.music.amazon.com/', headers: {} }, CAPTURED_BODY);
    expect(out).toEqual({ error: 'Amazon gql query failed (294)', status: 294 });
  });

  test('acceptPartial is forwarded', async () => {
    pageFetch.mockResolvedValue({ status: 294, text: JSON.stringify(PARTIAL_RESPONSE) });
    const out = await amazonWebPlayer.replayGql({}, { url: 'https://gql.music.amazon.com/', headers: {} }, CAPTURED_BODY,
      { acceptPartial: () => true });
    expect(out.partial).toBe(true);
  });
});
