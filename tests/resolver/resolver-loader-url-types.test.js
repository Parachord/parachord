/**
 * getUrlType is manifest data (#1356 M11): a plugin's "urlTypes" declaration,
 * matched by resolver-loader first-match-wins over the same matchUrlPattern
 * glob urlPatterns uses. These pins drive the loader over the REAL built
 * .axe files (pretest regenerates them from plugins-src/), so what they test
 * is each manifest's own declaration — the per-service arms that used to live
 * in resolver-loader.js. Every case here answers exactly what the deleted
 * hardcoded arms answered for that URL.
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

const loadAxe = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins', `${id}.axe`), 'utf8'));

const loaderWith = (...ids) => {
  const loader = new ResolverLoader();
  for (const id of ids) loader.loadResolver(loadAxe(id)); // async; the URL registrations happen synchronously inside
  return loader;
};

// The URL battery every converted service is pinned against, per type.
const CASES = [
  // Spotify — open.spotify.com paths and spotify: URIs.
  ['spotify', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc', 'track'],
  ['spotify', 'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3', 'album'],
  ['spotify', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
  ['spotify', 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', 'track'],
  ['spotify', 'spotify:album:1DFixLWuPkv3KT3TnV35m3', 'album'],
  ['spotify', 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', 'playlist'],
  ['spotify', 'https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC', 'track'],
  ['spotify', 'https://open.spotify.com/intl-fr/album/1DFixLWuPkv3KT3TnV35m3', 'album'],
  // Apple Music — ?i= is one track of the album (the query-param case).
  ['applemusic', 'https://music.apple.com/us/album/still-coming-down/1440915261', 'album'],
  ['applemusic', 'https://music.apple.com/us/album/still-coming-down/1440915261?i=1440915270', 'track'],
  ['applemusic', 'https://music.apple.com/us/song/still-coming-down/1440915270', 'track'],
  ['applemusic', 'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb', 'playlist'],
  // iTunes (the legacy host) keeps the same shapes.
  ['applemusic', 'https://itunes.apple.com/us/album/still-coming-down/1440915261', 'album'],
  ['applemusic', 'https://itunes.apple.com/us/album/still-coming-down/1440915261?i=1440915270', 'track'],
  ['applemusic', 'https://itunes.apple.com/us/song/still-coming-down/1440915270', 'track'],
  // A routed itunes URL with no album/song/playlist shape is unknown, as before.
  ['applemusic', 'https://itunes.apple.com/lookup?id=1440915261', 'unknown'],
  // YouTube — ?list= (playlist page or a watch URL in a playlist) vs a video.
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'track'],
  ['youtube', 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s', 'track'],
  ['youtube', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'track'],
  ['youtube', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'track'],
  ['youtube', 'https://youtu.be/dQw4w9WgXcQ', 'track'],
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456', 'playlist'],
  ['youtube', 'https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456&index=2', 'playlist'],
  ['youtube', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456', 'playlist'],
  ['youtube', 'https://www.youtube.com/playlist?list=PL123456', 'playlist'],
  ['youtube', 'https://youtube.com/playlist?list=PL123456', 'playlist'],
  // Amazon Music — ?trackAsin= is the song share link (one track, not the album).
  ['amazonmusic', 'https://music.amazon.com/albums/B0H7NR1GWR', 'album'],
  ['amazonmusic', 'https://music.amazon.com/albums/B0H7NR1GWR?trackAsin=B0H7NZ97KH', 'track'],
  // The param can sit NON-leading in the query (?ref=dm_sh&trackAsin=) — the
  // old arm was a substring check, so the manifest carries both positions
  // (albums/*?trackAsin=* AND albums/*?*trackAsin=), both before the album
  // pattern.
  ['amazonmusic', 'https://music.amazon.com/albums/B07558DQJL?ref=dm_sh&trackAsin=B0H7NZ97KH', 'track'],
  ['amazonmusic', 'https://music.amazon.com/albums/B07558DQJL?ref=dm_sh', 'album'],
  // A /tracks/<ASIN> URL never routes (no urlPatterns entry — the plugin
  // resolves tracks by search, not by ASIN path), so no caller can reach it:
  // the old arm's '/tracks/' substring answer was an unreachable guess, and
  // under the routed-resolver scoping the honest answer is 'unknown' — the
  // manifest carries no /tracks/ typed pattern for a URL it cannot route.
  ['amazonmusic', 'https://music.amazon.com/tracks/B000SNWG5Q', 'unknown'],
  ['amazonmusic', 'https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A', 'playlist'],
  ['amazonmusic', 'https://music.amazon.com/my/playlists/PP6417A00A9C99470BBC8834FF3BF6009A?ref=dm_sh', 'playlist'],
  // /user-playlists/<id> does NOT contain the literal /playlists/ substring —
  // the share-link shape that needs its own pattern (the old arm's comment,
  // now the manifest's own pattern).
  ['amazonmusic', 'https://music.amazon.com/user-playlists/e518f7064d964396a9dc211c4a705b80', 'playlist'],
  ['amazonmusic', 'https://music.amazon.com/user-playlists/e518f706-4d96-4396-a9dc-211c4a705b80', 'playlist'],
  // Bandcamp.
  ['bandcamp', 'https://shinedoe.bandcamp.com/album/sound-of-the-overflowing-cup', 'album'],
  ['bandcamp', 'https://shinedoe.bandcamp.com/track/moving-forward', 'track'],
  // SoundCloud — the segment counting: one path segment is the artist page,
  // two or more a track, /sets/ a playlist (in that priority).
  ['soundcloud', 'https://soundcloud.com/jherskowitz', 'artist'],
  ['soundcloud', 'https://soundcloud.com/jherskowitz/', 'artist'],
  ['soundcloud', 'https://soundcloud.com/jherskowitz/sets/frozen-in-time-2026', 'playlist'],
  ['soundcloud', 'https://soundcloud.com/jherskowitz/night-heron', 'track'],
  ['soundcloud', 'https://m.soundcloud.com/jherskowitz/sets/frozen-in-time-2026', 'playlist'],
  // The on.soundcloud.com share links are short links to a TRACK (the
  // `*.soundcloud.com/*` artist pattern would otherwise claim the one
  // segment) — the pattern sits in the track group, before the artist
  // patterns (#1441 review, note 3).
  ['soundcloud', 'https://on.soundcloud.com/4uLU6hMCjMI7', 'track'],
  // ListenBrainz.
  ['listenbrainz', 'https://listenbrainz.org/playlist/abc-123', 'playlist'],
  ['listenbrainz', 'https://listenbrainz.org/playlist/abc-123/', 'playlist'],
  ['listenbrainz', 'https://www.listenbrainz.org/playlist/abc-123/', 'playlist'],
];

describe('getUrlType (the urlTypes manifest data)', () => {
  test.each(CASES)('%s classifies %s', (id, url, expected) => {
    const loader = loaderWith(id);
    expect(loader.getUrlType(url)).toBe(expected);
  });

  test('every service is loaded at once: no cross-service shadowing', () => {
    const loader = loaderWith('spotify', 'applemusic', 'youtube', 'amazonmusic', 'bandcamp', 'soundcloud', 'listenbrainz');
    for (const [, url, expected] of CASES) {
      expect(loader.getUrlType(url)).toBe(expected);
    }
  });

  test('a URL no typed pattern matches is unknown (the old default)', () => {
    const loader = loaderWith('amazonmusic', 'spotify');
    expect(loader.getUrlType('https://example.com/track/abc')).toBe('unknown');
    expect(loader.getUrlType('https://music.amazon.com/')).toBe('unknown');
    expect(loader.getUrlType('not a url')).toBe('unknown');
  });

  test('a plugin with urlPatterns but no urlTypes classifies unknown', () => {
    // The pre-urlTypes contract: a service whose manifest declares no typed
    // patterns gets 'unknown' — old apps keep their hardcoded arms and new
    // plugins must declare their own shapes.
    const loader = new ResolverLoader();
    loader.loadResolver({
      manifest: { id: 'nosetypes', name: 'No Types', version: '1.0.0' },
      capabilities: {},
      urlPatterns: ['sometype.example/track/*'],
    }); // async, but the pattern registration is synchronous
    expect(loader.findResolverForUrl('https://sometype.example/track/abc')).toBe('nosetypes');
    expect(loader.getUrlType('https://sometype.example/track/abc')).toBe('unknown');
  });

  test('only the ROUTED resolver\'s typed patterns classify (the scoping of #1441 review, note 2)', () => {
    // getUrlType resolves the routing resolver first (findResolverForUrl —
    // the urlPatterns), then matches only THAT resolver\'s typed patterns: a
    // broad typed pattern in a plugin loaded EARLIER can never classify
    // another service\'s URLs, so the type can never disagree with the
    // routing. Broad here on purpose: `*.example/track/*` matches the URL
    // the second resolver routes and types.
    const loader = new ResolverLoader();
    loader.loadResolver({
      manifest: { id: 'broad', name: 'Broad', version: '1.0.0' },
      capabilities: {},
      urlPatterns: ['broad.example/*'],
      urlTypes: { track: ['*.example/track/*'] },
    }); // async; the pattern registrations happen synchronously inside
    loader.loadResolver({
      manifest: { id: 'narrow', name: 'Narrow', version: '1.0.0' },
      capabilities: {},
      urlPatterns: ['narrow.example/track/*'],
      urlTypes: { album: ['narrow.example/track/*'] },
    });
    // A URL routed to `narrow`: broad's earlier-registered track pattern
    // matches it too, but the scoping means only narrow's own patterns —
    // which type it album — decide.
    expect(loader.findResolverForUrl('https://narrow.example/track/abc')).toBe('narrow');
    expect(loader.getUrlType('https://narrow.example/track/abc')).toBe('album');
    // And a resolver whose URL routes but whose typed patterns miss is
    // unknown, never the other plugin's answer.
    loader.loadResolver({
      manifest: { id: 'untyped', name: 'Untyped', version: '1.0.0' },
      capabilities: {},
      urlPatterns: ['untyped.example/track/*'],
    });
    expect(loader.findResolverForUrl('https://untyped.example/track/abc')).toBe('untyped');
    expect(loader.getUrlType('https://untyped.example/track/abc')).toBe('unknown');
    // broad's own URLs still classify by broad's patterns.
    expect(loader.getUrlType('https://broad.example/track/abc')).toBe('track');
  });

  test('first match wins in the manifest\'s own key order (most-specific first)', () => {
    // A synthetic declaration with overlapping patterns: the track pattern is
    // more specific than the album one, so the manifest lists "track" first —
    // exactly the Amazon shape (?trackAsin= vs the bare album page).
    const loader = new ResolverLoader();
    loader.loadResolver({
      manifest: { id: 'ordered', name: 'Ordered', version: '1.0.0' },
      capabilities: {},
      // urlPatterns route the URL to this resolver — getUrlType classifies
      // only the routed resolver's own typed patterns.
      urlPatterns: ['ordered.example/*'],
      urlTypes: {
        track: ['ordered.example/album/*?track=*'],
        album: ['ordered.example/album/*'],
      },
    });
    expect(loader.getUrlType('https://ordered.example/album/A1')).toBe('album');
    expect(loader.getUrlType('https://ordered.example/album/A1?track=T1')).toBe('track');
    // And the reverse priority when the manifest says so — the order is the
    // manifest's call, not the type names'.
    const reversed = new ResolverLoader();
    reversed.loadResolver({
      manifest: { id: 'reversed', name: 'Reversed', version: '1.0.0' },
      capabilities: {},
      urlPatterns: ['reversed.example/*'],
      urlTypes: {
        album: ['reversed.example/album/*'],
        track: ['reversed.example/album/*?track=*'],
      },
    });
    expect(reversed.getUrlType('https://reversed.example/album/A1?track=T1')).toBe('album');
  });

  test('unloading a resolver drops its typed patterns', async () => {
    const loader = loaderWith('amazonmusic');
    expect(loader.getUrlType('https://music.amazon.com/playlists/PP1')).toBe('playlist');
await loader.unloadResolver('amazonmusic'); // the resolver's own cleanup() is awaited before the pattern drops
    expect(loader.getUrlType('https://music.amazon.com/playlists/PP1')).toBe('unknown');
  });

  test('a malformed urlTypes declaration is ignored, not a load failure', () => {
    const loader = new ResolverLoader();
    expect(() => loader.loadResolver({
      manifest: { id: 'badtypes', name: 'Bad', version: '1.0.0' },
      capabilities: {},
      urlTypes: { track: 'not-an-array', album: [42], nonsense: ['bad.example/*'] },
    })).not.toThrow(); // async; a sync throw would still surface as a rejection
    expect(loader.getUrlType('https://bad.example/x')).toBe('unknown');
    expect(loader.urlTypedPatterns).toHaveLength(0);
  });

  test('the loader copies urlTypes onto the resolver and reserves the key', () => {
    const loader = new ResolverLoader();
    const resolver = loader.getResolver('amazonmusic') || (loader.loadResolver(loadAxe('amazonmusic')), loader.getResolver('amazonmusic'));
    expect(resolver.urlTypes.track).toContain('music.amazon.com/albums/*?trackAsin=*');
    expect(resolver.urlTypes.playlist).toContain('music.amazon.com/user-playlists/*');
  });
});
