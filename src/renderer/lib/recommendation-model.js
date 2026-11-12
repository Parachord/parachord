// src/renderer/lib/recommendation-model.js — the pure model behind the
// Recommendations page's grouped layout.
//
// Plugins with the `recommendations` capability answer getRecommendations with
// sections of typed items (docs/architecture/plugins.md, "Recommendations").
// This module normalizes those answers into one display model: five sections
// by item type (Songs, Albums, Artists, Playlists, Friends), each ONE row
// (a subsection, kept as a one-element list so every reader walks the same
// shape):
//
//   - a type's row (key type:<type>) blends every provider's items of that
//     type, untitled and titled sections alike, interleaved round-robin by
//     provider with Shuffleupagus last and deduplicated per type; each merged
//     item records every provider that sent it in `sourceIds` so the page can
//     filter by source. A provider's section titles are not shown;
//   - weekly playlists (items carrying `weekly`) lead Playlists, Exploration
//     before Jams;
//   - Friends is one blended row built from the providers' similar users.
//
// Filtering is NOT done here: filterRowBySource is applied at render so
// picking a source never re-merges or refetches.
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
  if (item.type === 'playlist') {
    if (item.url) return `url:${norm(item.url)}`;
    // Weekly playlists have no URL and their names repeat ("This Week" is
    // both Exploration's and Jams' current week): their own id is the key.
    if (item.weekly && item.weekly.id) return `weekly:${item.weekly.id}`;
    return `name:${norm(item.name)}`;
  }
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
// owned list per input list (so the caller can interleave them). The key
// carries the type, as dedupeItems' does: a mixed titled section can hold an
// album and its same-named title track, and both must survive.
function mergeOwned(lists) {
  const kept = new Map();
  return lists.map((list) => {
    const owned = [];
    for (const item of list) {
      const key = `${item.type}:${recommendationItemKey(item)}`;
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
    pageable: fields.pageable || [],
    items: fields.items
  };
}

// The providers with at least one item in `items`'s sourceIds, in `order`.
function sourcesFor(items, order, names) {
  const present = new Set();
  for (const item of items) for (const id of item.sourceIds || []) present.add(id);
  return order.filter(id => present.has(id)).map(id => ({ id, name: names[id] || id }));
}

// The page: five sections by type, each ONE blended row (key type:<type>)
// of every provider's items of that type, per the header comment.
//
//   providers              normalizeRecommendationSections results, in the
//                          order the page should show them
//   shuffleupagus          the shuffleupagusSection result, or null
//   expandedSections       { [pagingKey]: { items, nextCursor, exhausted } } —
//                          items a "load more" already fetched for a provider
//                          section, so a re-merge keeps them and the cursor
//   expandableResolverIds  resolvers that implement expandRecommendationSection;
//                          only their titled sections with an id page on
//   similarUsers is
//   [{ resolverId, resolverName, users: [{ username, similarity, avatarUrl? }] }];
//   exclude is { friendKeys, selfKeys }, Sets of `service:username-lowercased`.
//
// A row's `pageable` lists the provider sections that can still page items
// of its type ({ resolverId, resolverName, sectionId, title, pagingKey,
// nextCursor }); opening the row pages each of them. Paged items append
// AFTER the blended first pages, in provider order, so a page landing never
// moves a card already on screen.
function buildRecommendationPage({ providers, shuffleupagus, expandedSections, expandableResolverIds, similarUsers, exclude } = {}) {
  const names = {};
  const order = [];
  const addProvider = (id, name) => {
    if (!id || order.includes(id)) return;
    order.push(id);
    names[id] = name || id;
  };
  const emptyByType = () => ({ artist: [], song: [], album: [], playlist: [] });

  // Per provider (in order): its items by type, untitled first and then its
  // titled sections in order; the items its sections' extra pages brought;
  // and the sections that can page on. Derived artists come from THAT
  // provider's untitled songs and keep it as their source.
  const base = []; // [{ id, byType }]
  const extra = []; // [{ id, byType }]
  const pageable = emptyByType();
  const expandable = new Set(expandableResolverIds || []);

  for (const provider of providers || []) {
    if (!provider) continue;
    addProvider(provider.resolverId, provider.resolverName);
    const byType = emptyByType();
    const extraByType = emptyByType();
    const untitledSongs = [];
    for (const section of provider.sections || []) {
      const items = section.items || [];
      for (const item of items) if (byType[item.type]) byType[item.type].push(item);
      if (!section.title) {
        for (const item of items) if (item.type === 'song') untitledSongs.push(item);
        continue;
      }
      const pagingId = section.id || section.title;
      const pagingKey = `${provider.resolverId}|${pagingId}`;
      const expansion = (expandedSections || {})[pagingKey] || null;
      // Items a "load more" fetched arrive raw; normalize them with the
      // section's provider identity.
      const fetched = (expansion && Array.isArray(expansion.items) ? expansion.items : [])
        .map(raw => normalizeRecommendationItem(raw, provider.resolverId))
        .filter(Boolean);
      for (const item of fetched) if (extraByType[item.type]) extraByType[item.type].push(item);
      if (!section.id || !expandable.has(provider.resolverId) || (expansion && expansion.exhausted)) continue;
      const types = new Set([...items, ...fetched].map(i => i.type));
      for (const type of types) {
        if (!pageable[type]) continue;
        pageable[type].push({
          resolverId: provider.resolverId,
          resolverName: provider.resolverName || provider.resolverId,
          sectionId: section.id,
          title: section.title,
          pagingKey,
          nextCursor: (expansion && expansion.nextCursor) || section.nextCursor || null
        });
      }
    }
    byType.artist.push(...deriveArtistsFromSongs(untitledSongs));
    base.push({ id: provider.resolverId, byType });
    extra.push({ id: provider.resolverId, byType: extraByType });
  }

  if (shuffleupagus && Array.isArray(shuffleupagus.sections)) {
    addProvider(shuffleupagus.resolverId, shuffleupagus.resolverName);
    const byType = emptyByType();
    for (const section of shuffleupagus.sections) {
      for (const item of section.items || []) if (byType[item.type]) byType[item.type].push(item);
    }
    base.push({ id: shuffleupagus.resolverId, byType });
  }

  const page = [];
  for (const { type, title } of TYPE_SECTIONS) {
    let row = null;
    if (type === 'friend') {
      row = friendsRow(similarUsers, exclude);
    } else {
      // One dedupe across the first pages and the extra pages, so a paged
      // item a first page already showed stays where it is.
      const owned = mergeOwned([...base.map(p => p.byType[type]), ...extra.map(p => p.byType[type])]);
      let items = [...interleave(owned.slice(0, base.length)), ...owned.slice(base.length).flat()];
      if (type === 'playlist') {
        // Weekly playlists lead Playlists (recognized by the field their items
        // carry, not by provider), Exploration before Jams; the rest keep
        // their blended order.
        const rank = (item) => (item.weekly ? (WEEKLY_RANK[item.weekly.contextType] ?? 2) : 3);
        items = items.map((item, i) => ({ item, i }))
          .sort((a, b) => (rank(a.item) - rank(b.item)) || (a.i - b.i))
          .map(x => x.item);
      }
      if (items.length) {
        const sources = sourcesFor(items, order, names);
        row = subsection({
          key: `type:${type}`, type, title, blended: sources.length > 1, sources, items
        });
        row.pageable = pageable[type];
        row.canLoadMore = row.pageable.length > 0;
      }
    }
    if (row) page.push({ type, title, subsections: [row] });
  }
  return page;
}

// Friends: one blended "Listen like you" row. Same name on two services stays
// two entries (not known to be the same person); followed, removed and self
// accounts are dropped by key.
// The services a friend can be followed on (addFriendCore looks a username up
// on exactly these). A similar-users provider's id is the friend `service` it
// speaks for, so the Friends row takes only providers whose id is one of
// these: a future third similarUsers plugin must not make Follow look the
// same name up somewhere else. The one deliberate service-name list in the
// recommendations code, mirroring addFriendCore.
const FRIEND_SERVICES = ['lastfm', 'listenbrainz'];

function friendsRow(similarUsers, exclude) {
  const friendKeys = (exclude && exclude.friendKeys) || new Set();
  const selfKeys = (exclude && exclude.selfKeys) || new Set();
  const lists = [];
  const order = [];
  const names = {};
  for (const provider of similarUsers || []) {
    if (!provider || !FRIEND_SERVICES.includes(provider.resolverId)) continue;
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
    key: 'friends:similar', type: 'friend', title: 'Friends', blended: sources.length > 1, sources, items
  });
}

// The page's source filter (the filter bar under the hero, one pick for the
// whole page, like the other tabs' pills). `sourceId` null / 'all' keeps
// everything; otherwise a row keeps the items that source sent, so an artist
// Shuffleupagus and ListenBrainz both picked shows under either. Pure: never
// touches the row.
function filterRowBySource(sub, sourceId) {
  const items = (sub && sub.items) || [];
  if (!sourceId || sourceId === 'all') return items;
  return items.filter(item => (item.sourceIds || []).includes(sourceId));
}

// The filter bar's pills: every source on the page, in page order (a
// source's first appearance), with how many items it sent across the page.
function pageSources(sections) {
  const out = [];
  const byId = new Map();
  for (const section of sections || []) {
    for (const sub of section.subsections || []) {
      for (const src of sub.sources || []) {
        if (!byId.has(src.id)) { const entry = { id: src.id, name: src.name, count: 0 }; byId.set(src.id, entry); out.push(entry); }
      }
      for (const item of sub.items || []) {
        for (const id of item.sourceIds || []) if (byId.has(id)) byId.get(id).count++;
      }
    }
  }
  return out;
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
        // The row is blended: the curator is the item's own source.
        const source = (sub.sources || []).find(src => src.id === item.resolverId);
        const curator = (source && source.name) || item.resolverId || 'your service';
        const description = `${WEEKLY_DESCRIPTIONS[w.contextType]}, curated by ${curator}`;
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
  filterRowBySource,
  pageSources,
  flattenRecommendationItems,
  weeklyHomeEntries,
  shuffleupagusSection,
  FRIEND_SERVICES
};
