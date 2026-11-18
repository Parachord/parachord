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
  concerts: 'Concerts',
  scrobbling: 'Scrobbling',
  status: 'Status',
  // Labelled in the plug-in settings audit (#1498): these showed as their
  // spelled-out code names.
  artistImage: 'Artist photos',
  artistImages: 'Artist photos',
  biography: 'Biographies',
  historyMixes: 'History mixes',
  similarUsers: 'Similar listeners',
  listeningHistory: 'Listening history',
  lovedTracks: 'Loved tracks',
  playlistSync: 'Playlist sync',
  // Brings your saved music and playlists into the Collection (Spotify,
  // Apple Music): picks the plug-in dialog's library sync section (#1498).
  librarySync: 'Library sync',
};

// Capabilities that describe how a plug-in works inside the app, not
// anything a listener chooses it for. They stay in the manifest (the app
// reads them) and never show as chips: "Widevine", "Html5 stream" and
// "Mobile" meant nothing in a settings dialog (#1498). `local` (#1520) says
// how Local Files plays, which its description already tells.
const HIDDEN = new Set(['playbackTelemetry', 'widevine', 'mobile', 'html5Stream', 'resolvePicks', 'local', 'systemVolume']);

// The capabilities to show for a plug-in, in its manifest's order: the
// declared, enabled ones that aren't hidden.
function visibleCapabilities(capabilities) {
  return Object.entries(capabilities || {}).filter(([cap, on]) => on && !HIDDEN.has(cap)).map(([cap]) => cap);
}

function capabilityLabel(cap) {
  if (LABELS[cap]) return LABELS[cap];
  const words = String(cap || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

module.exports = { capabilityLabel, visibleCapabilities, CAPABILITY_LABELS: LABELS, HIDDEN_CAPABILITIES: HIDDEN };
