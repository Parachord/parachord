// src/renderer/lib/artist-bio.js — finding an artist's Wikidata entry, and
// remembering artist bios for the session.
//
// The Wikipedia bio and the Wikipedia artist image both start from the
// artist's Wikidata id. That id used to come only from the artist's
// MusicBrainz url-rels, so a MusicBrainz outage took the Wikipedia bio down
// with it: the url-rels request sat in the 1 req/s MusicBrainz queue behind
// every retrying cover-art search, and the Biography tab showed its skeleton
// until it gave up (Wild Pink, 2026-10-25). Wikidata records the MusicBrainz
// artist id itself (property P434), so it is asked first; the MusicBrainz
// url-rels are the fallback for an artist Wikidata has no P434 for.
//
// A bio comes from the plug-ins with capabilities.biography (#1539 step 6):
// all of them are asked at once, and bioWithSources keeps every bio found,
// in the user's order, so the Biography tab can offer each one.
//
// Bios were also fetched from scratch by every caller: the playbar had Wild
// Pink's bio from Wikipedia while the artist page, opened a minute later,
// fetched it again and got nothing.

const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIKIDATA_ID_RE = /^Q\d+$/;

const isMbid = (value) => typeof value === 'string' && MBID_RE.test(value);

// Wikidata's search endpoint with a haswbstatement filter: the entity whose
// "MusicBrainz artist ID" (P434) is this mbid. The mbid is validated first,
// so nothing else reaches the search expression.
function wikidataSearchUrl(mbid) {
  if (!isMbid(mbid)) return null;
  const query = `haswbstatement:P434=${mbid.toLowerCase()}`;
  return `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`;
}

function wikidataIdFromSearch(data) {
  const title = data && data.query && data.query.search && data.query.search[0] && data.query.search[0].title;
  return typeof title === 'string' && WIKIDATA_ID_RE.test(title) ? title : null;
}

// A MusicBrainz artist lookup with inc=url-rels.
function wikidataIdFromMbRelations(mbData) {
  const rel = ((mbData && mbData.relations) || []).find(r => r && r.type === 'wikidata' && r.url && r.url.resource);
  if (!rel) return null;
  const id = String(rel.url.resource).split('/').pop();
  return WIKIDATA_ID_RE.test(id) ? id : null;
}

// fetch: the renderer's fetch (MusicBrainz requests go through its limiter).
// Found ids are kept for the session and concurrent lookups for the same
// artist share one request. A miss is not kept: it may be an outage.
function createWikidataIdLookup({ fetch, userAgent }) {
  const found = new Map();
  const inFlight = new Map();

  const lookupNow = async (mbid) => {
    try {
      const res = await fetch(wikidataSearchUrl(mbid));
      if (res.ok) {
        const id = wikidataIdFromSearch(await res.json());
        if (id) return id;
      }
    } catch (_) {
      // Wikidata unreachable: MusicBrainz may still answer.
    }
    // Background lane: bios and photos are never what the user clicked for
    // (the playbar's bio tooltip used to queue this ahead of page loads).
    const res = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`, {
      headers: { 'User-Agent': userAgent },
      mbBackground: true,
    });
    if (!res.ok) return null;
    return wikidataIdFromMbRelations(await res.json());
  };

  return async function lookupWikidataId(mbid) {
    if (!isMbid(mbid)) return null;
    const key = mbid.toLowerCase();
    if (found.has(key)) return found.get(key);
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = lookupNow(key)
      .then((id) => {
        if (id) found.set(key, id);
        return id;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  };
}

const BIO_TTL_MS = 6 * 60 * 60 * 1000;
const BIO_CACHE_MAX = 300;

const bioKey = (artistName, artistMbid) =>
  `${String(artistName || '').trim().toLowerCase()}|${isMbid(artistMbid) ? artistMbid.toLowerCase() : ''}`;

// Bios found this session, shared by the playbar tooltip and the artist
// page. Keyed by name and mbid together: without an mbid the Wikipedia bio
// is skipped, so a bio fetched without one must not stand in for a request
// that has one. "No bio" is not kept, since it may mean a source was down.
function createArtistBioCache({ now = () => Date.now(), ttlMs = BIO_TTL_MS, maxEntries = BIO_CACHE_MAX } = {}) {
  const entries = new Map();
  const inFlight = new Map();

  return {
    // fetchBio(artistName, artistMbid) resolves to a bio object or null.
    load(artistName, artistMbid, fetchBio) {
      if (!artistName) return Promise.resolve(null);
      const key = bioKey(artistName, artistMbid);
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.bio);
      if (hit) entries.delete(key);
      if (inFlight.has(key)) return inFlight.get(key);
      const pending = Promise.resolve()
        .then(() => fetchBio(artistName, artistMbid))
        .then((bio) => {
          if (bio) {
            entries.set(key, { bio, at: now() });
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
          }
          return bio || null;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
      return pending;
    },
    get size() {
      return entries.size;
    },
  };
}

// askEach's answers (lib/similar-music.js: [{ id, items: [bio] or [] }], in
// the user's order) into the bio the app shows: the first plug-in's bio
// ({ text, summary?, url?, markup?, source: its id }) with `sources`, every
// plug-in's bio in the same order, for the Biography tab's Source menu.
// null when none had one.
function bioWithSources(answers) {
  const sources = (answers || [])
    .filter((a) => a && Array.isArray(a.items) && a.items[0] && typeof a.items[0].text === 'string' && a.items[0].text)
    .map((a) => ({ ...a.items[0], source: a.id }));
  return sources.length ? { ...sources[0], sources } : null;
}

// The bio on screen switched to another of its sources (the Source menu):
// that source's text, url and markup, the same list of sources.
function bioFromSource(bio, sourceId) {
  const pick = bio && Array.isArray(bio.sources) && bio.sources.find((s) => s.source === sourceId);
  return pick ? { ...pick, sources: bio.sources } : bio;
}

// The plug-ins whose bio to show first, best first: the source the user last
// picked in the Biography tab (`pick`, saved as artist_bio_source), then the
// plug-ins whose manifest says `biography: { preferred: true }` (Wikipedia),
// in the order given. resolvers: the biography plug-ins, in the user's order.
function bioPreference(pick, resolvers) {
  const preferred = (resolvers || []).filter((r) => r && r.biography && r.biography.preferred).map((r) => r.id);
  return [...new Set([pick, ...preferred].filter((id) => typeof id === 'string' && id))];
}

// The bio to show: the first plug-in in `prefer` that has a bio for this
// artist, else the bio as it came (the first in the user's order). The cache
// keeps the bio as fetched, so a new pick applies to bios fetched before it.
function preferredBio(bio, prefer) {
  if (!bio || !Array.isArray(bio.sources)) return bio;
  const id = (prefer || []).find((p) => bio.sources.some((s) => s.source === p));
  return id && id !== bio.source ? bioFromSource(bio, id) : bio;
}

module.exports = {
  bioPreference,
  preferredBio,
  bioWithSources,
  bioFromSource,
  isMbid,
  wikidataSearchUrl,
  wikidataIdFromSearch,
  wikidataIdFromMbRelations,
  createWikidataIdLookup,
  createArtistBioCache,
  BIO_TTL_MS,
};
