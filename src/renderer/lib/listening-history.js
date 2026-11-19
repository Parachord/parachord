// src/renderer/lib/listening-history.js: your listening history from every
// plug-in that keeps it (#1539 step 4).
//
// The History page, the AI's listening context and the Fresh Drops and
// Concerts seeds used to call Last.fm's user.* methods and ListenBrainz's
// /stats/user and /listens by name from app.js. Now a plug-in declares
// capabilities.listeningHistory and implements getTopItems and
// getRecentListens (resolver-loader.js); this module is the pure part.
//
// Which plug-ins: those with the capability that are active or meta-services,
// minus one switched off, in the user's order (similarProviders), and of
// those the ones you've signed in to: a username in the plug-in's settings.
// The History page's top lists show one of them (its Source menu); recent
// listens, the listening context and the seeds use them all, merged.
//
// Pure; loads under plain Node.

'use strict';

// The History page's period menu values (lib/history-options.js; Last.fm's
// names, kept because parachord:// links carry them) to the plug-ins'
// periods.
const HISTORY_PERIODS = {
  '7day': 'week',
  '1month': 'month',
  '3month': 'quarter',
  '6month': 'half_year',
  '12month': 'year',
  overall: 'all',
};
const historyPeriodFor = (value) => HISTORY_PERIODS[value] || 'all';

// The sources you're signed in to, from the plug-ins with the capability.
function signedInSources(providers, configs = {}) {
  return (providers || []).filter((r) => !!((configs[r.id] || {}).username));
}

// Recent listens from several sources, newest first, one per song per five
// minutes (two services scrobble the same play a moment apart). `lists` is
// [{ id, items }]; each listen keeps its `source`.
function mergeRecentListens(lists) {
  const all = [];
  for (const { id, items } of lists || []) {
    for (const t of items || []) all.push({ ...t, source: id });
  }
  all.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
  const seen = new Set();
  const out = [];
  for (const t of all) {
    const window = t.playedAt ? Math.floor(t.playedAt / (5 * 60 * 1000)) : 'now';
    const key = `${String(t.artist || '').toLowerCase().trim()}|${String(t.title || '').toLowerCase().trim()}|${window}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// Artist names from several sources' top artists, first spelling kept.
function mergeArtistNames(lists) {
  const seen = new Set();
  const out = [];
  for (const items of lists || []) {
    for (const a of items || []) {
      const name = a && (a.name || a);
      if (typeof name !== 'string' || !name.trim()) continue;
      const key = name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name });
    }
  }
  return out;
}

module.exports = { HISTORY_PERIODS, historyPeriodFor, signedInSources, mergeRecentListens, mergeArtistNames };
