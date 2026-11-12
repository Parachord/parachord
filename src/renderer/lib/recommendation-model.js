// src/renderer/lib/recommendation-model.js — the pure model behind the
// Recommendations page's grouped layout.
//
// Plugins with the `recommendations` capability answer getRecommendations with
// sections of typed items (docs/architecture/plugins.md, "Recommendations").
// This module normalizes those answers into one display model: five sections
// by item type (Songs, Albums, Artists, Playlists, Friends), each holding
// subsections (rows):
//
//   - "For you" (key foryou:<type>) blends every provider's untitled items of
//     that type, interleaved round-robin by provider with Shuffleupagus last,
//     deduplicated per type; each merged item records every provider that sent
//     it in `sourceIds` so the page can filter by source;
//   - a provider's titled section becomes one subsection per item type it
//     holds, all sharing one `pagingKey` so "load more" stays per section;
//   - weekly playlist rows (items carrying `weekly`) lead Playlists' titled
//     rows, Exploration before Jams;
//   - Friends is one blended row built from the providers' similar users.
//
// Filtering is NOT done here: filterSubsectionItems is applied at render so
// toggling a source never re-merges or refetches.
//
// Pure on purpose: loadable under plain Node (globalThis, not window) and
// unit-tested (tests/renderer/recommendation-model.test.js). The renderer
// state and effects live in app.js; the LLM (Shuffleupagus) section shape is
// built here too so the merge treats it like any other provider.

const { trackSlug, slug } = require('./track-slug');

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
  // Optional stable ids a provider already knows — a song's recording MBID
  // (ListenBrainz), an ISRC where a provider has one. Carried on the item and
  // copied onto the track, so MBID enrichment doesn't re-ask the mapper and
  // pickTrackMatch's exact-MBID tier can fire without a lookup.
  if (typeof raw.mbid === 'string' && raw.mbid.trim()) item.mbid = raw.mbid.trim();
  if (typeof raw.isrc === 'string' && raw.isrc.trim()) item.isrc = raw.isrc.trim();
  // A weekly playlist (ListenBrainz Weekly Jams / Exploration) carries what the
  // existing weekly path needs to open and play it. Recognized by this field,
  // never by provider name; a malformed value is dropped, not half-kept.
  const w = raw.weekly;
  if (type === 'playlist' && w && typeof w === 'object'
    && typeof w.id === 'string' && w.id
    && (w.contextType === 'weekly-jam' || w.contextType === 'weekly-exploration')
    && typeof w.label === 'string' && typeof w.weekLabel === 'string') {
    item.weekly = { id: w.id, contextType: w.contextType, label: w.label, weekLabel: w.weekLabel };
    if (typeof w.date === 'string') item.weekly.date = w.date;
  }
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
    if (item.mbid) item.track.mbid = item.mbid;
    if (item.isrc) item.track.isrc = item.isrc;
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
    // A provider that pre-fetches a section's first page (Amazon's synthesized
    // "Playlists for You") carries its continuation cursor on the section, so
    // the page's first "Load more" starts from it.
    if (rawSection.nextCursor != null && typeof rawSection.nextCursor !== 'object') section.nextCursor = String(rawSection.nextCursor);
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

const TYPE_SECTIONS = [
  { type: 'song', title: 'Songs' },
  { type: 'album', title: 'Albums' },
  { type: 'artist', title: 'Artists' },
  { type: 'playlist', title: 'Playlists' },
  { type: 'friend', title: 'Friends' }
];

const WEEKLY_RANK = { 'weekly-exploration': 0, 'weekly-jam': 1 };

// Dedupe several providers' lists of ONE type: the first provider in priority
// order owns an item's position and fields; later providers sending the same
// thing add their id to sourceIds. A later Shuffleupagus reason is copied when
// the kept item has none, so the AI's "why" survives the merge. Returns one
// owned list per input list (so the caller can interleave them).
function mergeOwned(lists) {
  const kept = new Map();
  return lists.map((list) => {
    const owned = [];
    for (const item of list) {
      const key = recommendationItemKey(item);
      const existing = kept.get(key);
      if (!existing) {
        const copy = { ...item, sourceIds: [item.resolverId] };
        kept.set(key, copy);
        owned.push(copy);
        continue;
      }
      if (item.resolverId && !existing.sourceIds.includes(item.resolverId)) existing.sourceIds.push(item.resolverId);
      if (!existing.reason && item.reason && item.resolverId === 'shuffleupagus') existing.reason = item.reason;
    }
    return owned;
  });
}

// One item per list per round, in list order.
function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

function subsection(fields) {
  return {
    key: fields.key,
    type: fields.type,
    title: fields.title || null,
    description: fields.description || null,
    blended: !!fields.blended,
    sources: fields.sources || [],
    resolverId: fields.resolverId || null,
    resolverName: fields.resolverName || null,
    sectionId: fields.sectionId || null,
    pagingKey: fields.pagingKey || null,
    canLoadMore: !!fields.canLoadMore,
    nextCursor: fields.nextCursor || null,
    items: fields.items
  };
}

// The providers with at least one item in `items`'s sourceIds, in `order`.
function sourcesFor(items, order, names) {
  const present = new Set();
  for (const item of items) for (const id of item.sourceIds || []) present.add(id);
  return order.filter(id => present.has(id)).map(id => ({ id, name: names[id] || id }));
}

// The grouped page: sections by type, each with For you first, then the
// providers' titled rows, per the header comment.
//
//   providers              normalizeRecommendationSections results, in the
//                          order the page should show them
//   shuffleupagus          the shuffleupagusSection result, or null
//   expandedSections       { [pagingKey]: { items, nextCursor, exhausted } } —
//                          items a "load more" already fetched for a titled
//                          section, so a re-merge keeps them and the cursor
//   expandableResolverIds  resolvers that implement expandRecommendationSection;
//                          only their titled sections get canLoadMore
//   similarUsers is
//   [{ resolverId, resolverName, users: [{ username, similarity, avatarUrl? }] }];
//   exclude is { friendKeys, selfKeys }, Sets of `service:username-lowercased`.
function buildRecommendationPage({ providers, shuffleupagus, expandedSections, expandableResolverIds, similarUsers, exclude } = {}) {
  const names = {};
  const order = [];
  const addProvider = (id, name) => {
    if (!id || order.includes(id)) return;
    order.push(id);
    names[id] = name || id;
  };

  // Per provider (in order), the untitled items by type; derived artists come
  // from THAT provider's untitled songs and keep it as their source.
  const forYou = []; // [{ id, byType }]
  const titledRows = { song: [], album: [], artist: [], playlist: [] };
  const expandable = new Set(expandableResolverIds || []);

  for (const provider of providers || []) {
    if (!provider) continue;
    addProvider(provider.resolverId, provider.resolverName);
    const byType = { artist: [], song: [], album: [], playlist: [] };
    for (const section of provider.sections || []) {
      const items = section.items || [];
      if (!section.title) {
        for (const item of items) if (byType[item.type]) byType[item.type].push(item);
        continue;
      }
      const pagingId = section.id || section.title;
      const expansion = (expandedSections || {})[`${provider.resolverId}|${pagingId}`] || null;
      // Items a "load more" fetched arrive raw; normalize them with the
      // section's provider identity.
      const extra = (expansion && Array.isArray(expansion.items) ? expansion.items : [])
        .map(raw => normalizeRecommendationItem(raw, provider.resolverId))
        .filter(Boolean);
      const merged = mergeOwned([[...items, ...extra]])[0];
      const types = [];
      for (const item of merged) if (!types.includes(item.type)) types.push(item.type);
      for (const type of types) {
        if (!titledRows[type]) continue;
        titledRows[type].push(subsection({
          key: `${provider.resolverId}:${pagingId}:${type}`,
          type,
          title: section.title,
          description: section.description,
          sources: [{ id: provider.resolverId, name: provider.resolverName || provider.resolverId }],
          resolverId: provider.resolverId,
          resolverName: provider.resolverName,
          sectionId: section.id || null,
          pagingKey: `${provider.resolverId}|${pagingId}`,
          canLoadMore: !!section.id && expandable.has(provider.resolverId) && !(expansion && expansion.exhausted),
          nextCursor: (expansion && expansion.nextCursor) || section.nextCursor || null,
          items: merged.filter(item => item.type === type)
        }));
      }
    }
    byType.artist.push(...deriveArtistsFromSongs(byType.song));
    forYou.push({ id: provider.resolverId, byType });
  }

  if (shuffleupagus && Array.isArray(shuffleupagus.sections)) {
    addProvider(shuffleupagus.resolverId, shuffleupagus.resolverName);
    const byType = { artist: [], song: [], album: [], playlist: [] };
    for (const section of shuffleupagus.sections) {
      for (const item of section.items || []) if (byType[item.type]) byType[item.type].push(item);
    }
    forYou.push({ id: shuffleupagus.resolverId, byType });
  }

  const page = [];
  for (const { type, title } of TYPE_SECTIONS) {
    const subsections = [];
    if (type === 'friend') {
      const row = friendsRow(similarUsers, exclude);
      if (row) subsections.push(row);
    } else {
      const items = interleave(mergeOwned(forYou.map(p => p.byType[type])));
      if (items.length) {
        const sources = sourcesFor(items, order, names);
        subsections.push(subsection({
          key: `foryou:${type}`, type, title: 'For you', blended: sources.length > 1, sources, items
        }));
      }
      let rows = titledRows[type];
      if (type === 'playlist') {
        // Weekly rows lead the titled playlists (recognized by the field their
        // items carry, not by provider), Exploration before Jams; the rest
        // keep provider order.
        const weeklyRank = (row) => {
          const w = row.items.find(i => i.weekly);
          return w ? (WEEKLY_RANK[w.weekly.contextType] ?? 2) : -1;
        };
        const weekly = rows.filter(r => weeklyRank(r) >= 0).sort((a, b) => weeklyRank(a) - weeklyRank(b));
        rows = [...weekly, ...rows.filter(r => weeklyRank(r) < 0)];
      }
      subsections.push(...rows);
    }
    if (subsections.length) page.push({ type, title, subsections });
  }
  return page;
}

// Friends: one blended "Listen like you" row. Same name on two services stays
// two entries (not known to be the same person); followed, removed and self
// accounts are dropped by key.
function friendsRow(similarUsers, exclude) {
  const friendKeys = (exclude && exclude.friendKeys) || new Set();
  const selfKeys = (exclude && exclude.selfKeys) || new Set();
  const lists = [];
  const order = [];
  const names = {};
  for (const provider of similarUsers || []) {
    if (!provider || !provider.resolverId) continue;
    const service = provider.resolverId;
    const seen = new Set();
    const list = [];
    for (const user of provider.users || []) {
      const username = user && typeof user.username === 'string' ? user.username.trim() : '';
      if (!username) continue;
      const key = `${service}:${username.toLowerCase()}`;
      if (seen.has(key) || friendKeys.has(key) || selfKeys.has(key)) continue;
      seen.add(key);
      list.push({
        type: 'friend',
        id: `similar:${service}:${username}`,
        name: username,
        service,
        similarity: user.similarity,
        avatarUrl: user.avatarUrl || null,
        resolverId: service,
        sourceIds: [service]
      });
    }
    if (!list.length) continue;
    order.push(service);
    names[service] = provider.resolverName || service;
    lists.push(list);
  }
  const items = interleave(lists);
  if (!items.length) return null;
  const sources = sourcesFor(items, order, names);
  return subsection({
    key: 'friends:similar', type: 'friend', title: 'Listen like you', blended: sources.length > 1, sources, items
  });
}

// The items a row shows under the page's source filters. An item is hidden
// only when EVERY provider that sent it is off, so turning ListenBrainz off
// keeps an artist Shuffleupagus also picked. Pure: never touches the row.
function filterSubsectionItems(sub, offIds) {
  const items = (sub && sub.items) || [];
  if (!offIds || !offIds.size) return items;
  return items.filter(item => {
    const ids = item.sourceIds || [];
    return !ids.length || !ids.every(id => offIds.has(id));
  });
}

// Every subsection's items, in page order (what the resolution scheduler,
// MBID enrichment and the blocklist walk).
function flattenRecommendationItems(sections) {
  return (sections || []).flatMap(s => s.subsections.flatMap(sub => sub.items));
}

// Home's weekly playlist fields (homeData.weeklyJams / weeklyExploration),
// which the playlist view's pendingPlaylistLoad lookup and the weekly covers
// effect still read, built from the page's weekly rows: items carrying
// `weekly` (never recognized by provider). Home's old entry shape; `previous`
// is the current { weeklyJams, weeklyExploration }, and an entry whose week
// is unchanged is reused as is, so tracks a card already loaded survive a
// re-merge, and an unchanged list keeps its identity (the caller can then skip
// the state write). A list with no entries is null, as before it loaded.
const WEEKLY_FIELDS = { 'weekly-jam': 'weeklyJams', 'weekly-exploration': 'weeklyExploration' };
const WEEKLY_DESCRIPTIONS = {
  'weekly-jam': 'Your favorite tracks from the past week',
  'weekly-exploration': 'New discoveries based on your listening habits'
};
function weeklyHomeEntries(sections, previous) {
  const prev = previous || {};
  const prior = new Map();
  for (const field of Object.values(WEEKLY_FIELDS)) {
    for (const entry of prev[field] || []) if (entry && entry.id) prior.set(entry.id, entry);
  }
  const lists = { weeklyJams: [], weeklyExploration: [] };
  const seen = new Set();
  for (const section of sections || []) {
    for (const sub of section.subsections || []) {
      for (const item of sub.items || []) {
        const w = item.weekly;
        const field = w && WEEKLY_FIELDS[w.contextType];
        if (!field || seen.has(w.id)) continue;
        seen.add(w.id);
        const description = `${WEEKLY_DESCRIPTIONS[w.contextType]}, curated by ${sub.resolverName || sub.resolverId || 'your service'}`;
        const old = prior.get(w.id);
        if (old && old.title === w.label && old.weekLabel === w.weekLabel
          && (old.date || null) === (w.date || null) && old.description === description) {
          lists[field].push(old);
          continue;
        }
        lists[field].push({
          id: w.id,
          title: w.label,
          weekLabel: w.weekLabel,
          description,
          date: w.date || null,
          tracks: (old && old.tracks) || [],
          tracksLoaded: !!(old && old.tracksLoaded)
        });
      }
    }
  }
  const out = {};
  for (const field of Object.values(WEEKLY_FIELDS)) {
    const next = lists[field];
    const before = prev[field];
    if (!next.length) out[field] = null;
    else if (Array.isArray(before) && before.length === next.length && before.every((e, i) => e === next[i])) out[field] = before;
    else out[field] = next;
  }
  return out;
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
  TYPE_SECTIONS,
  RECOMMENDATION_TYPES,
  blockedItemPick,
  normalizeRecommendationItem,
  normalizeRecommendationSections,
  deriveArtistsFromSongs,
  recommendationItemKey,
  dedupeItems,
  buildRecommendationPage,
  filterSubsectionItems,
  flattenRecommendationItems,
  weeklyHomeEntries,
  shuffleupagusSection
};
