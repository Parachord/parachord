// src/renderer/lib/similar-music.js: similar artists and tracks from every
// plug-in that can name them (#1539).
//
// Related Artists (the artist page) and Spinoff used to call Last.fm, and
// ListenBrainz's labs API, by name from app.js and spinoff-pool.js. Now a
// plug-in declares capabilities.similarArtists / similarTracks and implements
// getSimilarArtists / getSimilarTracks (resolver-loader.js), and the app asks
// all of them, in the user's order, and merges what comes back. A plug-in that
// fails is left out; the answer counts as failed only when none answered, so
// one service's outage no longer empties the page or reads as "none".
//
// Which plug-ins: every one with the capability that is in the active list or
// is a meta-service, as for Recommendations (recommendationProviders in
// app.js), minus one the user switched off (its Enable switch, `enabled:
// false` in meta_service_configs). Last.fm and ListenBrainz need no sign-in to
// answer, so a plug-in that was never set up is still asked, as before.
//
// An artist's top tracks (capabilities.artistTopTracks, #1539 step 2) come
// from the same plug-ins by the same rule, but are never merged: each list is
// ranked by its own service's play counts, so the first plug-in in the user's
// order with a non-empty list wins (firstAnswer).
//
// An artist's releases (capabilities.artistReleases, #1539 step 2) fill the
// artist page when MusicBrainz is slow or doesn't know the artist. They are
// asked one at a time, in the same order, until one finds the artist
// (askInTurn): this is a fallback, and asking four services at once on every
// slow page load would spend their rate limits for nothing.
//
// An artist's bio (capabilities.biography, #1539 step 6) comes from the same
// plug-ins by the same rule, all asked at once (askEach): the Biography tab
// offers every bio found, and shows the first in the user's order
// (lib/artist-bio.js, bioWithSources).
//
// Pure; loads under plain Node.

'use strict';

const { orderCatalogResolvers } = require('./album-catalog');
const { normalizeStr } = require('../../../sync-providers/confidence-scoring');

const LOADER_LIST = {
  similarArtists: 'getSimilarArtistsResolvers',
  similarTracks: 'getSimilarTracksResolvers',
  artistTopTracks: 'getArtistTopTracksResolvers',
  artistReleases: 'getArtistReleasesResolvers',
  listeningHistory: 'getListeningHistoryResolvers',
  biography: 'getBiographyResolvers',
  friends: 'getFriendsResolvers',
};

// The plug-ins to ask for one capability, in the user's order.
function similarProviders(loader, capability, { activeIds = [], order = [], metaIds = [], isOff = () => false } = {}) {
  const list = LOADER_LIST[capability];
  if (!loader || !list || typeof loader[list] !== 'function') return [];
  const meta = new Set(metaIds);
  const candidates = loader[list]()
    .filter((r) => activeIds.includes(r.id) || meta.has(r.id))
    .filter((r) => !isOff(r.id));
  return orderCatalogResolvers(candidates, { activeIds, order });
}

// Ask every provider at once. Resolves to { answers: [{ id, items }], failed }:
// `answers` in the providers' order, one per provider that answered (an empty
// list counts as an answer); `failed` when there was no provider to ask or
// none of them answered, so the caller can say so rather than "none found".
async function askEach(providers, ask) {
  const list = providers || [];
  const settled = await Promise.allSettled(list.map((p) => Promise.resolve().then(() => ask(p))));
  const answers = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') answers.push({ id: list[i].id, items: Array.isArray(s.value) ? s.value : [] });
  });
  return { answers, failed: answers.length === 0 };
}

// The first answer with any items, in the providers' order: { id, items },
// or null when every plug-in that answered had none.
function firstAnswer(answers) {
  return (answers || []).find((a) => a && Array.isArray(a.items) && a.items.length > 0) || null;
}

// Ask providers one at a time, in order. A provider that throws is skipped;
// null or undefined is "not found". Resolves to:
//   answer:  { id, value } for the first value `accept` takes, or null;
//   first:   { id, value } for the first value found before that (one
//            `accept` turned down), so a caller can settle for it;
//   stopped: `stop()` said to give up (checked before each ask);
//   failed:  nobody to ask, or every provider asked threw.
async function askInTurn(providers, ask, { accept = (v) => v != null, stop = () => false } = {}) {
  let first = null;
  let asked = 0;
  let failures = 0;
  for (const p of providers || []) {
    if (stop()) return { answer: null, first, stopped: true, failed: false };
    asked++;
    let value;
    try {
      value = await ask(p);
    } catch (_e) {
      failures++;
      continue;
    }
    if (value == null) continue;
    if (accept(value)) return { answer: { id: p.id, value }, first, stopped: false, failed: false };
    if (!first) first = { id: p.id, value };
  }
  return { answer: null, first, stopped: false, failed: asked === 0 || failures === asked };
}

const artistKey = (name) => String(name || '').toLowerCase().trim();

// One entry per artist name: { name, mbid?, url?, match, sources: [ids] },
// match the highest any provider gave, sources in the providers' order.
function mergeSimilarArtists(answers) {
  const byKey = new Map();
  for (const { id, items } of answers || []) {
    for (const a of items || []) {
      if (!a || typeof a.name !== 'string' || !a.name.trim()) continue;
      const key = artistKey(a.name);
      const match = Number.isFinite(Number(a.match)) ? Number(a.match) : 0;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { name: a.name, mbid: a.mbid || undefined, url: a.url || undefined, match, sources: [id] });
        continue;
      }
      existing.match = Math.max(existing.match, match);
      if (!existing.mbid && a.mbid) existing.mbid = a.mbid;
      if (!existing.url && a.url) existing.url = a.url;
      if (!existing.sources.includes(id)) existing.sources.push(id);
    }
  }
  return [...byKey.values()];
}

const trackKey = (artist, title) => {
  const a = normalizeStr(artist) || String(artist || '').trim().toLowerCase();
  const t = normalizeStr(title) || String(title || '').trim().toLowerCase();
  return `${a}|${t}`;
};

// One entry per track: { artist, title, mbid?, match, sources: [ids] }.
function mergeSimilarTracks(answers) {
  const byKey = new Map();
  for (const { id, items } of answers || []) {
    for (const t of items || []) {
      if (!t || typeof t.artist !== 'string' || typeof t.title !== 'string' || !t.title.trim()) continue;
      const key = trackKey(t.artist, t.title);
      const match = Number.isFinite(Number(t.match)) ? Number(t.match) : 0;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { artist: t.artist, title: t.title, mbid: t.mbid || undefined, match, sources: [id] });
        continue;
      }
      existing.match = Math.max(existing.match, match);
      if (!existing.mbid && t.mbid) existing.mbid = t.mbid;
      if (!existing.sources.includes(id)) existing.sources.push(id);
    }
  }
  return [...byKey.values()];
}

// The plug-ins whose answers fill a merged list, in the order they first
// appear: the Related Artists filter chips.
function sourcesIn(items) {
  const ids = [];
  for (const item of items || []) {
    for (const id of item.sources || []) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

module.exports = {
  similarProviders,
  askEach,
  askInTurn,
  firstAnswer,
  mergeSimilarArtists,
  mergeSimilarTracks,
  sourcesIn,
  trackKey,
};
