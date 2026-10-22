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

module.exports = { normalizeForId, generateTrackId, generateAlbumId, generateArtistId };
