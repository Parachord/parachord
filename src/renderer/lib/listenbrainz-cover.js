// src/renderer/lib/listenbrainz-cover.js — the cover ListenBrainz names for
// itself.
//
// ListenBrainz attaches the Cover Art Archive release it matched
// (caa_release_mbid) and, when that release has a front image, its image id
// (caa_id) to most of what it returns: each release in
// /1/stats/user/{user}/releases (#1179), each listen's
// track_metadata.mbid_mapping, and each JSPF track's additional_metadata in
// generated playlists (#1182). So the cover is known without a search, and
// it is the exact release ListenBrainz counted.
//
// caa_id gates it: a caa_release_mbid alone does not mean the archive has a
// front image, and an unverified CAA URL is how Fresh Drops once showed
// placeholders for months (docs/architecture/album-art.md).

function listenBrainzCoverUrl(meta) {
  if (!meta || !meta.caa_id || !meta.caa_release_mbid) return null;
  return `https://coverartarchive.org/release/${meta.caa_release_mbid}/front-250`;
}

module.exports = { listenBrainzCoverUrl };
