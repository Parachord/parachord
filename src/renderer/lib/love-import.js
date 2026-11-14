// src/renderer/lib/love-import.js — loved-tracks IMPORT into the collection
// from Last.fm / ListenBrainz (parachord#1071; the inbound half of the
// loved-tracks scrobbler sync — the push half is addTrackToCollection →
// pushLoveToScrobblers in app.js). Implementation plan:
// docs/plans/2026-11-06-import-loved-tracks.md.
//
// PURE helpers only; the fetchers live on the scrobblers
// (scrobbler-loader.js getLovedTracksPage) and the run (runLoveImport) in
// app.js. This module must load under plain Node (no `window` at module
// scope).
//
// Design decisions (plan, "Decisions where this plan differs from the issue"):
//   - No ISRC matching: neither service returns one on a love. Identity
//     order is recording MBID, then the normalized name key.
//   - Last.fm's `mbid` is ignored entirely (often stale; 60 of 200 sampled
//     loves had none). ListenBrainz rows keep theirs.
//   - ONE tombstone provider for the import, 'love-import', keyed by the
//     normalized name — plus the existing ('listenbrainz', recording MBID)
//     entry. A track loved on both services and removed once must not come
//     back from the other service.
//   - A love NEWER than the removal is a fresh decision and gets through.
//   - Loves already in the collection are also marked as pushed, so the
//     Backfill button never re-offers loves the service already has.

'use strict';

const { normalizeStr } = require('../../../sync-providers/confidence-scoring');
const { generateTrackId, normalizeForId } = require('./collection-ids');
const { trackSlug } = require('./track-slug');

const isMbid = (m) => typeof m === 'string' && /^[a-f0-9-]{36}$/i.test(m);

// A love must be this much NEWER than the removal to count as a fresh
// decision: clock skew between the machine and the service, and a love push
// in flight when the removal happened, both land a love dated seconds after
// the removal — a fresh decision they are not (issue #1071 review).
const LOVE_TOMBSTONE_GRACE_MS = 5 * 60 * 1000;

// A loved-at timestamp in SECONDS. Last.fm's `date.uts` is a string,
// ListenBrainz's `created` a number; 0/NaN/negative mean unknown (real
// accounts always carry a date, but a missing one must not read as epoch).
const lovedAtSecs = (secs) => {
  const n = typeof secs === 'string' ? Number(secs) : secs;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

// ── Parsing ────────────────────────────────────────────────────────────────

// user.getLovedTracks → { loves, skipped, total, totalPages, returned }.
// A page with exactly one track returns `track` as an object, not an array.
// The `mbid` on a Last.fm love is deliberately dropped (stale; see header).
function parseLastfmLovedPage(json) {
  const loved = (json && json.lovedtracks) || {};
  const attr = loved['@attr'] || {};
  const raw = loved.track;
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const loves = [];
  let skipped = 0;
  for (const t of list) {
    if (!t || typeof t !== 'object') { skipped++; continue; }
    const artist = typeof t.artist?.name === 'string' ? t.artist.name.trim()
      : (typeof t.artist?.['#text'] === 'string' ? t.artist['#text'].trim() : '');
    const title = typeof t.name === 'string' ? t.name.trim() : '';
    if (!artist || !title) { skipped++; continue; }
    loves.push({
      artist,
      title,
      album: '',
      mbid: null,
      lovedAt: lovedAtSecs(t.date?.uts),
      service: 'lastfm',
    });
  }
  const total = Number(attr.total);
  const totalPages = Number(attr.totalPages);
  return {
    loves,
    skipped,
    total: Number.isFinite(total) && total >= 0 ? total : loves.length,
    totalPages: Number.isFinite(totalPages) && totalPages >= 1 ? totalPages : null,
    // Rows on the page before the parser dropped the unnameable ones.
    returned: list.length,
  };
}

// GET /1/feedback/user/<user>/get-feedback (metadata=true) →
// { loves, skipped, total, returned }. Four shapes:
//   recording MBID + metadata     → a full love (the MBID is kept)
//   recording MBID, no names      → kept with needsLookup (the runner
//                                  resolves names from MusicBrainz)
//   no usable MBID + names        → a name-based love (MSID-only feedback
//                                  whose metadata ListenBrainz filled from
//                                  MessyBrainz; mbid: null, matched by name)
//   neither                       → skipped (truly unnameable)
// An MBID that isn't a 36-char UUID reads as no MBID, not as a failure.
function parseListenbrainzFeedbackPage(json) {
  const list = Array.isArray(json && json.feedback) ? json.feedback : [];
  const loves = [];
  let skipped = 0;
  for (const f of list) {
    if (!f || typeof f !== 'object') { skipped++; continue; }
    const mbid = isMbid(f.recording_mbid) ? f.recording_mbid : null;
    const md = f.track_metadata || {};
    const artist = typeof md.artist_name === 'string' ? md.artist_name.trim() : '';
    const title = typeof md.track_name === 'string' ? md.track_name.trim() : '';
    const album = typeof md.release_name === 'string' ? md.release_name.trim() : '';
    if (!mbid && !artist && !title) { skipped++; continue; }
    const love = {
      artist,
      title,
      album,
      mbid,
      lovedAt: lovedAtSecs(f.created),
      service: 'listenbrainz',
    };
    if (mbid && (!artist || !title)) love.needsLookup = true;
    loves.push(love);
  }
  const total = Number(json && json.total_count);
  return {
    loves,
    skipped,
    total: Number.isFinite(total) && total >= 0 ? total : loves.length,
    returned: list.length,
  };
}

// ── The name key ───────────────────────────────────────────────────────────

// The normalized `artist|title`: `Björk`/`Bjork`, `AC/DC`/`ACDC` and case
// differences fold together, non-Latin names stay distinct. A name whose
// normalizeStr is empty (the band `!!!`) falls back to the trimmed lowercase
// raw name, so it can't collide with another artist's empty key. Null when
// either name is blank.
function loveNameKey(track) {
  const { artist, title } = track || {};
  const clean = (raw) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return null;
    const norm = normalizeStr(s);
    return norm || s.toLowerCase();
  };
  const a = artist != null ? clean(artist) : null;
  const t = title != null ? clean(title) : null;
  return a && t ? `${a}|${t}` : null;
}

// ── Row ids ────────────────────────────────────────────────────────────────

// The id for an imported row. `generateTrackId` while it is meaningful (both
// the artist and the title leave something after the ASCII strip), else
// `trackSlug`'s Unicode-aware fold. Without this, every fully non-Latin love
// collapses to the same `--noalbum` id: 宇多田ヒカル/光 and 宇多田ヒカル/First
// Love would be one row, and BTS's `First Love` would collide with every
// other artist's (issue #1071 review).
function loveRowId(love) {
  if (normalizeForId(love.artist) && normalizeForId(love.title)) {
    return generateTrackId(love.artist, love.title, love.album);
  }
  return trackSlug(love.artist, love.title, love.album);
}

// ── Tombstones ─────────────────────────────────────────────────────────────

// The ('love-import', nameKey) entry every removal writes (via
// deriveTombstoneEntries in app.js). One provider for both services, so a
// track loved on both and removed once stays removed from both imports. The
// existing ('listenbrainz', recording MBID) entry is written separately and
// stays.
function loveTombstoneEntries(track) {
  const key = loveNameKey(track);
  return key ? [{ providerId: 'love-import', externalId: key }] : [];
}

// Is a love blocked by a tombstone? Checks the 'love-import' name key and
// the 'listenbrainz' recording-MBID entry. A love NEWER than the removal is
// a fresh decision and gets through, so the comparison is on dates, not
// just presence (issue #1071 review).
function isLoveTombstoned(tombstones, love) {
  return loveTombstoneAt(tombstones, love) != null && blockedByDate(tombstones, love);
}

// The newest removal date recorded for a love (name key or recording MBID),
// or null when NO tombstone entry exists at all. Callers that treat "no
// tombstone" as its own signal (the pre-ship-removals heuristic) use this:
// a removed-then-re-loved track HAS an entry and is governed by the date
// rule instead.
function loveTombstoneAt(tombstones, love) {
  if (!tombstones) return null;
  const read = (bucket, externalId) => {
    const entry = externalId && tombstones[bucket] && tombstones[bucket][externalId];
    const at = entry && typeof entry.removedAt === 'number' ? entry.removedAt : null;
    return at;
  };
  const name = read('love-import', loveNameKey(love));
  const mbid = read('listenbrainz', isMbid(love && love.mbid) ? love.mbid : null);
  if (name == null && mbid == null) return null;
  return Math.max(name == null ? 0 : name, mbid == null ? 0 : mbid);
}

function blockedByDate(tombstones, love) {
  const removedAt = loveTombstoneAt(tombstones, love);
  if (removedAt == null) return false;
  const lovedAtMs = typeof love.lovedAt === 'number' ? love.lovedAt * 1000 : 0;
  return lovedAtMs <= removedAt + LOVE_TOMBSTONE_GRACE_MS;
}

// ── Pre-ship removals ───────────────────────────────────────────────────────

// A removal from before this feature shipped has no tombstone — but its
// `love_pushed_keys` mark is still there. The mark usually sits under an
// album-bearing id (`artist-title-album` — a heart from an album page),
// while the import candidate computes `artist-title-noalbum`; the song is
// still the same, so match the exact id first, then the
// `normalizeForId(artist)-normalizeForId(title)-` prefix form. trackSlug ids
// (non-Latin names) keep exact matching only: their fold shares no prefix
// shape. Run this ONLY where no tombstone entry exists at all (see
// loveTombstoneAt) — a removed-then-re-loved track has one and is governed
// by the date rule instead.
function isOrphanedLovePush(orphanIds, row) {
  if (!orphanIds || orphanIds.size === 0 || !row || !row.id) return false;
  if (orphanIds.has(row.id)) return true;
  const artist = normalizeForId(row.artist);
  const title = normalizeForId(row.title);
  if (!artist || !title) return false; // a trackSlug id has no prefix form
  const prefix = `${artist}-${title}-`;
  for (const id of orphanIds) {
    if (id.startsWith(prefix)) return true;
  }
  return false;
}

// ── The plan: what a love import adds ──────────────────────────────────────

// planLoveImport(loves, tracks, tombstones) →
//   { add, matchedIds, tombstoned }
//     add        Row[] — rows to append ({ id, title, artist, album,
//                 duration, albumArt, sources, addedAt, mbid? })
//     matchedIds — ids of COLLECTION rows the loves matched (marked as
//                 pushed, so Backfill doesn't re-offer them)
//     tombstoned — how many loves a tombstone (or a fresh-enough re-love
//                 rule) blocked
// needsLookup loves are ignored here; the runner resolves their names first.
// Two loves for the same track in one batch add one row with the EARLIER
// lovedAt. Index-built, so 20k loves against 20k rows stays fast.
function planLoveImport(loves, tracks, tombstones, nowMs = Date.now()) {
  const byMbid = new Map();
  const byName = new Map();
  const byId = new Map();
  for (const row of Array.isArray(tracks) ? tracks : []) {
    if (!row || typeof row !== 'object') continue;
    const mbids = [row.mbid];
    const sources = row.sources || {};
    for (const id of Object.keys(sources)) {
      if (sources[id] && sources[id].mbid) mbids.push(sources[id].mbid);
    }
    for (const m of mbids) {
      if (isMbid(m) && !byMbid.has(m)) byMbid.set(m, row);
    }
    const key = loveNameKey(row);
    if (key && !byName.has(key)) byName.set(key, row);
    if (typeof row.id === 'string' && row.id && !byId.has(row.id)) byId.set(row.id, row);
  }

  // The batch's own rows, indexed by id / MBID / name, so a second love of
  // the same recording in one run merges into the added row instead of
  // counting as a match or adding a duplicate.
  const add = new Map(); // rowId → Row (batch-internal dedupe, earlier lovedAt)
  const addedByMbid = new Map();
  const addedByName = new Map();
  const matchedIds = [];
  let tombstoned = 0;
  let merged = 0;

  for (const love of Array.isArray(loves) ? loves : []) {
    if (!love || love.needsLookup) continue;
    if (isLoveTombstoned(tombstones, love)) { tombstoned++; continue; }
    const addedAt = typeof love.lovedAt === 'number' ? love.lovedAt * 1000 : nowMs;
    const nameKey = loveNameKey(love);
    const batchRow = (isMbid(love.mbid) ? addedByMbid.get(love.mbid) : null)
      || (nameKey ? addedByName.get(nameKey) : null);
    if (batchRow) {
      // A second love of the same recording in the same batch: keep the row,
      // with the earlier lovedAt — and count it, so the summary doesn't lose
      // loves to the merge.
      if (addedAt < batchRow.addedAt) batchRow.addedAt = addedAt;
      merged++;
      continue;
    }
    const matched = (isMbid(love.mbid) && byMbid.get(love.mbid)) || byName.get(nameKey);
    if (matched) { matchedIds.push(matched.id); continue; }
    // A row id can collide without the name key matching: `generateTrackId`
    // strips everything non-ASCII, so `BTS – 봄날 (Spring Day)` and
    // `BTS – 春の日 (Spring Day)` both come out `bts-spring-day-noalbum` —
    // different songs that must not silently merge. Same id AND same name key
    // is the same song (matched above); the same id with a DIFFERENT name key
    // falls back to the collision-resistant trackSlug id.
    let rowId = loveRowId(love);
    const idOwner = add.get(rowId) || byId.get(rowId);
    if (idOwner && loveNameKey(idOwner) !== nameKey) rowId = trackSlug(love.artist, love.title, love.album);
    const row = {
      id: rowId,
      title: love.title,
      artist: love.artist,
      album: love.album || '',
      duration: undefined,
      albumArt: undefined,
      sources: {},
      addedAt,
    };
    if (isMbid(love.mbid)) row.mbid = love.mbid;
    add.set(row.id, row);
    if (isMbid(row.mbid)) addedByMbid.set(row.mbid, row);
    if (nameKey) addedByName.set(nameKey, row);
  }

  return { add: [...add.values()], matchedIds, tombstoned, merged };
}

// recording MBID → row, over a track list (for the runner's lookup tail: a
// metadata-less love whose MBID is already in the collection matches without
// spending a 1.1s MusicBrainz request).
function rowMbidIndex(tracks) {
  const byMbid = new Map();
  for (const row of Array.isArray(tracks) ? tracks : []) {
    if (!row || typeof row !== 'object') continue;
    const mbids = [row.mbid];
    const sources = row.sources || {};
    for (const id of Object.keys(sources)) {
      if (sources[id] && sources[id].mbid) mbids.push(sources[id].mbid);
    }
    for (const m of mbids) {
      if (isMbid(m) && !byMbid.has(m)) byMbid.set(m, row);
    }
  }
  return byMbid;
}

// ── The page walk ──────────────────────────────────────────────────────────

// Walk the service's pages newest-first until the cursor's window is read.
// `fetchPage({ page, offset, count })` is injected (Last.fm pages by `page`,
// ListenBrainz by `offset`, advanced by `returned` because a service may
// return fewer rows than asked). Stops at the first love older than the
// cursor — loves EQUAL to it are kept and the overlap is absorbed by dedupe —
// or when a page comes back empty / the whole account has been read.
//
// A page that fails is retried with a short backoff (a blip on page 240 must
// not throw away 20 minutes of walking); once the retries are spent the walk
// gives up WITHOUT throwing: { complete: false, error }, so the caller can
// commit what it has and hold the cursor.
function collectLoves({
  fetchPage,
  parse,
  cursor = 0,
  pageSize = 200,
  onProgress,
  retryDelays = [2000, 4000],
  pageGapMs = 300,
  maxPages = 500,
}) {
  return (async () => {
    const loves = [];
    let skipped = 0;
    let needsLookup = 0;
    let seen = 0;
    let total = 0;
    let page = 1;
    let offset = 0;

    for (;;) {
      let json;
      try {
        let attempt = 0;
        for (;;) {
          try {
            json = await fetchPage({ page, offset, count: pageSize });
            break;
          } catch (err) {
            // Permanent failures don't get the backoff — a config problem
            // ('Not connected') or a wrong username ('User not found')
            // won't heal in 2s, so surface it right away.
            const msg = err?.message || '';
            if (attempt >= retryDelays.length || /not connected|user not found/i.test(msg)) throw err;
            await new Promise((r) => setTimeout(r, retryDelays[attempt]));
            attempt++;
          }
        }
      } catch (err) {
        return { loves, skipped, needsLookup, complete: false, error: err?.message || String(err), capped: false, total };
      }

      const parsed = parse(json);
      if (page === 1 && parsed.total > 0) total = parsed.total;
      seen += parsed.returned;
      skipped += parsed.skipped;
      if (onProgress) onProgress(seen, total || seen);

      // The cursor cut: the first love older than the cursor ends the walk.
      // Loves equal to it are kept (both services stamp per second, so a
      // same-second re-love must survive); a love with no date can't be
      // ordered and is kept (dedupe makes it harmless).
      let cut = -1;
      if (cursor > 0) {
        for (let i = 0; i < parsed.loves.length; i++) {
          const l = parsed.loves[i];
          if (typeof l.lovedAt === 'number' && l.lovedAt < cursor) { cut = i; break; }
        }
      }
      const pageLoves = cut === -1 ? parsed.loves : parsed.loves.slice(0, cut);
      for (const l of pageLoves) if (l.needsLookup) needsLookup++;
      loves.push(...pageLoves);

      const lastPage = cut !== -1
        || parsed.returned === 0
        || (parsed.total > 0 && seen >= parsed.total)
        || (parsed.totalPages && page >= parsed.totalPages)
        || page >= maxPages;
      if (lastPage) {
        // Capped claims only when the account had more: an account whose
        // loves end EXACTLY at the page cap finished naturally, and its
        // summary shouldn't apologize for a cap it never hit.
        const moreRemained = parsed.total > 0 ? seen < parsed.total : parsed.returned >= pageSize;
        return { loves, skipped, needsLookup, complete: true, error: null, capped: page >= maxPages && moreRemained, total };
      }
      page++;
      offset += parsed.returned;
      await new Promise((r) => setTimeout(r, pageGapMs));
    }
  })();
}

// ── The cursor and the no-loop marks ───────────────────────────────────────

// The next cursor: only a COMPLETE walk advances it (a failure on page 7 of
// 20 must not lose pages 8 to 20 forever), and it never moves backwards.
// The caller additionally gates this on the collection write having landed
// (a failed save must re-import), so this only computes the date side.
function nextLoveCursor(previous, loves, complete) {
  if (!complete) return previous || 0;
  let max = previous || 0;
  for (const l of Array.isArray(loves) ? loves : []) {
    if (typeof l.lovedAt === 'number' && l.lovedAt > max) max = l.lovedAt;
  }
  return max;
}

// Batch-mark track ids as pushed for a service, preserving every other entry
// (the live push and the backfill both read this map; a mark here means
// "this service already has this love", so neither re-sends it). One map
// write for the whole batch — markLovePushed writes the whole map per call.
function withLovesPushed(pushedKeys, trackIds, service, now = Date.now()) {
  const next = { ...(pushedKeys || {}) };
  for (const id of Array.isArray(trackIds) ? trackIds : []) {
    if (!id) continue;
    next[id] = { ...(next[id] || {}), [service]: now };
  }
  return next;
}

module.exports = {
  LOVE_TOMBSTONE_GRACE_MS,
  isOrphanedLovePush,
  parseLastfmLovedPage,
  parseListenbrainzFeedbackPage,
  loveNameKey,
  loveRowId,
  loveTombstoneEntries,
  isLoveTombstoned,
  loveTombstoneAt,
  planLoveImport,
  rowMbidIndex,
  collectLoves,
  nextLoveCursor,
  withLovesPushed,
};
