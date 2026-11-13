// src/renderer/lib/love-import.js — loved-tracks IMPORT into the collection
// from Last.fm / ListenBrainz (parachord#1071; the inbound half of the
// loved-tracks scrobbler sync — the push half is addTrackToCollection →
// pushLoveToScrobblers in app.js).
//
// PURE helpers only: mapping each service's loved-tracks response to
// candidates, the identity-first collection dedupe, the tombstone check,
// the love_pushed_keys no-loop marking, and the per-service import cursor.
// The fetchers live on the scrobblers (scrobbler-loader.js) and the runner
// (runLoveImport) in app.js; this module must load under plain Node.
//
// Import rules (issue #1071):
//   - identity-first dedupe: loves often have no album (Last.fm) or a
//     release the collection row doesn't share, so a naive id add would
//     create near-duplicates. Match by recording MBID, then ISRC if the
//     candidate carries one, then normalized artist + title.
//   - tombstones: a love the user removed must not come back on the next
//     import. LB loves key on the recording MBID; Last.fm loves have no
//     stable id, so the key is the normalized artist|title.
//   - the love date survives: addedAt is the service's loved-at time.
//   - no loop: every imported track is marked pushed for the service it
//     came FROM (applyLoveImportMarks), so the push toggle never sends it
//     straight back.

'use strict';

// The canonical normalizer (sync-providers/confidence-scoring.js) — same
// fold the resolver gate uses, so an imported love matches the way a
// resolved source would. Unicode-aware: non-Latin names normalize to real
// text, not '' (the reason this is required, not re-implemented).
const { normalizeStr } = require('../../../sync-providers/confidence-scoring');
const { generateTrackId } = require('./collection-ids');

const isMbid = (m) => typeof m === 'string' && /^[a-f0-9-]{36}$/i.test(m);
const isIsrc = (s) => typeof s === 'string' && /^[A-Z]{2}[0-9A-Z]{3}\d{7}$/.test(s);

// A loved-at timestamp in SECONDS (Last.fm's `date.uts` is a string,
// ListenBrainz's `created` a number) → ms, or null when absent/invalid.
// 0/negative/NaN are treated as unknown, not epoch.
const lovedAtMs = (secs) => {
  const n = typeof secs === 'string' ? Number(secs) : secs;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
};

// ── Last.fm: user.getLovedTracks page → candidates ────────────────────────
//
// Each item has name, artist.name, optional mbid (recording) and date.uts.
// A page with exactly one track returns `track` as an object, not an array.
// total comes from lovedtracks['@attr'].total (a string).
function mapLastFmLovedPage(data) {
  const loved = (data && data.lovedtracks) || {};
  const attr = loved['@attr'] || {};
  const raw = loved.track;
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const items = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const artist = typeof t.artist?.name === 'string' ? t.artist.name.trim()
      : (typeof t.artist?.['#text'] === 'string' ? t.artist['#text'].trim() : '');
    const title = typeof t.name === 'string' ? t.name.trim() : '';
    if (!artist || !title) continue; // nothing to add or match by
    items.push({
      service: 'lastfm',
      artist,
      title,
      album: '',
      mbid: isMbid(t.mbid) ? t.mbid : null,
      lovedAt: lovedAtMs(t.date?.uts),
    });
  }
  const total = Number(attr.total);
  return {
    items,
    total: Number.isFinite(total) && total >= 0 ? total : items.length,
  };
}

// ── ListenBrainz: GET /1/feedback/user/<user>/get-feedback → candidates ───
//
// Each item has recording_mbid, created (unix seconds) and — when
// metadata=true — a track_metadata block. Items without usable metadata are
// kept with needsLookup: the runner resolves names from MusicBrainz by
// recording MBID (the slow tail issue #1071 warns about), and skips the item
// when that fails.
function mapListenBrainzFeedbackPage(data) {
  const list = Array.isArray(data && data.feedback) ? data.feedback : [];
  const items = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const mbid = isMbid(f.recording_mbid) ? f.recording_mbid : null;
    if (!mbid) continue; // MSID-only feedback can't be identified or looked up
    const md = f.track_metadata || {};
    const artist = typeof md.artist_name === 'string' ? md.artist_name.trim() : '';
    const title = typeof md.track_name === 'string' ? md.track_name.trim() : '';
    const album = typeof md.release_name === 'string' ? md.release_name.trim() : '';
    items.push({
      service: 'listenbrainz',
      artist,
      title,
      album,
      mbid,
      lovedAt: lovedAtMs(f.created),
      needsLookup: !artist || !title,
    });
  }
  const total = Number(data && data.total_count);
  return {
    items,
    total: Number.isFinite(total) && total >= 0 ? total : items.length,
  };
}

// ── Identity-first dedupe against the collection ─────────────────────────

// Every recording MBID on a track: top-level `mbid` (where the MBID mapper
// and imports put it) and each source record's `mbid`.
function trackMbidList(track) {
  const out = [];
  if (isMbid(track && track.mbid)) out.push(track.mbid);
  const sources = (track && track.sources) || {};
  for (const id of Object.keys(sources)) {
    const m = sources[id] && sources[id].mbid;
    if (isMbid(m)) out.push(m);
  }
  return out;
}

// Every ISRC on a track (same walk as window.pickTrackIsrc; neither service
// returns ISRC on a love, so this tier exists for future sources).
function trackIsrcList(track) {
  const out = [];
  const top = track && track.isrc;
  if (isIsrc(typeof top === 'string' ? top.trim().toUpperCase() : top)) out.push(top.trim().toUpperCase());
  const sources = (track && track.sources) || {};
  for (const id of Object.keys(sources)) {
    const s = sources[id];
    if (!s || s.noMatch) continue;
    if (isIsrc(typeof s.isrc === 'string' ? s.isrc.trim().toUpperCase() : s.isrc)) out.push(s.isrc.trim().toUpperCase());
  }
  return out;
}

const artistTitleKey = (artist, title) => `${normalizeStr(artist)}|${normalizeStr(title)}`;

// Build the identity index over the collection's tracks: recording MBID →
// track, ISRC → track, collection id → track, normalized artist|title →
// track. First identity wins per key (an earlier row is the user's saved
// row; the import never rewrites it).
function buildCollectionIdentityIndex(tracks) {
  const index = { byMbid: new Map(), byIsrc: new Map(), byId: new Map(), byArtistTitle: new Map() };
  for (const track of Array.isArray(tracks) ? tracks : []) {
    indexTrack(index, track);
  }
  return index;
}

// Add one track's identities to the index (used for collection rows and,
// mid-import, for the batch's own accepted tracks so two loves of the same
// recording don't both get added).
function indexTrack(index, track) {
  if (!track || typeof track !== 'object') return;
  for (const m of trackMbidList(track)) {
    if (!index.byMbid.has(m)) index.byMbid.set(m, track);
  }
  for (const c of trackIsrcList(track)) {
    if (!index.byIsrc.has(c)) index.byIsrc.set(c, track);
  }
  // The collection id tier: an exact generateTrackId match is what
  // addTrackToCollection itself refuses to double-add (findSavedTrack's
  // first clause), so the import must refuse it too — even when the
  // normalized artist|title tier wouldn't fire. That matters for non-Latin
  // loves: normalizeForId is ASCII-only (the documented track-slug gap), so
  // two different Japanese tracks can both slug to `--noalbum` and would
  // otherwise be added as two rows sharing one id — corrupting every
  // id-keyed map (love_pushed_keys, resolutionScheduler, removal by id).
  if (typeof track.id === 'string' && track.id && !index.byId.has(track.id)) {
    index.byId.set(track.id, track);
  }
  const key = artistTitleKey(track.artist, track.title);
  if (normalizeStr(track.artist) && normalizeStr(track.title) && !index.byArtistTitle.has(key)) {
    index.byArtistTitle.set(key, track);
  }
}

// The matching track for a candidate, or null. Identity order (issue #1071):
// recording MBID, then ISRC, then the collection id the app itself would
// refuse to duplicate, then normalized artist + title. A candidate track
// (from buildImportTrack) matches by the same rules.
function matchCollectionTrack(index, candidate) {
  if (!index || !candidate) return null;
  if (isMbid(candidate.mbid) && index.byMbid.has(candidate.mbid)) return index.byMbid.get(candidate.mbid);
  if (isIsrc(candidate.isrc) && index.byIsrc.has(candidate.isrc)) return index.byIsrc.get(candidate.isrc);
  const id = generateTrackId(candidate.artist, candidate.title, candidate.album);
  if (index.byId.has(id)) return index.byId.get(id);
  const key = artistTitleKey(candidate.artist, candidate.title);
  if (normalizeStr(candidate.artist) && normalizeStr(candidate.title) && index.byArtistTitle.has(key)) {
    return index.byArtistTitle.get(key);
  }
  return null;
}

// ── Tombstones ────────────────────────────────────────────────────────────
//
// The (providerId, externalId) pair a removed love is tombstoned under.
// app.js's deriveTombstoneEntries writes the same keys on every removal
// (any track, not just imported ones) and addTrackToCollection clears them
// on a deliberate re-add.

// Last.fm loves have no stable per-track id, so the key is the normalized
// artist|title.
function lastfmTombstoneKey(artist, title) {
  return artistTitleKey(artist, title);
}

function tombstoneEntriesForCandidate(candidate) {
  if (!candidate) return [];
  if (candidate.service === 'listenbrainz') {
    return isMbid(candidate.mbid)
      ? [{ providerId: 'listenbrainz', externalId: candidate.mbid }]
      : [];
  }
  return [{ providerId: 'lastfm', externalId: lastfmTombstoneKey(candidate.artist, candidate.title) }];
}

// tombstones is the whole map from sync:tombstones:list:
// { [providerId]: { [externalId]: { removedAt } } }.
function isTombstoned(tombstones, candidate) {
  if (!tombstones) return false;
  return tombstoneEntriesForCandidate(candidate).some((e) => {
    const bucket = tombstones[e.providerId];
    return !!(bucket && bucket[e.externalId]);
  });
}

// ── Collection track construction ─────────────────────────────────────────

// A candidate → a collection track. addedAt keeps the service's loved-at
// time (issue #1071 rule 5); a candidate with no date gets nowMs. No album
// art (covers come from the album-art pipeline on demand, never a URL that
// wasn't requested through it), no sources (the background resolution pass
// resolves collection tracks with none).
function buildImportTrack(candidate, nowMs = Date.now()) {
  const track = {
    id: generateTrackId(candidate.artist, candidate.title, candidate.album),
    title: candidate.title,
    artist: candidate.artist,
    album: candidate.album || '',
    duration: 0,
    albumArt: null,
    sources: {},
    addedAt: typeof candidate.lovedAt === 'number' && candidate.lovedAt > 0 ? candidate.lovedAt : nowMs,
  };
  if (isMbid(candidate.mbid)) track.mbid = candidate.mbid;
  return track;
}

// ── The no-loop marks ─────────────────────────────────────────────────────

// Batch-mark track ids as pushed for the service they were imported FROM,
// preserving every other entry in the idempotency cache (the live push and
// the backfill read it; a mark here means "this service already has this
// love", so neither re-sends it).
function applyLoveImportMarks(pushedKeys, trackIds, service, ts = Date.now()) {
  const next = { ...(pushedKeys || {}) };
  for (const id of Array.isArray(trackIds) ? trackIds : []) {
    if (!id) continue;
    next[id] = { ...(next[id] || {}), [service]: ts };
  }
  return next;
}

// ── The incremental cursor ────────────────────────────────────────────────

// The fetch re-reads a small window below the cursor: both services stamp
// loved-at per second, so a bulk-love event (or replication lag) can land a
// track in the SAME second as the previous run's newest seen love, after
// that run finished. A strict `<= cursor` cut would skip it forever; the
// overlap re-fetches it and the identity dedupe absorbs the re-seen ones.
const LOVE_IMPORT_OVERLAP_MS = 2000;

// The newest loved-at seen across the fetched items (added or not), so a
// later run only fetches loves newer than this.
function nextImportCursor(items, currentMs = 0) {
  let max = currentMs || 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (typeof it.lovedAt === 'number' && it.lovedAt > max) max = it.lovedAt;
  }
  return max;
}

// Both services return loves newest-first. The first item older than the
// cursor's overlap window marks the tail as already-seen: stop paging there.
// An item with no date can't be ordered and is kept (dedupe makes it
// harmless).
function sliceNewLoved(items, cursorMs = 0) {
  const list = Array.isArray(items) ? items : [];
  if (!cursorMs) return { fresh: list.slice(), stop: false };
  const cutAt = cursorMs - LOVE_IMPORT_OVERLAP_MS;
  const cut = list.findIndex((it) => typeof it.lovedAt === 'number' && it.lovedAt <= cutAt);
  if (cut === -1) return { fresh: list.slice(), stop: false };
  return { fresh: list.slice(0, cut), stop: true };
}

// The completion toast (issue #1071's UX): added / already in collection /
// skipped (no resolvable metadata) / previously removed, plus the explicit
// cross-service note — a love imported from one service WILL be pushed to
// the other by that service's toggle, and the import must say so rather
// than let it happen silently.
function summarizeLoveImport({ serviceLabel, added, existing, skipped, removed, crossServiceLabel, crossQueued }) {
  const parts = [`Imported ${added} loved track${added === 1 ? '' : 's'} from ${serviceLabel}`];
  if (existing > 0) parts.push(`${existing} already in your collection`);
  if (removed > 0) parts.push(`${removed} previously removed`);
  if (skipped > 0) parts.push(`${skipped} skipped — no resolvable metadata`);
  let msg = parts.join(' · ');
  if (crossServiceLabel && crossQueued > 0) {
    msg += `. ${crossQueued} will also be pushed to ${crossServiceLabel} (its push toggle is on).`;
  }
  return msg;
}

module.exports = {
  LOVE_IMPORT_OVERLAP_MS,
  mapLastFmLovedPage,
  mapListenBrainzFeedbackPage,
  buildCollectionIdentityIndex,
  indexTrack,
  matchCollectionTrack,
  lastfmTombstoneKey,
  tombstoneEntriesForCandidate,
  isTombstoned,
  buildImportTrack,
  applyLoveImportMarks,
  nextImportCursor,
  sliceNewLoved,
  summarizeLoveImport,
};
