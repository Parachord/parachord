// album-track-list.js — the pure half of loadAlbumTrackList (src/renderer/app.js),
// the track list behind the album-card actions (Play, Add to Queue, Add to
// Playlist on Search, Home, Fresh Drops and Charts cards, and albums the
// browser extension sends).
//
// Those actions used to wait on MusicBrainz alone: two or three requests in
// its 1 request/s queue, behind whatever else was loading, with no fallback
// when it failed. loadAlbumTrackList races MusicBrainz against the services'
// album catalogs (loadAlbumFromCatalogs) and takes the first list with tracks.
// There is no page to settle afterwards: the action needs a list now, and the
// usual resolution pass finds every track on the user's services either way.
//
// Track ids are trackSlug(artist, title, album) of the names the caller asked
// for, whichever side answered, so a catalog list whose titles match
// MusicBrainz's gives the same ids (the rule catalogAlbumToRelease follows).

// The first promise to resolve to a non-empty `tracks` list wins:
// { ...value, index }. Rejections and empty lists are skipped; null when every
// promise has settled without tracks.
function firstNonEmptyList(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (pending === 0) { resolve(null); return; }
    let done = false;
    const settle = () => { if (--pending === 0 && !done) { done = true; resolve(null); } };
    promises.forEach((p, index) => {
      Promise.resolve(p).then((value) => {
        if (!done && value && Array.isArray(value.tracks) && value.tracks.length > 0) {
          done = true;
          resolve({ ...value, index });
          return;
        }
        settle();
      }, settle);
    });
  });
}

// MusicBrainz release (a /release lookup or a release-group browse's release,
// with recordings) → { position, title, length (ms), recordingId } per track.
function entriesFromMusicBrainzRelease(release) {
  const out = [];
  for (const medium of (release && release.media) || []) {
    for (const track of medium.tracks || []) {
      out.push({
        position: track.position,
        title: track.title || (track.recording && track.recording.title) || 'Unknown Track',
        length: track.length || null,
        recordingId: (track.recording && track.recording.id) || null,
      });
    }
  }
  return out;
}

// A catalog release (catalogAlbumToRelease's shape) → the same entries.
function entriesFromCatalogRelease(release) {
  return ((release && release.tracks) || []).map((t) => ({
    position: t.position,
    title: t.title,
    length: t.length || null,
    recordingId: null,
  }));
}

// The best release group in a MusicBrainz release-group search for an
// artist's album: a studio album credited to the artist, else anything
// credited to the artist, else the top result.
const NON_STUDIO_SECONDARY_TYPES = ['live', 'compilation', 'remix', 'dj-mix', 'mixtape/street', 'demo', 'soundtrack'];
function pickReleaseGroup(results, artistName) {
  const list = Array.isArray(results) ? results : [];
  const artistLower = String(artistName || '').toLowerCase();
  const creditedToArtist = (r) => ((r['artist-credit'] || [])[0] || {}).name
    && r['artist-credit'][0].name.toLowerCase() === artistLower;
  return list.find((r) => {
    const primary = String(r['primary-type'] || '').toLowerCase();
    const secondary = (r['secondary-types'] || []).map((t) => String(t).toLowerCase());
    return primary === 'album' && creditedToArtist(r) && !secondary.some((t) => NON_STUDIO_SECONDARY_TYPES.includes(t));
  }) || list.find(creditedToArtist) || list[0] || null;
}

module.exports = {
  firstNonEmptyList,
  entriesFromMusicBrainzRelease,
  entriesFromCatalogRelease,
  pickReleaseGroup,
};
