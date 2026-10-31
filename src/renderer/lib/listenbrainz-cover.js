// src/renderer/lib/listenbrainz-cover.js — the cover a ListenBrainz stats
// release names for itself.
//
// /1/stats/user/{user}/releases gives each release the Cover Art Archive
// release it counted (caa_release_mbid) and, when that release has a front
// image, its image id (caa_id). So the cover is known without a search, and
// it is the exact release ListenBrainz counted (#1179).
//
// caa_id gates it: a caa_release_mbid alone does not mean the archive has a
// front image, and an unverified CAA URL is how Fresh Drops once showed
// placeholders for months (docs/architecture/album-art.md).

function listenBrainzStatsCoverUrl(release) {
  if (!release || !release.caa_id || !release.caa_release_mbid) return null;
  return `https://coverartarchive.org/release/${release.caa_release_mbid}/front-250`;
}

module.exports = { listenBrainzStatsCoverUrl };
