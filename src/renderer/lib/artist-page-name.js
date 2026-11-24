// Whether an artist has a page in Parachord (2026-11-24).
//
// "Various Artists" is MusicBrainz's placeholder for a compilation's credit,
// not an artist. Its page showed 300 unrelated releases, a bio, related
// artists, tour dates, and Play and Follow. It has no page: nothing links to
// one, nothing is looked up about it, and a compilation's album page names it
// as plain text.
//
// By MusicBrainz's fixed id, or the exact name. Never "Various" alone: that's
// a real act, and so are the acts whose names only contain it.

'use strict';

const { VARIOUS_ARTISTS_MBID } = require('./album-track-artist');

// `artist` is a name, or { name, id | mbid }.
function hasArtistPage(artist) {
  if (!artist) return false;
  if (typeof artist === 'object' && (artist.id === VARIOUS_ARTISTS_MBID || artist.mbid === VARIOUS_ARTISTS_MBID)) return false;
  const name = typeof artist === 'string' ? artist : artist.name;
  if (typeof name !== 'string' || !name.trim()) return false;
  return !/^various artists$/i.test(name.trim());
}

module.exports = { hasArtistPage };
