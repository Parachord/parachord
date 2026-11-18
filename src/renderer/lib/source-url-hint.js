// src/renderer/lib/source-url-hint.js: a track that already knows its link
// on a service plays from that link, without a search.
//
// A track scraped from a playlist page keeps the page's link to it
// (track.sourceUrl, a Bandcamp track page today). When resolution reaches the
// plug-in that owns that link, it asks the plug-in for a source built from
// the link (its sourceFromUrl method) instead of searching by artist and
// title. Which plug-in owns a link, and whether it's a track link, is the
// registry's answer (resolver-loader.js findResolverForUrl / getUrlType, from
// each manifest's urlPatterns and urlTypes), never a check of the plug-in's
// id: resolveTrack tested `resolver.id === 'bandcamp'` until #1523.
//
// Pure; loads under plain Node.

'use strict';

// The track's link when it's a track link this plug-in owns and the plug-in
// can build a source from it; otherwise null.
function sourceUrlHint(track, resolver, loader) {
  const url = track && track.sourceUrl;
  if (!url || typeof url !== 'string' || !resolver || !loader) return null;
  if (typeof resolver.sourceFromUrl !== 'function') return null;
  if (typeof loader.findResolverForUrl !== 'function' || loader.findResolverForUrl(url) !== resolver.id) return null;
  if (typeof loader.getUrlType !== 'function' || loader.getUrlType(url) !== 'track') return null;
  return url;
}

// The plug-in's source for the track's own link, or null (no hint, or the
// plug-in had none to give), when resolveTrack falls back to resolve().
async function sourceFromUrlHint(track, resolver, loader, artistName, config) {
  const url = sourceUrlHint(track, resolver, loader);
  if (!url) return null;
  try {
    const result = await resolver.sourceFromUrl(url, {
      title: track.title,
      artist: artistName,
      album: track.album || '',
      duration: track.duration > 0 ? track.duration : null
    }, config);
    return result || null;
  } catch (error) {
    console.error(`${resolver.id} sourceFromUrl failed:`, error);
    return null;
  }
}

module.exports = { sourceUrlHint, sourceFromUrlHint };
