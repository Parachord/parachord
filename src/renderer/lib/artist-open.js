// The MusicBrainz artist id a result already carries, for opening the artist
// page (fetchArtistData(name, { mbid })) without a name search: one turn of
// the 1 req/s MusicBrainz queue saved, and the page can't land on a namesake.
// Each returns {} when there is no MusicBrainz id to pass (a service's result,
// a local file), and the page then searches by name as before.

const { isMusicBrainzId } = require('./album-catalog');

const withMbid = (id) => (isMusicBrainzId(id) ? { mbid: id } : {});

// A Search artist row: MusicBrainz's own rows have the MBID as their id.
function artistOpenOptions(artist) {
  return withMbid(artist && artist.id);
}

// A MusicBrainz artist credit ('artist-credit' on a release group or
// recording): the first credited artist, the one whose name the row shows.
function creditOpenOptions(credit) {
  const first = Array.isArray(credit) ? credit[0] : null;
  return withMbid(first && first.artist && first.artist.id);
}

// A Search track row built from a MusicBrainz recording: artistMbids[0] is
// the first credited artist, the one in track.artist.
function trackArtistOpenOptions(track) {
  return withMbid(track && Array.isArray(track.artistMbids) ? track.artistMbids[0] : null);
}

module.exports = { artistOpenOptions, creditOpenOptions, trackArtistOpenOptions };
