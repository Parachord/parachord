// src/renderer/lib/release-open.js — keeping an album page's cover and lookups
// steady while it opens.
//
// An album opened from the playbar or a Collection card shows a placeholder
// page with the cover the track or card already had, then fetchReleaseData
// replaces it once MusicBrainz answers. That replacement took its cover only
// from caches keyed on MusicBrainz ids, so a miss blanked the cover; the
// Cover Art Archive fetch then swapped in its own copy of the same image, and
// the header <img> (keyed on its URL) faded in a second time (2026-10-27).
//
// Opening an album also re-ran a MusicBrainz release-group search the queue
// fetch for that album had already made, at one request a second behind
// everything else. createReleaseGroupPicks remembers the release group each
// lookup settled on, by artist and album, for the session.

const { sameAlbumIdentity, normalizeAlbumTitle, normalizeArtistName } = require('./album-catalog');

// The cover on screen, when the page on screen is this album (by artist and
// title: its id moves from a placeholder to a release group to a release
// while it loads), else null.
function carriedReleaseArt(shown, target) {
  return shown && shown.albumArt && sameAlbumIdentity(shown, target) ? shown.albumArt : null;
}

// The Cover Art Archive result fills a page that has no cover; a page that
// already shows one keeps it rather than remounting the same image.
function withArchiveCover(prev, releaseId, url) {
  if (!prev || prev.id !== releaseId || prev.albumArt || !url) return prev;
  return { ...prev, albumArt: url };
}

// { get(artist, title), set(artist, title, releaseGroup) }. A release group
// is { id, title, 'primary-type'?, 'artist-credit'? }, the shape
// handleAlbumClick takes. Only MusicBrainz release-group ids belong here:
// openers skip the release-id probe for them.
function createReleaseGroupPicks() {
  const picks = new Map();
  const keyOf = (artist, title) => {
    const a = normalizeArtistName(artist || '');
    const t = normalizeAlbumTitle(title || '');
    return a && t ? `${a}\u0000${t}` : null;
  };
  return {
    get(artist, title) {
      const key = keyOf(artist, title);
      return key ? picks.get(key) || null : null;
    },
    set(artist, title, releaseGroup) {
      const key = keyOf(artist, title);
      if (key && releaseGroup && releaseGroup.id) picks.set(key, releaseGroup);
    }
  };
}

module.exports = { carriedReleaseArt, withArchiveCover, createReleaseGroupPicks };
