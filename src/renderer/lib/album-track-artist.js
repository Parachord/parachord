// A track's own artist on an album page (2026-11-23).
//
// The album page, its resolution and every album play path used to send each
// track under the album's artist. On a compilation that is "Various Artists",
// which the confidence scorer rejects against the real recording (0.5, below
// MIN_CONFIDENCE_THRESHOLD), so a compilation never found a source, and its
// tracklist had no artist column.
//
// A track gets its own artist only when none of its artists is on the
// album's own credit: a Various Artists compilation, a DJ mix, a soundtrack
// credited to someone else. A normal album, a track featuring a guest and a
// split album keep the album's artist, so their track ids (trackSlug of
// artist, title, album) and every cache keyed by them stay as they were.

const { trackSlug } = require('./track-slug');

// MusicBrainz's artist-credit as one name: each credited name followed by
// its join phrase ("Daft Punk feat. Pharrell Williams & Nile Rodgers").
function creditName(credit) {
  if (!Array.isArray(credit) || credit.length === 0) return null;
  const name = credit.map(ac => `${(ac && (ac.name || (ac.artist && ac.artist.name))) || ''}${(ac && ac.joinphrase) || ''}`).join('').trim();
  return name || null;
}

const creditIds = (credit) => new Set((Array.isArray(credit) ? credit : []).map(ac => ac && ac.artist && ac.artist.id).filter(Boolean));

// A MusicBrainz track (from inc=recordings+artist-credits) and its release's
// artist-credit: the track's own artist, or null when it shares one with the
// album or either side carries no credit (nothing to tell them apart by).
function ownTrackArtist(mbTrack, releaseCredit) {
  const trackCredit = (mbTrack && (mbTrack['artist-credit'] || (mbTrack.recording && mbTrack.recording['artist-credit']))) || null;
  const releaseIds = creditIds(releaseCredit);
  const trackIds = creditIds(trackCredit);
  if (releaseIds.size === 0 || trackIds.size === 0) return null;
  for (const id of trackIds) if (releaseIds.has(id)) return null;
  return creditName(trackCredit);
}

// The artist a track on an album plays, resolves and is keyed under.
function albumTrackArtist(track, albumArtist) {
  return (track && track.trackArtist) || albumArtist;
}

// Whether an album's tracklist needs an artist column.
function hasTrackArtists(tracks) {
  return Array.isArray(tracks) && tracks.some(t => t && t.trackArtist);
}

// An album's track as the app plays, queues, drags and resolves it: keyed
// and credited under its own artist when it has one, else the album's. The
// one place this is built, so the page, its resolution and every album
// action agree on the id (the track-sources cache is keyed by it).
function playableAlbumTrack(track, { albumArtist, album, albumArt } = {}) {
  const artist = albumTrackArtist(track, albumArtist);
  return {
    ...track,
    id: trackSlug(artist || 'unknown', (track && track.title) || 'untitled', album || 'noalbum'),
    artist,
    // Whose album it is, on a track with its own artist only (local files use
    // the same field): what opens the album from the track again
    // (albumArtistForTrack).
    ...(track && track.trackArtist && albumArtist ? { albumArtist } : {}),
    album,
    albumArt,
  };
}

// Whose album `albumName` is, for a lookup by artist and album that starts
// from a track (the playbar's album link, a missing cover): the track's
// `albumArtist` when it has one and `albumName` is the track's own album,
// else the track's artist. An album name that came from a resolved source or
// the mapper isn't the album the field describes, and "Unknown Artist" is the
// scanner's stand-in for a file with no tag.
function albumArtistForTrack(track, albumName) {
  const clean = (s) => (typeof s === 'string' ? s.trim() : '');
  const own = clean(track && track.albumArtist);
  const usable = own && !/^unknown( artist)?$/i.test(own)
    && clean(track.album) && clean(track.album) === clean(albumName);
  return usable ? own : (track && track.artist);
}

// The same rule for a service's catalog (Spotify's lookupAlbum, whose tracks
// carry an artist name and no MusicBrainz ids): the track keeps its own
// artist when none of its credited names is one of the album's. A credit is
// split on "," "&" "and" "feat." "ft." "x" "with", compared case- and
// space-insensitively.
const creditNames = (name) => String(name || '')
  .split(/\s*(?:,|&|\band\b|\bfeat\.?|\bft\.?|\bx\b|\bwith\b)\s*/i)
  .map(n => n.trim().toLowerCase())
  .filter(Boolean);
function ownCatalogTrackArtist(trackArtist, albumArtist) {
  const mine = creditNames(trackArtist);
  const album = new Set(creditNames(albumArtist));
  if (mine.length === 0 || album.size === 0) return null;
  return mine.some(n => album.has(n)) ? null : String(trackArtist).trim();
}

// MusicBrainz's "Various Artists" placeholder (its fixed artist id), or a
// name that says the same: an album whose tracks will each have their own
// artist, known before the tracks load (the tracklist skeleton's columns).
const VARIOUS_ARTISTS_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';
function isVariousArtists(artist) {
  if (!artist) return false;
  if (typeof artist === 'object' && (artist.id === VARIOUS_ARTISTS_MBID || artist.mbid === VARIOUS_ARTISTS_MBID)) return true;
  const name = typeof artist === 'string' ? artist : artist.name;
  return typeof name === 'string' && /^various( artists)?$/i.test(name.trim());
}

module.exports = { creditName, ownTrackArtist, albumTrackArtist, hasTrackArtists, playableAlbumTrack, albumArtistForTrack, isVariousArtists, ownCatalogTrackArtist, VARIOUS_ARTISTS_MBID };
