// src/renderer/lib/resolver-cover.js: which service search result is an
// album's cover (#1665).
//
// The album-art pipeline's third step searches the services for "<artist>
// <album>" (getAlbumArtFromResolvers in app.js). A search answers with
// whatever is near: it used to take the artist's other album, then anyone's
// result that had art. Saved for 90 days, a wrong cover came back every
// launch. On a real profile 65 images were saved for clearly different
// artists, one of them for 32 albums. A wrong cover is worse than none, and
// the next step (iTunes, then Deezer) checks its own hits.

'use strict';

const { normalizeAlbumTitle, creditMatches } = require('./album-catalog');
const { isPlaceholderAlbum } = require('./collection-ids');
const { hasArtistPage } = require('./artist-page-name');

// "Honey (feat. X)" is the album "Honey".
const FEATURING = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;
const titleOf = (title) => normalizeAlbumTitle(String(title || '').replace(FEATURING, ''));

// The name a result answers to. A track with no album of its own (a Bandcamp
// single, or a service's "Single") is its own release, so its title stands
// in. Never otherwise: "Thriller" on "Greatest Hits" is that album's cover.
const releaseNameOf = (result) =>
  (isPlaceholderAlbum(result.album, [result.source]) ? result.title : result.album);

// Whether a search result carries this album's cover: the same title, edition
// words aside ("Dummy (Deluxe Edition)" serves "Dummy"), by the same credit.
// Equal titles, not close ones: "Greatest Hits II" is not "Greatest Hits".
function isCoverOf(result, { artist, album } = {}) {
  if (!result || !result.albumArt || !artist || !album) return false;
  // "Single", or a service's own name where an album should be, names nothing.
  if (isPlaceholderAlbum(album, [result.source])) return false;
  const want = titleOf(album);
  return !!want && want === titleOf(releaseNameOf(result)) && creditMatches(artist, result.artist);
}

// A compilation's cover. Its tracks come back under their own artists, so no
// result is credited "Various Artists"; two different artists on an album of
// that title with the same image are the compilation. Two artists' own
// "Greatest Hits" don't share an image.
function compilationCover(results, album) {
  const want = titleOf(album);
  if (!want || isPlaceholderAlbum(album)) return null;
  const artistsByImage = new Map();
  for (const r of results) {
    if (!r || !r.albumArt || !r.artist || !r.album || titleOf(r.album) !== want) continue;
    const artists = artistsByImage.get(r.albumArt) || new Set();
    artists.add(String(r.artist).trim().toLowerCase());
    if (artists.size > 1) return r.albumArt;
    artistsByImage.set(r.albumArt, artists);
  }
  return null;
}

// What to search the services for. A compilation by its title alone: no track
// is credited to Various Artists, and the words returned almost nothing
// ("Grand Theft Auto VI: The Album": 1 result with them, 20 without).
const coverQuery = ({ artist, album }) => (hasArtistPage(artist) ? `${artist} ${album}` : album);

// The cover among search results (in the services' order), or null. The album
// as asked for goes before an edition of it.
function pickResolverCover(results, { artist, album } = {}) {
  const matches = (Array.isArray(results) ? results : []).filter((r) => isCoverOf(r, { artist, album }));
  const plain = (s) => String(s || '').trim().toLowerCase();
  const exact = matches.find((r) => plain(releaseNameOf(r)) === plain(album));
  const picked = (exact || matches[0] || {}).albumArt || null;
  // "Various Artists" (the one name with no page) is a compilation's credit.
  return picked || (artist && !hasArtistPage(artist) ? compilationCover(Array.isArray(results) ? results : [], album) : null);
}

// Covers saved before this check, under "resolver:" keys, can't be told right
// from wrong, so they go, with the same image saved under a release id; the
// right ones are found again. New ones are saved as "service:", so this does
// nothing once they're gone. `dropped` is the images, for the mosaics.
function dropUnmatchedCovers(cache) {
  const entries = Object.entries(cache || {});
  const dropped = new Set(entries
    .filter(([key, entry]) => key.startsWith('resolver:') && entry && entry.url)
    .map(([, entry]) => entry.url));
  const kept = Object.fromEntries(entries.filter(([key, entry]) =>
    !key.startsWith('resolver:') && !(entry && dropped.has(entry.url))));
  return { kept, dropped };
}

module.exports = { isCoverOf, pickResolverCover, coverQuery, dropUnmatchedCovers };
