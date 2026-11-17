// src/renderer/lib/capability-labels.js: a plug-in capability's name in UI
// text (Settings › Plug-Ins and the marketplace show a plug-in's
// capabilities as pills).
//
// Two copies of the map had drifted, in Title Case, and a capability neither
// knew showed its id ("albumSearch", "embedPlayer"). Ids never appear in UI
// text: an unknown one is spelled out from its camelCase ("Album search").
// Loads under plain Node.

const LABELS = {
  resolve: 'Resolve',
  search: 'Search',
  albumSearch: 'Album search',
  stream: 'Stream',
  browse: 'Browse',
  urlLookup: 'Link lookup',
  purchase: 'Purchase downloads',
  recommendations: 'Recommendations',
  metadata: 'Metadata',
  generate: 'AI playlists',
  chat: 'Conversational DJ',
  embedPlayer: 'Embedded player',
  resolvePicks: 'Picks resolution',
  concerts: 'Concerts',
  scrobbling: 'Scrobbling',
  status: 'Status',
};

function capabilityLabel(cap) {
  if (LABELS[cap]) return LABELS[cap];
  const words = String(cap || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

module.exports = { capabilityLabel, CAPABILITY_LABELS: LABELS };
