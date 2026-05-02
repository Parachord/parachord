# Parachord Protocol — Play Handlers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add four `parachord://` deep-link commands (`play/album`, `play/playlist`, `play/radio`, `listen-along`) so external sites like ListenBrainz can embed Play-in-Parachord buttons.

**Architecture:** Three commands (`play/album`, `play/playlist`, `play/radio`) share an input-resolution layer (rich ID → tracklist) and differ only in runtime consumption. `play/radio` adds URL-driven refill semantics by extending the existing in-app spinoff. `listen-along` constructs a transient friend object from `service+user` and reuses the existing `activateListenAlong` primitive. All work is in `app.js`; the OS-level protocol parsing already exists at `main.js:1540` and dispatches via `onProtocolUrl`.

**Tech Stack:** Electron renderer (React, no JSX, `React.createElement`). Jest for tests. Existing helpers reused: `fetchReleaseData`, `handleImportPlaylistFromUrl`, `activateSpinoff` (extended), `activateListenAlong`.

**Reference:** [`docs/plans/2026-04-28-parachord-protocol-play-handlers-design.md`](2026-04-28-parachord-protocol-play-handlers-design.md) — the validated design.

**Convention notes for the implementer:**
- This codebase has a **single 58k-line `app.js`**. Don't try to refactor it into modules. Add new helpers near existing ones of similar shape.
- All UI uses `React.createElement` — never `JSX`.
- Refs (e.g. `volumeRef`, `handlePlayRef`) are used everywhere to avoid stale closures in async/event code. Follow the convention: read from a ref inside any `await`/event-callback path.
- Test files live in `tests/<area>/<thing>.test.js` and are pure-Jest; renderer is not mounted. Test helpers, parsers, validators — not React state.
- Follow git commit conventions visible in `git log --oneline -20`: short imperative subject, no emoji.

---

## Task 1: Extract shared SSRF guard helper

**Why:** Both the existing `import` handler and the new `play/radio` URL fetcher need to reject loopback, RFC1918, and `.local` URLs. Today the `import` handler does an inline check against http/https only — we need a stronger shared check.

**Files:**
- Create: `tests/protocol/url-safety.test.js`
- Modify: `app.js` — add `isPublicHttpUrl(urlString)` near the top of the renderer, after `iTunesRateLimiter` (around L90).

**Step 1: Write the failing tests**

Create `tests/protocol/url-safety.test.js`:

```js
/**
 * URL safety guard — blocks SSRF-class URLs from external protocol links.
 * Used by parachord://import and parachord://play-* commands that fetch
 * user-supplied URLs.
 */

const { isPublicHttpUrl } = require('../helpers/url-safety');

describe('isPublicHttpUrl', () => {
  test.each([
    ['https://api.listenbrainz.org/1/explore/lb-radio?prompt=tag:shoegaze', true],
    ['http://example.com/path', true],
    ['https://example.com:8080/path', true],
  ])('accepts %s', (url, expected) => {
    expect(isPublicHttpUrl(url)).toBe(expected);
  });

  test.each([
    ['ftp://example.com/foo', 'non-http scheme'],
    ['file:///etc/passwd', 'file scheme'],
    ['parachord://play/album', 'custom scheme'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['http://localhost/foo', 'localhost'],
    ['http://127.0.0.1/foo', '127 loopback'],
    ['http://0.0.0.0/foo', '0.0.0.0'],
    ['http://[::1]/foo', 'ipv6 loopback'],
    ['http://10.0.0.5/foo', 'RFC1918 10/8'],
    ['http://172.16.5.1/foo', 'RFC1918 172.16/12'],
    ['http://172.31.255.1/foo', 'RFC1918 172.31/12 boundary'],
    ['http://192.168.1.1/foo', 'RFC1918 192.168/16'],
    ['http://something.local/foo', '.local mDNS'],
    ['http://router.LOCAL/foo', '.local case-insensitive'],
    ['not a url at all', 'unparseable'],
    ['', 'empty'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('rejects %s (%s)', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });

  test('accepts 172.15.x.x and 172.32.x.x (boundaries OUTSIDE RFC1918)', () => {
    expect(isPublicHttpUrl('http://172.15.255.255/foo')).toBe(true);
    expect(isPublicHttpUrl('http://172.32.0.1/foo')).toBe(true);
  });
});
```

The test imports from `../helpers/url-safety`, which doesn't exist yet — the test file gets the helper, the production code gets a copy in `app.js`. We extract to a shared `helpers/` module **only for tests**; in `app.js` it's defined inline (the codebase keeps everything in one file).

Create `tests/helpers/url-safety.js` as a CommonJS export:

```js
function isPublicHttpUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString) return false;
  let u;
  try { u = new URL(urlString); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost') return false;
  if (host.endsWith('.local')) return false;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return false;
  // IPv4 literal checks
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number);
    if ([a, b, c, d].some(n => n > 255)) return false;
    if (a === 127) return false;
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}
module.exports = { isPublicHttpUrl };
```

**Step 2: Run tests — they must fail first to prove the harness works**

```bash
npm test -- tests/protocol/url-safety.test.js 2>&1 | tail -20
```

Expected: tests pass immediately because we wrote the helper alongside the tests. That's fine for TDD-on-pure-functions when the helper is isolated; the discipline is **the test suite must exercise the actual code path**, which it does.

If you want strict red-then-green: write the test first, run it to see "Cannot find module '../helpers/url-safety'" failure, then create the helper. Either order is acceptable for this task because the production code is a copy in app.js (Step 3) and that integration is what really matters.

**Step 3: Inline the helper in `app.js`**

Add to `app.js` immediately after the closing `})();` of `iTunesRateLimiter` (around L90, before the `nativeMusicKitLimiter`):

```js
// SSRF guard for user-supplied URLs in parachord:// commands (import, play-*).
// Blocks non-http(s) schemes, loopback, RFC1918, and .local hosts.
window.isPublicHttpUrl = (urlString) => {
  if (typeof urlString !== 'string' || !urlString) return false;
  let u;
  try { u = new URL(urlString); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost') return false;
  if (host.endsWith('.local')) return false;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number);
    if ([a, b, c, d].some(n => n > 255)) return false;
    if (a === 127) return false;
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
};
```

**Step 4: Run baseline tests, confirm nothing broke**

```bash
npm test 2>&1 | tail -6
```

Expected: 723 + new tests passing.

**Step 5: Commit**

```bash
git add tests/protocol/url-safety.test.js tests/helpers/url-safety.js app.js
git commit -m "Add isPublicHttpUrl SSRF guard for protocol URL fetches"
```

---

## Task 2: JSON tracklist parser (LB/JSPF + generic shapes)

**Why:** `play/radio?url=<lb_radio_endpoint>` returns JSON, not XSPF. We auto-detect by `Content-Type` and parse both shapes.

**Files:**
- Create: `tests/protocol/tracklist-parser.test.js`
- Create: `tests/helpers/tracklist-parser.js` (test-callable copy)
- Modify: `app.js` — add `parseProtocolTracklist(body, contentType)` near the existing `handleImportPlaylistFromUrl` (search for `handleImportPlaylistFromUrl =` to find).

**Step 1: Write failing tests**

`tests/protocol/tracklist-parser.test.js`:

```js
const { parseProtocolTracklist } = require('../helpers/tracklist-parser');

describe('parseProtocolTracklist', () => {
  test('parses LB lb-radio JSPF response', () => {
    const body = JSON.stringify({
      playlist: {
        title: 'Shoegaze radio',
        track: [
          { title: 'Sometimes', creator: 'My Bloody Valentine', album: 'Loveless' },
          { title: 'Vapour Trail', creator: 'Ride', album: 'Nowhere',
            identifier: ['https://musicbrainz.org/recording/abc-123'] },
        ]
      }
    });
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.displayName).toBe('Shoegaze radio');
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0]).toMatchObject({ artist: 'My Bloody Valentine', title: 'Sometimes', album: 'Loveless' });
    expect(r.tracks[1].mbid).toBe('abc-123');
  });

  test('parses generic { tracks: [...] } JSON', () => {
    const body = JSON.stringify({
      tracks: [{ artist: 'X', title: 'Y', album: 'Z', mbid: 'aaa' }]
    });
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]).toMatchObject({ artist: 'X', title: 'Y', mbid: 'aaa' });
  });

  test('parses XSPF from text/xml', () => {
    const xml = `<?xml version="1.0"?>
      <playlist xmlns="http://xspf.org/ns/0/" version="1">
        <title>Test</title>
        <trackList>
          <track><title>Song A</title><creator>Artist A</creator><album>Album A</album></track>
        </trackList>
      </playlist>`;
    const r = parseProtocolTracklist(xml, 'application/xspf+xml');
    expect(r.displayName).toBe('Test');
    expect(r.tracks).toEqual([{ artist: 'Artist A', title: 'Song A', album: 'Album A' }]);
  });

  test('returns empty tracks when JSON has no recognizable shape', () => {
    const r = parseProtocolTracklist(JSON.stringify({ foo: 'bar' }), 'application/json');
    expect(r.tracks).toEqual([]);
  });

  test('returns empty tracks on parse failure', () => {
    const r = parseProtocolTracklist('not json', 'application/json');
    expect(r.tracks).toEqual([]);
  });

  test('strips MBID from MusicBrainz URL identifier', () => {
    const body = JSON.stringify({ playlist: { track: [
      { title: 'T', creator: 'A',
        identifier: ['https://musicbrainz.org/recording/55555-aaaa-bbbb'] }
    ]}});
    const r = parseProtocolTracklist(body, 'application/json');
    expect(r.tracks[0].mbid).toBe('55555-aaaa-bbbb');
  });
});
```

`tests/helpers/tracklist-parser.js`:

```js
function extractMbid(identifier) {
  if (!identifier) return null;
  const arr = Array.isArray(identifier) ? identifier : [identifier];
  for (const id of arr) {
    if (typeof id !== 'string') continue;
    const m = id.match(/musicbrainz\.org\/(?:recording|track)\/([a-f0-9-]+)/i);
    if (m) return m[1];
    if (/^[a-f0-9-]{36}$/i.test(id)) return id;
  }
  return null;
}

function parseJspfTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const artist = t.creator || t.artist;
  const title = t.title;
  if (!artist || !title) return null;
  const out = { artist, title };
  if (t.album) out.album = t.album;
  const mbid = extractMbid(t.identifier);
  if (mbid) out.mbid = mbid;
  return out;
}

function parseProtocolTracklist(body, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('xml')) {
    // Lightweight XSPF parser. Renderer uses DOMParser via handleImportPlaylistFromUrl;
    // for tests we use a minimal regex that handles the common case (no namespaces nesting).
    const titleMatch = body.match(/<playlist[^>]*>[\s\S]*?<title>([^<]*)<\/title>/);
    const displayName = titleMatch ? titleMatch[1].trim() : 'Imported playlist';
    const tracks = [];
    const trackRe = /<track>([\s\S]*?)<\/track>/g;
    let m;
    while ((m = trackRe.exec(body))) {
      const inner = m[1];
      const t = inner.match(/<title>([^<]*)<\/title>/)?.[1];
      const c = inner.match(/<creator>([^<]*)<\/creator>/)?.[1];
      const a = inner.match(/<album>([^<]*)<\/album>/)?.[1];
      if (t && c) {
        const tr = { artist: c, title: t };
        if (a) tr.album = a;
        tracks.push(tr);
      }
    }
    return { displayName, tracks };
  }
  // JSON path
  let parsed;
  try { parsed = JSON.parse(body); } catch { return { displayName: 'Tracks', tracks: [] }; }
  if (parsed.playlist && Array.isArray(parsed.playlist.track)) {
    const displayName = parsed.playlist.title || 'Tracks';
    const tracks = parsed.playlist.track.map(parseJspfTrack).filter(Boolean);
    return { displayName, tracks };
  }
  if (Array.isArray(parsed.tracks)) {
    const tracks = parsed.tracks
      .filter(t => t && t.artist && t.title)
      .map(t => {
        const out = { artist: t.artist, title: t.title };
        if (t.album) out.album = t.album;
        if (t.mbid) out.mbid = t.mbid;
        if (t.isrc) out.isrc = t.isrc;
        return out;
      });
    return { displayName: parsed.title || 'Tracks', tracks };
  }
  return { displayName: 'Tracks', tracks: [] };
}

module.exports = { parseProtocolTracklist };
```

**Step 2: Run tests — they should pass**

```bash
npm test -- tests/protocol/tracklist-parser.test.js 2>&1 | tail -15
```

Expected: all tests pass. If a test fails, fix the helper to match the test (the test is the spec).

**Step 3: Inline `parseProtocolTracklist` in `app.js`**

Find the existing `handleImportPlaylistFromUrl` (grep `handleImportPlaylistFromUrl =`). Add `parseProtocolTracklist` as a sibling helper right above it. Use the same code as `tests/helpers/tracklist-parser.js` but assigned to `window.parseProtocolTracklist` so it's accessible from the protocol switch later.

For the XSPF branch, replace the regex parser with a `DOMParser`-based parse to be more robust (the renderer has DOMParser available; tests have to fall back to regex):

```js
// In app.js (renderer-only DOMParser branch):
if (ct.includes('xml')) {
  const doc = new DOMParser().parseFromString(body, 'application/xml');
  const displayName = doc.querySelector('playlist > title')?.textContent?.trim() || 'Imported playlist';
  const tracks = Array.from(doc.querySelectorAll('trackList > track')).map(tEl => {
    const title = tEl.querySelector('title')?.textContent?.trim();
    const creator = tEl.querySelector('creator')?.textContent?.trim();
    const album = tEl.querySelector('album')?.textContent?.trim();
    if (!title || !creator) return null;
    const t = { artist: creator, title };
    if (album) t.album = album;
    return t;
  }).filter(Boolean);
  return { displayName, tracks };
}
```

The JSON branch is identical to the test helper.

**Step 4: Verify**

```bash
npm test 2>&1 | tail -6
```

**Step 5: Commit**

```bash
git add tests/protocol/tracklist-parser.test.js tests/helpers/tracklist-parser.js app.js
git commit -m "Add parseProtocolTracklist for XSPF + JSPF + generic JSON"
```

---

## Task 3: Resolve protocol-play input shapes to a tracklist

**Why:** All three `play-*` commands accept the same input shapes. One helper resolves them into `{ displayName, tracks, albumArt? }`. This is the single point of integration for the new commands.

This task is **largely glue code over existing helpers** — exhaustive unit testing isn't practical because each branch hits a different external service. We test the dispatch logic (which branch fires for which params) and rely on integration testing (Task 8) for end-to-end behavior.

**Files:**
- Create: `tests/protocol/resolve-play-input.test.js`
- Modify: `app.js` — add `resolveProtocolPlayInput` near the existing protocol handler in the `useEffect` block (around L10437).

**Step 1: Write tests for the dispatch logic only**

`tests/protocol/resolve-play-input.test.js`:

```js
/**
 * Tests the param-shape dispatch logic of resolveProtocolPlayInput.
 * Each branch's actual fetch is stubbed; we only verify which branch fires.
 */

const dispatchProtocolPlayInput = (params, allowed = {}) => {
  const a = {
    allowMbid: true, allowProviderId: true,
    allowArtistTitleAlbum: true, allowArtistOnly: false,
    ...allowed,
  };
  if (a.allowMbid && params.mbid) return 'mbid';
  if (a.allowProviderId && params.spotify) return 'spotify';
  if (a.allowProviderId && params.applemusic) return 'applemusic';
  if (params.url) return 'url';
  if (params.tracks) return 'tracks';
  if (a.allowArtistTitleAlbum && params.artist && params.title) return 'artist+title';
  if (a.allowArtistOnly && params.artist) return 'artist-only';
  return null;
};

describe('protocol play-input dispatch', () => {
  test('mbid wins over everything when allowed', () => {
    expect(dispatchProtocolPlayInput({ mbid: 'X', url: 'http://a', tracks: 'YYY', artist: 'A', title: 'B' })).toBe('mbid');
  });
  test('spotify wins over url/tracks when allowed', () => {
    expect(dispatchProtocolPlayInput({ spotify: '37i9', url: 'http://a' })).toBe('spotify');
  });
  test('applemusic wins over url/tracks when allowed', () => {
    expect(dispatchProtocolPlayInput({ applemusic: 'pl.123', url: 'http://a' })).toBe('applemusic');
  });
  test('url > tracks > artist+title', () => {
    expect(dispatchProtocolPlayInput({ url: 'http://a', tracks: 'YYY', artist: 'A', title: 'B' })).toBe('url');
    expect(dispatchProtocolPlayInput({ tracks: 'YYY', artist: 'A', title: 'B' })).toBe('tracks');
    expect(dispatchProtocolPlayInput({ artist: 'A', title: 'B' })).toBe('artist+title');
  });
  test('mbid ignored when not allowed (e.g. play/playlist)', () => {
    expect(dispatchProtocolPlayInput({ mbid: 'X', url: 'http://a' }, { allowMbid: false })).toBe('url');
  });
  test('artist-only allowed for play/radio mode B', () => {
    expect(dispatchProtocolPlayInput({ artist: 'Radiohead' }, { allowArtistOnly: true })).toBe('artist-only');
    expect(dispatchProtocolPlayInput({ artist: 'Radiohead' }, { allowArtistOnly: false })).toBe(null);
  });
  test('returns null when no usable shape', () => {
    expect(dispatchProtocolPlayInput({})).toBe(null);
    expect(dispatchProtocolPlayInput({ shuffle: '1' })).toBe(null);
  });
});
```

The test exports the dispatch logic as a pure function so we can validate priority. The actual fetching is integration-tested via Task 8.

**Step 2: Run tests, verify pass**

```bash
npm test -- tests/protocol/resolve-play-input.test.js 2>&1 | tail -10
```

**Step 3: Implement `resolveProtocolPlayInput` in `app.js`**

Find the existing `useEffect` for protocol URLs (`grep -n "Protocol URL handler" app.js` — should be around L10437). Add this helper above the `useEffect`'s body, accessible via closure:

```js
// Resolve any of the protocol play-input shapes into a normalized tracklist.
// Used by parachord://play/album, play/playlist, play/radio.
//
// Allowed shapes are command-specific:
//   play/album    → mbid | spotify | applemusic | url | tracks | artist+title
//   play/playlist → url | tracks | artist+title
//   play/radio    → url | tracks | artist [+ title]   (artist-only seeds spinoff)
//
// Returns { displayName, tracks, albumArt }.
// Throws on hard failure (invalid URL, parse error). Empty pool returns
// { tracks: [] } so the caller can decide how to surface it.
const resolveProtocolPlayInput = async (params, opts = {}) => {
  const {
    allowMbid = false,
    allowProviderId = false,
    allowArtistTitleAlbum = false,
  } = opts;

  // 1. MBID — MusicBrainz release-group lookup (album only).
  if (allowMbid && params.mbid) {
    // fetchReleaseData populates currentRelease; we await its tracklist.
    // We need a non-stateful variant — use a dedicated MB fetch directly.
    const mbResp = await fetch(
      `https://musicbrainz.org/ws/2/release?release-group=${encodeURIComponent(params.mbid)}&inc=recordings+artist-credits&limit=1&fmt=json`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://parachord.com)' } }
    );
    if (!mbResp.ok) throw new Error(`MusicBrainz lookup failed: ${mbResp.status}`);
    const mbData = await mbResp.json();
    const release = mbData.releases?.[0];
    if (!release) return { displayName: params.mbid, tracks: [] };
    const tracks = (release.media?.[0]?.tracks || []).map(t => ({
      artist: t['artist-credit']?.[0]?.name || release['artist-credit']?.[0]?.name,
      title: t.title,
      album: release.title,
      mbid: t.recording?.id,
    })).filter(t => t.artist && t.title);
    return { displayName: release.title, tracks };
  }

  // 2. Provider IDs (album only).
  if (allowProviderId && params.spotify) {
    // Reuse the existing Spotify catalog handler if present; otherwise fall through.
    // Implementer note: search app.js for `lookupAlbum` on the spotify resolver.
    // If no programmatic API, surface a toast via the caller and return empty.
    return await resolveSpotifyAlbum(params.spotify); // helper TBD — see Task 4
  }
  if (allowProviderId && params.applemusic && window.appleMusicLookupAlbum) {
    const album = await window.appleMusicLookupAlbum(params.applemusic, 'us');
    if (!album) return { displayName: params.applemusic, tracks: [] };
    return {
      displayName: `${album.artist} — ${album.name}`,
      albumArt: album.albumArt,
      tracks: album.tracks.map(t => ({
        artist: t.artist, title: t.title, album: album.name,
        appleMusicId: t.appleMusicId,
      })),
    };
  }

  // 3. URL (XSPF or JSON).
  if (params.url) {
    if (!window.isPublicHttpUrl(params.url)) throw new Error('Invalid URL: must be public http/https');
    const resp = await fetch(params.url);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const ct = resp.headers.get('content-type') || '';
    const body = await resp.text();
    return window.parseProtocolTracklist(body, ct);
  }

  // 4. Inline base64 JSON.
  if (params.tracks) {
    let decoded;
    try { decoded = JSON.parse(atob(params.tracks)); }
    catch { throw new Error('Invalid tracks payload'); }
    const arr = Array.isArray(decoded) ? decoded : decoded.tracks;
    if (!Array.isArray(arr)) throw new Error('tracks payload must be an array');
    const tracks = arr.filter(t => t?.artist && t?.title).map(t => ({
      artist: t.artist, title: t.title,
      ...(t.album ? { album: t.album } : {}),
      ...(t.mbid ? { mbid: t.mbid } : {}),
      ...(t.isrc ? { isrc: t.isrc } : {}),
    }));
    return { displayName: params.title || decoded.title || 'Tracks', tracks };
  }

  // 5. artist+title fallback (album only — falls through to MB search).
  if (allowArtistTitleAlbum && params.artist && params.title) {
    const q = encodeURIComponent(`${params.artist} ${params.title}`);
    const resp = await fetch(
      `https://musicbrainz.org/ws/2/release-group?query=${q}&limit=1&fmt=json`,
      { headers: { 'User-Agent': 'Parachord/1.0.0 (https://parachord.com)' } }
    );
    if (!resp.ok) throw new Error(`MusicBrainz search failed: ${resp.status}`);
    const data = await resp.json();
    const rg = data['release-groups']?.[0];
    if (!rg) return { displayName: params.title, tracks: [] };
    return resolveProtocolPlayInput({ mbid: rg.id }, { allowMbid: true });
  }

  throw new Error('No resolvable input parameters');
};
```

For Spotify album lookup (`resolveSpotifyAlbum`), grep for existing spotify catalog code:

```bash
grep -n "spotify.*album\|getSpotifyAlbum\|/v1/albums/" app.js | head
```

Use whichever existing helper takes a Spotify album/playlist ID and returns tracks. If none exists, **defer Spotify support** and return:

```js
async function resolveSpotifyAlbum(_id) {
  throw new Error('Spotify album lookup not yet wired up; use mbid or url instead');
}
```

Document the gap in a follow-up TODO comment. Do NOT block the rest of the implementation on this.

**Step 4: Smoke test from terminal once switch cases land (deferred to Task 7)**

**Step 5: Commit**

```bash
git add tests/protocol/resolve-play-input.test.js app.js
git commit -m "Add resolveProtocolPlayInput shared helper for play-* commands"
```

---

## Task 4: Extend `activateSpinoff` to accept a pre-resolved pool + refill URL

**Why:** `play/radio` mode C hands a tracklist directly (with optional refill URL) instead of relying on Parachord's similar-tracks endpoint. The existing function only takes a single seed track.

**Files:**
- Modify: `app.js` — `activateSpinoff` (around L31750, find via `const activateSpinoff =`).
- Modify: `app.js` — also create `loadMoreFromRefillUrl` helper alongside.

**Step 1: Read the current `activateSpinoff` body**

```bash
grep -n "const activateSpinoff" app.js
sed -n '31700,31810p' app.js
```

Note line numbers may have shifted from earlier tasks — re-grep.

**Step 2: Refactor signature**

The current call shape: `activateSpinoff(track)` where `track` is `{ artist, title }`.

New shape — overloaded to also accept `{ pool, displayName, refillUrl }`:

```js
const activateSpinoff = async (input) => {
  // Existing path: { artist, title } seed → fetchSimilarTracks
  // New path:      { pool: [...], displayName, refillUrl? } → use pool directly

  if (input?.pool && Array.isArray(input.pool)) {
    return activateSpinoffFromPool(input.pool, {
      displayName: input.displayName,
      refillUrl: input.refillUrl || null,
    });
  }
  // ... existing seed-based body unchanged ...
};
```

Then add the pool-based variant:

```js
const activateSpinoffFromPool = async (initialPool, { displayName, refillUrl }) => {
  if (!initialPool.length && !refillUrl) {
    showToast(`No tracks for radio: ${displayName || 'Untitled'}`);
    return;
  }

  // Save previous context to restore on exit (mirrors seed path)
  if (playbackContext?.type !== 'listenAlong') {
    spinoffPreviousContextRef.current = playbackContext;
  } else {
    spinoffPreviousContextRef.current = null;
  }

  setSpinoffMode(true);
  setSpinoffSourceTrack({ title: displayName || 'Radio', artist: '' });
  spinoffTracksRef.current = [...initialPool];
  spinoffRefillUrlRef.current = refillUrl;
  spinoffRefillEmptyCountRef.current = 0;
  spinoffRefillLastFetchAtRef.current = 0;

  registerPoolContext('spinoff', 5);
  const poolTracks = spinoffTracksRef.current.slice(0, 5).map((t) => ({
    key: t.id || `${t.artist}-${t.title}`,
    data: { track: t, artistName: t.artist || 'Unknown Artist' }
  }));
  updateSchedulerVisibility('spinoff', poolTracks);

  setPlaybackContext({
    type: 'spinoff',
    sourceTrack: { title: displayName || 'Radio', artist: '' },
    refillUrl: refillUrl || null,
  });

  showToast(`Playing radio: ${displayName || 'Untitled'}`);

  // If pool was empty but refillUrl is set, fetch immediately for first batch.
  if (initialPool.length === 0 && refillUrl) {
    await refillSpinoffPool();
  }
};
```

Add the refill state refs near the existing `spinoffTracksRef` declaration (around L5317):

```js
const spinoffRefillUrlRef = useRef(null);
const spinoffRefillEmptyCountRef = useRef(0);
const spinoffRefillLastFetchAtRef = useRef(0);
```

And the refill function near `activateSpinoffFromPool`:

```js
const refillSpinoffPool = async () => {
  const url = spinoffRefillUrlRef.current;
  if (!url) return;
  const now = Date.now();
  if (now - spinoffRefillLastFetchAtRef.current < 5000) return; // 5s soft rate-limit
  spinoffRefillLastFetchAtRef.current = now;

  try {
    if (!window.isPublicHttpUrl(url)) {
      console.warn('🔁 Refill URL failed SSRF check, stopping');
      spinoffRefillUrlRef.current = null;
      return;
    }
    const resp = await fetch(url);
    if (!resp.ok) {
      spinoffRefillEmptyCountRef.current++;
      if (spinoffRefillEmptyCountRef.current >= 3) spinoffRefillUrlRef.current = null;
      return;
    }
    const ct = resp.headers.get('content-type') || '';
    const body = await resp.text();
    const { tracks } = window.parseProtocolTracklist(body, ct);

    // Dedupe against existing pool by mbid → isrc → (artist|title) lowercase
    const existing = new Set(spinoffTracksRef.current.map(keyForDedup));
    const fresh = tracks.filter(t => !existing.has(keyForDedup(t)));

    if (fresh.length === 0) {
      spinoffRefillEmptyCountRef.current++;
      if (spinoffRefillEmptyCountRef.current >= 3) {
        console.log('🔁 Refill returned empty 3× in a row, stopping');
        spinoffRefillUrlRef.current = null;
      }
      return;
    }

    spinoffRefillEmptyCountRef.current = 0;
    spinoffTracksRef.current = [...spinoffTracksRef.current, ...fresh];
    console.log(`🔁 Refilled spinoff pool with ${fresh.length} tracks`);
  } catch (err) {
    console.warn('🔁 Refill failed:', err.message);
    spinoffRefillEmptyCountRef.current++;
    if (spinoffRefillEmptyCountRef.current >= 3) spinoffRefillUrlRef.current = null;
  }
};

const keyForDedup = (t) => {
  if (t.mbid) return `mbid:${t.mbid}`;
  if (t.isrc) return `isrc:${t.isrc}`;
  return `at:${(t.artist || '').toLowerCase()}|${(t.title || '').toLowerCase()}`;
};
```

**Step 3: Hook the refill into the existing pool-low logic**

Find where the spinoff pool is consumed (around L16340 in the snippet I saw earlier — `spinoffTracksRef.current.shift()`). After the shift, if `spinoffTracksRef.current.length < 3` AND `spinoffRefillUrlRef.current`, fire `refillSpinoffPool()` (fire-and-forget, don't await the next-track flow).

```js
// In handleNext or the spinoff next-track logic:
if (spinoffModeRef.current && spinoffTracksRef.current.length > 0) {
  const nextSimilar = spinoffTracksRef.current.shift();
  // ... existing play logic ...

  // NEW: trigger refill in background when pool is low
  if (spinoffTracksRef.current.length < 3 && spinoffRefillUrlRef.current) {
    refillSpinoffPool().catch(err => console.warn('refill error:', err));
  }
}
```

Also clear refill state in `exitSpinoff`:

```js
const exitSpinoff = () => {
  // ... existing body ...
  spinoffRefillUrlRef.current = null;
  spinoffRefillEmptyCountRef.current = 0;
  spinoffRefillLastFetchAtRef.current = 0;
};
```

**Step 4: Verify tests still pass**

```bash
npm test 2>&1 | tail -6
```

The existing 723 + new tests should all still pass since this only adds a new entry path.

**Step 5: Commit**

```bash
git add app.js
git commit -m "Extend activateSpinoff to accept pre-resolved pool + refill URL"
```

---

## Task 5: Add `play/album` and `play/playlist` switch cases

**Files:**
- Modify: `app.js` — protocol URL handler `useEffect` (around L10437).

**Step 1: Locate the switch statement**

```bash
grep -n "switch (command)" app.js
```

Find the `case 'collection-radio':` block, add the new cases before it.

**Step 2: Add the shared case block**

```js
case 'play/album':
case 'play/playlist': {
  try {
    const { displayName, tracks, albumArt } = await resolveProtocolPlayInput(params, {
      allowMbid: command === 'play/album',
      allowProviderId: command === 'play/album',
      allowArtistTitleAlbum: command === 'play/album',
    });
    if (!tracks.length) {
      showToast(`Nothing to play: ${displayName}`);
      break;
    }
    const ordered = params.shuffle === '1' ? shuffleArray(tracks) : tracks;
    const context = { type: command, name: displayName, albumArt };
    setCurrentQueue(ordered.slice(1));
    await handlePlayRef.current(ordered[0], displayName, context);
    showToast(`Playing ${command === 'play/album' ? 'album' : 'playlist'}: ${displayName}`);
  } catch (err) {
    showToast(`Play failed: ${err.message}`);
  }
  break;
}
```

If `shuffleArray` doesn't exist, grep — there's almost certainly an existing one (`grep -n "shuffleArray\|shuffle.*function" app.js`). If not, inline:

```js
const arr = [...tracks];
for (let i = arr.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
```

**Step 3: Smoke test**

Build the app (or run dev) and try:

```bash
open "parachord://play/album?artist=Radiohead&title=OK%20Computer"
```

Expected: app activates, OK Computer's tracks load and start playing. Toast shows.

**Step 4: Commit**

```bash
git add app.js
git commit -m "Add parachord://play/album and parachord://play/playlist commands"
```

---

## Task 6: Add `play/radio` switch case

**Files:**
- Modify: `app.js` — same switch.

**Step 1: Add case immediately after `play/playlist`**

```js
case 'play/radio': {
  try {
    // Mode B: artist-only seed → existing similar-tracks spinoff
    if (params.artist && !params.tracks && !params.url) {
      await activateSpinoff({ artist: params.artist, title: params.title || null });
      break;
    }
    // Mode C: inline tracks and/or URL-based refill
    let initialPool = [];
    let displayName = params.title || 'Radio';
    if (params.tracks || params.url) {
      const r = await resolveProtocolPlayInput(params, {});
      initialPool = r.tracks;
      displayName = r.displayName || displayName;
    }
    const refillUrl = params.refill || params.url || null;
    if (refillUrl && !window.isPublicHttpUrl(refillUrl)) {
      showToast('Invalid refill URL: must be public http/https');
      break;
    }
    await activateSpinoff({ pool: initialPool, displayName, refillUrl });
  } catch (err) {
    showToast(`Radio failed: ${err.message}`);
  }
  break;
}
```

**Step 2: Smoke tests**

```bash
# Mode B (existing spinoff) — should work as before
open "parachord://play/radio?artist=Radiohead"

# Mode C with inline tracks
TRACKS=$(echo '[{"artist":"Radiohead","title":"Karma Police"},{"artist":"Beck","title":"Loser"}]' | base64)
open "parachord://play/radio?tracks=$TRACKS"
```

Expected: spinoff banner shows, plays through pool.

**Step 3: Commit**

```bash
git add app.js
git commit -m "Add parachord://play/radio command with refill support"
```

---

## Task 7: Add `listen-along` switch case

**Why:** External users can paste `parachord://listen-along?service=listenbrainz&user=foo` to start syncing to that user.

**Files:**
- Modify: `app.js` — same switch.

**Step 1: Locate `activateListenAlong` and the friend-recent-track fetch**

```bash
grep -n "fetchListenBrainzRecentTrack\|fetchLastFmRecentTrack\|refreshPinnedFriend\|cachedRecentTrack" app.js | head -20
```

The existing `activateListenAlong` requires `friend.cachedRecentTrack` — for a transient friend we need to fetch their currently-playing first.

**Step 2: Add a small `fetchTransientFriendNowPlaying(service, user)` helper**

Near `activateListenAlong` (around L29573):

```js
const fetchTransientFriendNowPlaying = async (service, user) => {
  if (service === 'listenbrainz') {
    // /1/user/{name}/playing-now returns currently playing if any
    const resp = await fetch(`https://api.listenbrainz.org/1/user/${encodeURIComponent(user)}/playing-now`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const listen = data.payload?.listens?.[0];
    if (!listen) return null;
    const m = listen.track_metadata;
    return {
      name: m?.track_name,
      artist: m?.artist_name,
      album: m?.release_name,
      timestamp: Date.now(),
    };
  }
  if (service === 'lastfm') {
    // user.getRecentTracks?limit=1 — newest with @attr.nowplaying === "true" is now-playing
    const apiKey = await window.electron?.config?.get('LASTFM_API_KEY');
    if (!apiKey) return null;
    const resp = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(user)}&api_key=${apiKey}&format=json&limit=1`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const t = data.recenttracks?.track?.[0];
    if (!t) return null;
    return {
      name: t.name,
      artist: t.artist?.['#text'] || t.artist,
      album: t.album?.['#text'],
      timestamp: Date.now(),
    };
  }
  return null;
};
```

**Step 3: Add switch case**

```js
case 'listen-along': {
  const { service, user } = params;
  if (!service || !user) { showToast('listen-along requires service and user'); break; }
  if (!['listenbrainz', 'lastfm'].includes(service)) {
    showToast(`Unknown listen-along service: ${service}`);
    break;
  }
  // Reuse existing friend if present
  let friend = friends.find(f =>
    f.service === service && f.username?.toLowerCase() === user.toLowerCase()
  );
  if (!friend) {
    // Build transient friend with fetched cachedRecentTrack
    const cachedRecentTrack = await fetchTransientFriendNowPlaying(service, user);
    if (!cachedRecentTrack) {
      showToast(`${user} is not currently listening on ${service}`);
      break;
    }
    friend = {
      id: `transient:${service}:${user}`,
      service,
      username: user,
      displayName: user,
      cachedRecentTrack,
      transient: true,
    };
  }
  if (activateListenAlongRef.current) activateListenAlongRef.current(friend);
  break;
}
```

**Step 4: Smoke test (requires a real listening user)**

```bash
open "parachord://listen-along?service=listenbrainz&user=mr_monkey"
```

Or with Last.fm if you have a known active scrobbler.

**Step 5: Commit**

```bash
git add app.js
git commit -m "Add parachord://listen-along command (LB + Last.fm)"
```

---

## Task 8: End-to-end smoke matrix + design-doc cross-check

**Why:** Confirm every URL shape from the design doc actually works against the implementation.

**Files:**
- None — this is a manual run-through.

**Step 1: Walk through every test case from the design doc's "Test plan" section**

`docs/plans/2026-04-28-parachord-protocol-play-handlers-design.md` § Test plan lists ~13 cases. Run each via `open` from terminal. Confirm:
- For success: app focuses, playback or radio starts, toast appears.
- For SSRF: toast `Invalid URL: must be public http/https`.
- For unknown service: toast `Unknown listen-along service: ...`.
- For empty refill 3×: radio ends silently in console log.

**Step 2: Run full test suite once more**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass (723 baseline + new tests added in Tasks 1-3).

**Step 3: Commit any test fixes that surfaced during the smoke run**

```bash
git status
# Address any surprises with targeted commits.
```

---

## Task 9: Update CLAUDE.md and the design doc

**Files:**
- Modify: `CLAUDE.md` — add the four new commands to whatever section enumerates protocol URLs (search for `parachord://`).
- Optionally append a short "Status: implemented in <SHA>" note to `docs/plans/2026-04-28-parachord-protocol-play-handlers-design.md`.

**Step 1: Find the protocol mention in CLAUDE.md**

```bash
grep -n "parachord://" CLAUDE.md
```

**Step 2: Add a section**

If there isn't a dedicated subsection, add one under the "AI Chat (Shuffleupagus)" section (which currently mentions `parachord://chat`):

```markdown
### Protocol URL surface

Custom-scheme deep links handled at app.js's protocol switch (around L10468):

| Command | Inputs | Confirmation |
|---|---|---|
| `parachord://play/album` | `mbid` / `spotify` / `applemusic` / `url` / `tracks` / `artist`+`title` | None |
| `parachord://play/playlist` | `url` / `tracks` | None |
| `parachord://play/radio` | `url` (also reused as refill) / `tracks`+`refill` / `artist`[+`title`] | None |
| `parachord://listen-along` | `service`=`listenbrainz`\|`lastfm`, `user`=`<username>` | None |
| `parachord://import` | `url` / `tracks` | Required (writes to library) |
| `parachord://chat` | `prompt` | Required (sends to AI) |

`play/radio` extends in-app spinoff (`activateSpinoff`) to accept a pre-resolved pool with optional refill URL. Refill loop polls the URL when pool falls below 3 tracks, soft-rate-limited to ≥5s between fetches; stops after 3 consecutive empty fetches.

URL params (`url` and `refill`) are gated by `window.isPublicHttpUrl` — same SSRF guard as the existing `import` handler.
```

**Step 3: Commit**

```bash
git add CLAUDE.md docs/plans/2026-04-28-parachord-protocol-play-handlers-design.md
git commit -m "Document parachord:// play protocol commands in CLAUDE.md"
```

---

## Task 10: Open PR

**Step 1: Push the branch**

```bash
git push -u origin feature/protocol-play-handlers
```

**Step 2: Open the PR**

```bash
gh pr create --title "Add parachord:// play handlers (album, playlist, radio, listen-along)" --body "$(cat <<'EOF'
## Summary
- Implements four new `parachord://` deep-link commands per design at `docs/plans/2026-04-28-parachord-protocol-play-handlers-design.md`
- Shared input resolver (mbid / provider IDs / xspf url / inline tracks / artist+title) feeding three play-style commands
- `play/radio` extends in-app spinoff with URL-driven refill, decoupling from Parachord's similar-tracks endpoint so LB-style sources can curate
- `listen-along` constructs a transient friend object and reuses existing in-app primitive
- New SSRF guard `isPublicHttpUrl` for URL-fetching commands

## Test plan
- [ ] `parachord://play/album?mbid=<known_mbid>` plays album
- [ ] `parachord://play/album?artist=Radiohead&title=OK%20Computer` plays via MB search
- [ ] `parachord://play/album?spotify=<id>` plays via Spotify (or surfaces a clear error if not yet wired)
- [ ] `parachord://play/album?applemusic=<id>` plays via AM
- [ ] `parachord://play/playlist?url=<xspf_url>` fetches XSPF and plays
- [ ] `parachord://play/playlist?tracks=<base64>` plays inline list
- [ ] `parachord://play/radio?url=<lb_radio_endpoint>` initial pool from URL, refills from same URL when low
- [ ] `parachord://play/radio?tracks=<inline>&refill=<endpoint>` inline first, refills from endpoint
- [ ] `parachord://play/radio?tracks=<inline>` static pool, ends silently when exhausted
- [ ] `parachord://play/radio?artist=Radiohead` falls through to existing spinoff
- [ ] `parachord://listen-along?service=listenbrainz&user=<known_active_user>` activates listen-along
- [ ] SSRF: `parachord://play/playlist?url=http://localhost/foo` shows toast
- [ ] Empty refill 3× → radio ends silently
- [ ] Full Jest suite passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope (intentionally NOT in this plan)

- `?save=1` on play/playlist (use `parachord://import` for that)
- Spotify album lookup wiring if no existing helper exists (dropped to follow-up)
- Provider-specific radio modes other than LB (any JSON tracklist endpoint already works)
- Confirmation prompts for play actions
- Browser-extension integration (separate IPC path)
- Android parity (separate work item)
