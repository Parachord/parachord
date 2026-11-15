// src/renderer/lib/menu-collection-state.js: tells a native context menu
// whether its track, album or artist is already in the collection, so the
// menu offers "Remove from Collection" instead of "Add" for something saved.
//
// Every menu request goes through window.showItemMenu (app.js), which calls
// this with the current collection. Before, only two of about thirty call
// sites said whether a track was saved, and albums and artists never did, so
// the menus offered "Add" for things already in the collection (design audit
// bug 17).
//
// Pure; loads under plain Node.

const { findSavedTrack, generateAlbumId, generateArtistId } = require('./collection-ids');

const lower = (s) => String(s || '').trim().toLowerCase();

function albumInCollection(albums, album) {
  if (!album) return false;
  const list = Array.isArray(albums) ? albums : [];
  if (album.id && list.some((a) => a.id === album.id)) return true;
  const id = generateAlbumId(album.artist, album.title);
  if (list.some((a) => a.id === id)) return true;
  return list.some((a) => lower(a.title) === lower(album.title) && lower(a.artist) === lower(album.artist));
}

function artistInCollection(artists, artist) {
  const name = typeof artist === 'string' ? artist : artist && artist.name;
  if (!name) return false;
  const id = generateArtistId(name);
  return (Array.isArray(artists) ? artists : []).some((a) => a.id === id || lower(a.name) === lower(name));
}

// The album a release menu acts on, in the shape main.js sends back.
function releaseAlbum(data) {
  return data.album || { title: data.name, artist: data.artist, year: data.year, art: data.albumArt };
}

// `data` with `isInCollection` filled in for tracks, releases and artists.
// A caller that already decided (Collection's own rows) is left alone.
function withCollectionState(data, collection) {
  if (!data || typeof data !== 'object' || typeof data.isInCollection === 'boolean') return data;
  const c = collection || {};
  if (data.type === 'track') return { ...data, isInCollection: !!findSavedTrack(c.tracks || [], data.track) };
  if (data.type === 'release') return { ...data, isInCollection: albumInCollection(c.albums, releaseAlbum(data)) };
  if (data.type === 'artist') return { ...data, isInCollection: artistInCollection(c.artists, data.artist) };
  return data;
}

module.exports = { withCollectionState, albumInCollection, artistInCollection, releaseAlbum };
