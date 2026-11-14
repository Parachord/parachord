// src/renderer/lib/collection-ids.js — collection track / album / artist
// ids. Moved verbatim out of app.js's module scope so the extracted page
// modules (Track 2b split) can use them; app.js requires them back.
//
// These must stay byte-identical in behaviour with sync-providers/spotify.js:
// collection, love-push, sync and Achordion keys are built from them. Known
// gap: normalizeForId keeps only [a-z0-9], so non-Latin names collapse (see
// the track-slug follow-up in docs/architecture/renderer-patterns.md); fixing it means changing both
// sides of the pair together.

'use strict';

const { trackSlug } = require('./track-slug');

// Normalize a string for ID generation (must match sync-providers/spotify.js)
const normalizeForId = (str) => {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
};

// Generate a consistent track ID (must match sync-providers/spotify.js)
const generateTrackId = (artist, title, album) => {
  return `${normalizeForId(artist || 'unknown')}-${normalizeForId(title || 'untitled')}-${normalizeForId(album || 'noalbum')}`;
};

// Generate a consistent album ID (must match sync-providers/spotify.js)
const generateAlbumId = (artist, title) => {
  return `${normalizeForId(artist || 'unknown')}-${normalizeForId(title || 'untitled')}`;
};

// Generate a consistent artist ID (must match sync-providers/spotify.js)
const generateArtistId = (name) => {
  return normalizeForId(name || 'unknown');
};

// An album that isn't one: nothing, "Single", or the name of one of the track's
// own sources (a plugin with no album naming its service). A service name with
// no such source could be a real title, so it stays. Never compare through
// normalizeForId here: it strips non-Latin text to nothing.
const isPlaceholderAlbum = (album, sources) => {
  const name = typeof album === 'string' ? album.trim().toLowerCase() : '';
  if (!name || name === 'single') return true;
  const compact = name.replace(/[^a-z0-9]/g, '');
  if (!compact || compact !== name.replace(/[\s\p{P}]/gu, '')) return false;
  const ids = Array.isArray(sources) ? sources : Object.keys(sources || {});
  return ids.some((id) => String(id).toLowerCase() === compact);
};

const sameName = (a, b) => {
  const x = typeof a === 'string' ? a.trim().toLowerCase() : '';
  return !!x && x === (typeof b === 'string' ? b.trim().toLowerCase() : '');
};

// The saved row for a track, or null. A row's id includes the album it was
// saved with, so when a track's album changes the id no longer matches: a row
// whose album was only a placeholder also matches on artist and title. Two real
// albums stay two tracks, and exact ids win over a placeholder row.
const findSavedTrack = (tracks, track) => {
  if (!Array.isArray(tracks) || !track) return null;
  const generatedId = generateTrackId(track.artist, track.title, track.album);
  return tracks.find((t) => t.id === track.id && track.id)
    || tracks.find((t) => t.id === generatedId)
    // A row the love-import saved with a trackSlug id (a non-Latin
    // ListenBrainz love keeps its album, so `generateTrackId` collapses the
    // artist/title and never matches): a heart from search, the queue or
    // now-playing carries no album, so the slug is the only shared id
    // (parachord#1071 review).
    || tracks.find((t) => t.id === trackSlug(track.artist, track.title, track.album))
    || tracks.find((t) => sameName(t.artist, track.artist) && sameName(t.title, track.title)
      && isPlaceholderAlbum(t.album, t.sources))
    || null;
};

// Clears placeholder albums on saved rows. Ids stay as they are, so anything
// keyed by them keeps working. An album a provider synced is its real name,
// even "Single", so those rows are left alone.
const clearPlaceholderAlbums = (tracks) => {
  let changed = 0;
  const cleared = (tracks || []).map((t) => {
    if (!t || !t.album) return t;
    const synced = Object.keys(t.syncSources || {}).some((id) => id !== 'manual');
    if (synced || !isPlaceholderAlbum(t.album, t.sources)) return t;
    changed += 1;
    return { ...t, album: '' };
  });
  return { tracks: cleared, changed };
};

module.exports = {
  normalizeForId, generateTrackId, generateAlbumId, generateArtistId,
  isPlaceholderAlbum, findSavedTrack, clearPlaceholderAlbums
};
