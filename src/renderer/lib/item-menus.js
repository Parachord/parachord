// src/renderer/lib/item-menus.js: the payload of a native context menu, one
// builder per item type (#1385, the per-item context-menu builder). Every
// right-click on an album, artist or playlist builds its request here and
// sends it through window.showItemMenu, so the same item gets the same menu
// wherever it is clicked.
//
// Before, each page built the payload itself. Twelve album menus sent seven
// shapes: one sent the album's id (so Copy Link pointed at the album), the
// others didn't (Copy Link fell back to a title search); some sent the year,
// some said the tracks were still loading and the rest said "click album
// first". main.js reads these fields (show-track-context-menu); keep the
// two in step.
//
// Pure; loads under plain Node.

const nameOf = (v) => (v && typeof v === 'object' ? v.name || null : v || null);
const yearOf = (v) => {
  if (typeof v === 'number') return v;
  const y = parseInt(String(v || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
};

/**
 * An album (a release). `album` takes the shapes the pages hold:
 *   title | name, artist (a name or { name }), art | albumArt | image,
 *   year | date | releaseDate | 'first-release-date',
 *   releaseGroupMbid | releaseGroupId (a MusicBrainz release group), id.
 * `opts.tracks` are its tracks when known; `opts.loading` says they are on
 * their way (the menu then says "loading" rather than "click album first").
 * `id` goes to main.js as a fallback album id; Copy Link only uses it when
 * it is a MusicBrainz id (publishCollectionSmartLink checks the shape).
 */
function releaseMenu(album, opts = {}) {
  const a = album || {};
  const title = a.title || a.name || '';
  const artist = nameOf(a.artist);
  const art = a.art || a.albumArt || a.image || null;
  const year = yearOf(a.year || a.date || a.releaseDate || a['first-release-date']);
  const releaseGroupMbid = a.releaseGroupMbid || a.releaseGroupId || null;
  const tracks = Array.isArray(opts.tracks) ? opts.tracks : [];
  return {
    type: 'release',
    name: title,
    artist,
    albumArt: art,
    year,
    id: a.id || null,
    releaseGroupMbid,
    album: { title, artist, art, year, releaseGroupMbid },
    tracks,
    loading: tracks.length === 0 && !!opts.loading,
  };
}

/** An artist: `artist` is a name or { id, name, image }. */
function artistMenu(artist) {
  const a = artist && typeof artist === 'object' ? artist : { name: artist };
  return { type: 'artist', artist: { id: a.id || null, name: a.name || '', image: a.image || null } };
}

/**
 * A playlist: { id, title, creator } and its tracks. `opts.isEphemeral` for
 * one that isn't saved (a friend's or a hosted preview).
 */
function playlistMenu(playlist, tracks, opts = {}) {
  const p = playlist || {};
  const out = {
    type: 'playlist',
    playlistId: p.id,
    name: p.title || p.name || '',
    creator: p.creator || null,
    tracks: Array.isArray(tracks) ? tracks : [],
  };
  if (opts.isEphemeral) out.isEphemeral = true;
  return out;
}

module.exports = { releaseMenu, artistMenu, playlistMenu };
