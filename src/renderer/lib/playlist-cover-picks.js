// src/renderer/lib/playlist-cover-picks.js: the covers of a playlist's
// mosaic, picked from its tracks. getPlaylistCovers (app.js) caches what
// this returns; this does the picking, with its two lookups passed in, so
// it loads and runs under plain Node.
//
// Up to `max` (4) covers, in track order. Two uniqueness rules: the album (a
// distinct album deserves its own tile) and the cover URL (four tracks from
// four albums sharing one image, such as a playlist cover stamped on every
// track or one art URL serving several album names, must not tile the same
// image four times).
//
// First pass, per track:
//   - a track with an album and an artist: its own albumArt, else
//     getAlbumArt(artist, album); one try per album;
//   - a track with its own albumArt but no album name (a history mix, an
//     imported playlist): that cover (#1578). It used to be skipped, so the
//     track cost an artist-image lookup and could show the artist instead of
//     its real cover;
//   - no cover found: the artist's image, one try per artist.
// Second pass: more artist images, for artists not used or tried yet.

async function pickPlaylistCovers(tracks, { getAlbumArt, getArtistImage, max = 4 } = {}) {
  const seenAlbums = new Set(); // Albums we've already tried
  const seenCoverUrls = new Set(); // Cover URLs already in the grid
  const seenArtists = new Set(); // Artists we've successfully used for images
  const triedArtists = new Set(); // Artists we've attempted (including failures)
  const covers = [];
  const list = Array.isArray(tracks) ? tracks : [];

  const useArtist = async (artist) => {
    const artistKey = artist.toLowerCase();
    triedArtists.add(artistKey);
    const artistResult = await getArtistImage(artist);
    if (artistResult?.url && !seenCoverUrls.has(artistResult.url)) {
      seenCoverUrls.add(artistResult.url);
      covers.push(artistResult.url);
      seenArtists.add(artistKey);
    }
  };

  for (const track of list) {
    if (covers.length >= max) break;
    if (!track) continue;

    let foundCover = false;

    if (track.album && track.artist) {
      const albumKey = `${track.artist}-${track.album}`.toLowerCase();
      if (!seenAlbums.has(albumKey)) {
        seenAlbums.add(albumKey);

        // If track already has albumArt, use it
        if (track.albumArt && !seenCoverUrls.has(track.albumArt)) {
          seenCoverUrls.add(track.albumArt);
          covers.push(track.albumArt);
          seenArtists.add(track.artist.toLowerCase()); // Mark artist as used
          foundCover = true;
        } else if (!track.albumArt) {
          // Try to fetch album art
          const artUrl = await getAlbumArt(track.artist, track.album);
          if (artUrl && !seenCoverUrls.has(artUrl)) {
            seenCoverUrls.add(artUrl);
            covers.push(artUrl);
            seenArtists.add(track.artist.toLowerCase()); // Mark artist as used
            foundCover = true;
          }
        }
      }
    } else if (track.albumArt && !seenCoverUrls.has(track.albumArt)) {
      // The track's own cover, though it has no album name (#1578).
      seenCoverUrls.add(track.albumArt);
      covers.push(track.albumArt);
      if (track.artist) seenArtists.add(track.artist.toLowerCase());
      foundCover = true;
    }

    // Fall back to artist image if no album art found for this track
    if (!foundCover && track.artist) {
      const artistKey = track.artist.toLowerCase();
      if (!seenArtists.has(artistKey) && !triedArtists.has(artistKey)) await useArtist(track.artist);
    }
  }

  // Second pass: if we still don't have enough covers, try more artist images
  for (const track of list) {
    if (covers.length >= max) break;
    if (!track || !track.artist) continue;
    const artistKey = track.artist.toLowerCase();
    // Skip if we already have art from this artist or already tried and failed
    if (seenArtists.has(artistKey) || triedArtists.has(artistKey)) continue;
    await useArtist(track.artist);
  }

  return covers;
}

module.exports = { pickPlaylistCovers };
