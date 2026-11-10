// src/renderer/lib/recommendation-model.js — the pure model behind the
// Recommendations page's sectioned layout.
//
// Plugins with the `recommendations` capability answer getRecommendations with
// sections of typed items (docs/architecture/plugins.md, "Recommendations").
// This module normalizes those answers into one display model:
//
//   - items with a section title keep that title and become their own
//     subsection, in provider order after the generic buckets;
//   - items with no title fall into the GENERIC buckets, one per type
//     (Artists, Songs, Albums, Playlists), which come first in the page;
//   - the generic Artists bucket is also fed by artists DERIVED from the
//     generic songs (the pre-sectioning page's Artists tab);
//   - everything is deduplicated per type so two providers recommending the
//     same thing show it once.
//
// Pure on purpose: loadable under plain Node (globalThis, not window) and
// unit-tested (tests/renderer/recommendation-model.test.js). The renderer
// state and effects live in app.js; the LLM (Shuffleupagus) section shape is
// built here too so the merge treats it like any other provider.

const { trackSlug, slug } = require('./track-slug');

// The generic buckets, in display order. A bucket only appears when it has
// items. Songs and artists interleave across providers, so the order is the
// one thing that is not the input's business.
const GENERIC_BUCKET_ORDER = [
  { type: 'artist', key: 'generic:artist' },
  { type: 'song', key: 'generic:song' },
  { type: 'album', key: 'generic:album' },
  { type: 'playlist', key: 'generic:playlist' }
];

const RECOMMENDATION_TYPES = ['artist', 'album', 'song', 'playlist'];

// The blocklist pick for a recommendation item (recommendation-blocklist.js
// isBlocked shape): an artist item is its artist, a song/album item is its
// artist + title, a playlist is itself.
function blockedItemPick(item) {
  if (!item) return null;
  if (item.type === 'artist') return { artist: item.name };
  if (item.type === 'song' || item.type === 'album') {
    return { artist: item.artist || item.name, title: item.name };
  }
  return null;
}

// Per-type dedupe key: two providers recommending the same thing is one row.
function recommendationItemKey(item) {
  if (!item) return '';
  const norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
  if (item.type === 'song' || item.type === 'album') return `${norm(item.artist)}|${norm(item.name)}`;
  if (item.type === 'playlist') return item.url ? `url:${norm(item.url)}` : `name:${norm(item.name)}`;
  return norm(item.name); // artist
}

// One provider item, normalized. Everything the UI needs is optional except
// the type and a name; songs additionally carry a track-shaped object so they
// resolve through the shared scheduler like every other track list (the track
// id is the trackSlug of artist+title, the id every no-album context uses).
function normalizeRecommendationItem(raw, resolverId) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  if (!RECOMMENDATION_TYPES.includes(type)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const artist = typeof raw.artist === 'string' ? raw.artist.trim() : '';
  const item = {
    type,
    // A song's fallback id is the trackSlug of artist+title — the id every
    // no-album track context keys session state (trackSources, the queue) on,
    // so an unnamed song shares its resolution with the rest of the app.
    id: typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : (type === 'song' ? trackSlug(artist, name) : `${type}:${recommendationItemKey({ type, name, artist })}`),
    name,
    resolverId: resolverId || null
  };
  if (artist && (type === 'song' || type === 'album')) item.artist = artist;
  if (typeof raw.imageUrl === 'string' && raw.imageUrl.trim()) item.imageUrl = raw.imageUrl.trim();
  if (typeof raw.url === 'string' && raw.url.trim()) item.url = raw.url.trim();
  if (typeof raw.reason === 'string' && raw.reason.trim()) item.reason = raw.reason.trim();
  if (type === 'song') {
    if (raw.duration && Number.isFinite(Number(raw.duration))) item.duration = Number(raw.duration);
    // The track object every shared path (resolution scheduler, play, queue)
    // expects. Same id as the item so the two never disagree.
    item.track = {
      id: item.id,
      title: item.name,
      artist: item.artist || '',
      duration: item.duration || null,
      sources: {}
    };
  }
  return item;
}

// One provider's getRecommendations answer, normalized: sections with
// normalized items, empty sections dropped. `raw` is the provider's
// { sections } (a bare array is tolerated). Titles are trimmed; a section
// with no title is the generic-bucket shape.
function normalizeRecommendationSections(raw, { resolverId, resolverName } = {}) {
  const rawSections = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.sections) ? raw.sections : []);
  const sections = [];
  for (const rawSection of rawSections) {
    if (!rawSection || typeof rawSection !== 'object' || !Array.isArray(rawSection.items)) continue;
    const items = [];
    for (const rawItem of rawSection.items) {
      const item = normalizeRecommendationItem(rawItem, resolverId);
      if (item) items.push(item);
    }
    if (items.length === 0) continue;
    const section = { items };
    if (typeof rawSection.id === 'string' && rawSection.id.trim()) section.id = rawSection.id.trim();
    if (typeof rawSection.title === 'string' && rawSection.title.trim()) section.title = rawSection.title.trim();
    if (typeof rawSection.description === 'string' && rawSection.description.trim()) section.description = rawSection.description.trim();
    sections.push(section);
  }
  return { resolverId: resolverId || null, resolverName: resolverName || null, sections };
}

// Artists derived from recommended songs: the unique artist names, in first
// appearance order. The pre-sectioning page showed exactly this set as its
// Artists tab; the generic Artists bucket keeps it when a provider sends
// songs without artist items.
function deriveArtistsFromSongs(items) {
  const seen = new Set();
  const artists = [];
  for (const item of items || []) {
    if (!item || item.type !== 'song' || !item.artist) continue;
    const key = item.artist.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    artists.push({
      type: 'artist',
      id: slug(item.artist),
      name: item.artist,
      derived: true,
      resolverId: item.resolverId || null
    });
  }
  return artists;
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = `${item.type}:${recommendationItemKey(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// A display section. Generic buckets carry bucketType instead of a title; a
// titled section keeps its provider identity so the expand/paginate path can
// reach the right resolver.
function displaySection({ key, title, description, bucketType, resolverId, resolverName, sectionId, canLoadMore, nextCursor, items }) {
  return {
    key,
    title: title || null,
    description: description || null,
    bucketType: bucketType || null,
    resolverId: resolverId || null,
    resolverName: resolverName || null,
    sectionId: sectionId || null,
    canLoadMore: !!canLoadMore,
    nextCursor: nextCursor || null,
    items
  };
}

// The display model: generic buckets first (Artists, Songs, Albums,
// Playlists), then the providers' titled sections in provider order, then the
// Shuffleupagus section.
//
//   providers              normalizeRecommendationSections results, in the
//                          order the page should show them
//   shuffleupagus         the shuffleupagusSection result, or null
//   expandedSections       { [`${resolverId}|${sectionId}`]: { items, nextCursor } } —
//                          items a "load more" already fetched for a titled
//                          section, so a re-merge (the LLM streaming an update)
//                          keeps them and the cursor
//   expandableResolverIds  resolvers that implement expandRecommendationSection;
//                          only their titled sections get canLoadMore
//
// Returns the sections array for the recommendations state.
function buildRecommendationSections({ providers, shuffleupagus, expandedSections, expandableResolverIds } = {}) {
  const generic = { artist: [], song: [], album: [], playlist: [] };
  const titled = [];
  for (const provider of providers || []) {
    for (const section of (provider && provider.sections) || []) {
      const items = section.items || [];
      if (section.title) {
        titled.push({ provider, section, items });
      } else {
        for (const item of items) {
          if (generic[item.type]) generic[item.type].push(item);
        }
      }
    }
  }
  // Derived artists only from the GENERIC songs (a titled mixed section
  // already names its artists explicitly).
  generic.artist.push(...deriveArtistsFromSongs(generic.song));

  const sections = [];
  for (const bucket of GENERIC_BUCKET_ORDER) {
    const items = dedupeItems(generic[bucket.type]);
    if (!items.length) continue;
    sections.push(displaySection({
      key: bucket.key,
      bucketType: bucket.type,
      items
    }));
  }
  const expandable = new Set(expandableResolverIds || []);
  for (const { provider, section, items } of titled) {
    const expansion = (expandedSections || {})[`${provider.resolverId}|${section.id || section.title}`] || null;
    // Items a "load more" fetched arrive raw (the loader hands the plugin's
    // answer through); normalize them with the section's provider identity.
    const extraItems = (expansion && Array.isArray(expansion.items) ? expansion.items : [])
      .map(raw => normalizeRecommendationItem(raw, provider.resolverId))
      .filter(Boolean);
    const merged = extraItems.length
      ? dedupeItems([...items, ...extraItems])
      : dedupeItems(items);
    if (!merged.length) continue;
    sections.push(displaySection({
      key: `${provider.resolverId}:${section.id || section.title}`,
      title: section.title,
      description: section.description,
      resolverId: provider.resolverId,
      resolverName: provider.resolverName,
      sectionId: section.id || null,
      canLoadMore: !!section.id && expandable.has(provider.resolverId) && !(expansion && expansion.exhausted),
      nextCursor: (expansion && expansion.nextCursor) || null,
      items: merged
    }));
  }
  if (shuffleupagus && shuffleupagus.sections.length && shuffleupagus.sections[0].items.length) {
    const section = shuffleupagus.sections[0];
    sections.push(displaySection({
      key: `shuffleupagus:${section.title}`,
      title: section.title,
      description: section.description,
      resolverId: shuffleupagus.resolverId,
      resolverName: shuffleupagus.resolverName,
      items: section.items
    }));
  }
  return sections;
}

// The Shuffleupagus (LLM) provider: its albums and artists (from
// loadAiRecommendations / the cache_ai_suggestions store key) become one
// titled section so the reasons and the AI identity stay visible. `albums` is
// [{ title, artist, reason, art }], `artists` [{ name, reason, image }].
function shuffleupagusSection({ albums, artists } = {}) {
  const items = [];
  for (const album of albums || []) {
    if (!album || !album.title || !album.artist) continue;
    items.push({
      type: 'album',
      id: `shuffleupagus:album:${trackSlug(album.artist, album.title)}`,
      name: album.title,
      artist: album.artist,
      reason: album.reason || null,
      imageUrl: album.art || null,
      resolverId: 'shuffleupagus'
    });
  }
  for (const artist of artists || []) {
    if (!artist || !artist.name) continue;
    items.push({
      type: 'artist',
      id: `shuffleupagus:artist:${slug(artist.name)}`,
      name: artist.name,
      reason: artist.reason || null,
      imageUrl: artist.image || null,
      resolverId: 'shuffleupagus'
    });
  }
  if (!items.length) return null;
  return {
    resolverId: 'shuffleupagus',
    resolverName: 'Shuffleupagus',
    sections: [{
      title: 'Shuffleupagus',
      items
    }]
  };
}

module.exports = {
  GENERIC_BUCKET_ORDER,
  RECOMMENDATION_TYPES,
  blockedItemPick,
  normalizeRecommendationItem,
  normalizeRecommendationSections,
  deriveArtistsFromSongs,
  recommendationItemKey,
  dedupeItems,
  buildRecommendationSections,
  shuffleupagusSection
};
