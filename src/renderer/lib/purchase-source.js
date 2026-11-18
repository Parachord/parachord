// src/renderer/lib/purchase-source.js: where the playbar's Buy button sends
// you.
//
// A plug-in that sells music declares capabilities.purchase (Bandcamp today)
// and puts a purchaseUrl on its sources. The playbar offers the first such
// plug-in, in registry order, whose source for the playing track is a sure
// match: confident, by the same artist and not another version (a cover,
// remix or live cut is not the track playing, and cached sources from before
// a plug-in's stricter resolve can still carry one). Until #1523 the playbar
// looked Bandcamp up by id and read its bandcampUrl.
//
// Pure; loads under plain Node.

'use strict';

const { isOtherVersion } = require('./track-variants');

const MIN_PURCHASE_CONFIDENCE = 0.8;

// Case-insensitive, ignoring a leading "The"; one containing the other
// counts ("Artist" vs "Artist feat. Other").
function artistsMatch(trackArtist, sourceArtist) {
  if (!trackArtist || !sourceArtist) return false;
  const normalize = (s) => s.toLowerCase().replace(/^the\s+/, '').trim();
  const a1 = normalize(trackArtist);
  const a2 = normalize(sourceArtist);
  return a1 === a2 || a1.includes(a2) || a2.includes(a1);
}

// purchaseSource({ resolvers, sources, track }) →
//   { resolverId, resolverName, purchaseUrl } or null
function purchaseSource({ resolvers, sources, track }) {
  if (!track) return null;
  for (const resolver of resolvers || []) {
    if (!resolver || !resolver.capabilities || !resolver.capabilities.purchase) continue;
    const source = sources && sources[resolver.id];
    if (!source || !source.purchaseUrl) continue;
    if ((source.confidence || 0) < MIN_PURCHASE_CONFIDENCE) continue;
    if (!artistsMatch(track.artist, source.artist)) continue;
    if (isOtherVersion(source, track.artist, track.title)) continue;
    return { resolverId: resolver.id, resolverName: resolver.name, purchaseUrl: source.purchaseUrl };
  }
  return null;
}

module.exports = { purchaseSource, artistsMatch, MIN_PURCHASE_CONFIDENCE };
