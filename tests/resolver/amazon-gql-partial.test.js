/**
 * HTTP 294 is the Amazon gql server's partial-success status (GQL_PARTIAL_STATUS
 * in the plugin's _lib). A community playlist (/user-playlists/<id>sune)
 * answers playlistDetail with 294 to Amazon's own page: one field
 * (playlist.capabilities.setOnDemand) fails on a collaborators-service 500,
 * and data.playlist is complete. Live-captured 2026-11-15 on a Prime account;
 * the fixture below is that response, trimmed to two rows.
 *
 * Since the teardown (#1356 M11) the plugin's _lib copy of the rule is the
 * ONLY copy (the host's amazon-music-logic.js died with the host flows): the
 * plugin's replayGql applies gqlReplayOutcome for every plugin flow — 200 as
 * before; 294 is a failure with its status unless the flow passes acceptPartial
 * and the predicate finds its data. The flow-level pins — the community
 * playlist's import over the 294, the playlistPartialIsUsable predicate, the
 * continuation pages, the refusal — live in
 * tests/resolver/amazon-music-plugin-playlist.test.js.
 *
 * Pinned here:
 *   - gqlReplayOutcome: 200 as before; 294 is a failure with its status
 *     unless the flow passes acceptPartial and the predicate finds its data
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin
} = require('../helpers/amazon-plugin-bridge');

const lib = instantiateAmazonPlugin(loadAmazonAxe()).lib;

const { GQL_PARTIAL_STATUS, gqlReplayOutcome } = lib;

const PLAYLIST_ID = 'd1670975fc554eed80edd41f03d355f4sune';
const PLAYLIST_URL = `https://music.amazon.com/user-playlists/${PLAYLIST_ID}`;

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

describe('gqlReplayOutcome (the _lib copy)', () => {
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
