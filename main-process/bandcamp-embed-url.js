// bandcamp-embed-url.js: which Bandcamp embed URLs the app will load.
//
// A renderer message decides what gets loaded here, so this is strict: an embed
// is built from a numeric track id, and a page is fetched only if it is a track
// page on a bandcamp.com subdomain. The URL is always the single-track form:
// `album=…/track=…` starts on that track, but it is a player for the album.

const EMBED_ORIGIN = 'https://bandcamp.com';
const EMBED_SUFFIX = '/size=large/bgcol=333333/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/';
const EMBED_URL = /^https:\/\/bandcamp\.com\/EmbeddedPlayer\/track=\d+\/size=large\/bgcol=333333\/linkcol=ffffff\/tracklist=false\/artwork=small\/transparent=true\/$/;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function bandcampEmbedUrl(trackId) {
  const id = typeof trackId === 'number' ? (Number.isSafeInteger(trackId) && trackId > 0 ? String(trackId) : '') : trackId;
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return null;
  return `${EMBED_ORIGIN}/EmbeddedPlayer/track=${id}${EMBED_SUFFIX}`;
}

function isBandcampEmbedUrl(url) {
  return typeof url === 'string' && EMBED_URL.test(url);
}

function isBandcampTrackPage(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && !parsed.username && !parsed.password
      && /^[a-z0-9-]+\.bandcamp\.com$/i.test(parsed.hostname)
      && /^\/track\/[^/]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

const samePage = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname.toLowerCase() === y.hostname.toLowerCase()
      && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
};

async function trackIdFromSearch(pageUrl, fetchFn) {
  const { hostname, pathname } = new URL(pageUrl);
  const slug = pathname.replace(/\/$/, '').split('/').pop();
  const query = `${hostname.replace('.bandcamp.com', '').replace(/-/g, ' ')} ${slug.replace(/-\d+$/, '').replace(/-/g, ' ')}`;
  const response = await fetchFn(
    `${EMBED_ORIGIN}/api/fuzzysearch/1/app_autocomplete?q=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': UA } }
  );
  if (!response.ok) return null;
  const data = await response.json();
  // app_autocomplete can double the URL ("https://x.bandcamp.comhttps://x.bandcamp.com/track/y").
  const lastUrl = (u) => (typeof u === 'string' ? u.slice(Math.max(0, u.lastIndexOf('https://'))) : '');
  const match = (data.results || []).find((r) => r && samePage(lastUrl(r.url), pageUrl));
  return match ? match.id : null;
}

async function trackIdFromPage(pageUrl, fetchFn) {
  const response = await fetchFn(pageUrl, { headers: { 'User-Agent': UA } });
  if (!response.ok) return null;
  const html = await response.text();
  const found = html.match(/data-tralbum="([^"]*)"/);
  if (!found) return null;
  const decoded = found[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const { current } = JSON.parse(decoded);
  return current && current.type !== 'album' ? current.id : null;
}

// The embed URL for a track's source record, or null when there isn't one to
// be had. A miss is not an error: the caller treats the track as unplayable.
async function resolveBandcampEmbedUrl(source, { fetch: fetchFn, log = console } = {}) {
  const direct = bandcampEmbedUrl(source && source.bandcampTrackId);
  if (direct) return direct;
  const pageUrl = source && source.bandcampUrl;
  if (!isBandcampTrackPage(pageUrl)) return null;
  for (const lookup of [trackIdFromSearch, trackIdFromPage]) {
    try {
      const url = bandcampEmbedUrl(await lookup(pageUrl, fetchFn));
      if (url) return url;
    } catch (err) {
      log.log('[Bandcamp] Could not find this track\'s id:', err && err.message);
    }
  }
  return null;
}

module.exports = { bandcampEmbedUrl, isBandcampEmbedUrl, isBandcampTrackPage, resolveBandcampEmbedUrl };
