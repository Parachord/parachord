// src/renderer/lib/plugin-search.js — the Settings › Plug-ins search filter.
//
// A plug-in's name matches the query anywhere (case-insensitive substring), but
// its description matches only where a word starts with the query. A plain
// substring match on descriptions listed Bandcamp for "cha" because its
// description says "purchase".

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

function pluginMatchesQuery(plugin, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const name = String((plugin && plugin.name) || '').toLowerCase();
  if (name.includes(q)) return true;
  const description = String((plugin && plugin.description) || '').toLowerCase();
  if (!description) return false;
  const queryWords = q.split(WORD_SPLIT).filter(Boolean);
  if (queryWords.length === 0) return false;
  const descWords = description.split(WORD_SPLIT).filter(Boolean);
  // Every word of the query must start some word of the description.
  return queryWords.every((qw) => descWords.some((dw) => dw.startsWith(qw)));
}

module.exports = { pluginMatchesQuery };
