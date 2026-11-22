// src/renderer/lib/playback-quality-line.js: how each music plug-in's
// playback quality is set (#1608), for the "Playback quality" line in its
// settings dialog and the Playback Quality section's sentence in Settings ›
// General, from one rule.
//
// Playback Quality is one global setting. A plug-in either follows it or has
// its quality set somewhere else, and its dialog says which. The rule reads
// capabilities, the plug-in's own manifest and what the host plays it with,
// never its id (CLAUDE.md "Route by the plugin registry"):
//
//   - follows, with every option: a Widevine plug-in that supplies its own
//     manifest and licence (capabilities.widevine with getPlaybackManifest
//     and relayLicense; the shared player applies the tier, the connection
//     option and the Atmos preference, lib/widevine-quality.js);
//   - the plug-in's own word, settings.playbackQuality in its manifest:
//       { "follows": true }  it follows the tier (Apple Music on MusicKit JS:
//                            Data saver is its lower bitrate, every other
//                            level its best, musickit-web.js setQuality)
//       { "nativeApp": "…" } what to say instead when the host plays it with
//                            the service's own app (hostPlayback[id].nativeApp:
//                            Apple Music through the macOS helper)
//       { "summary": "…" }   where its quality is set (Spotify: its app)
//   - an html5Stream plug-in (Subsonic, Plex): its server sets it;
//   - an embedPlayer plug-in (SoundCloud, Bandcamp): its player sets it;
//   - a local plug-in: it plays the file as it is.
// Any other plug-in shows no line.
//
// Mobile has the same rule (parachord-mobile PlaybackQualityLine.kt, #774).

// The tiers in the dialog's words (Settings' own labels, as one phrase).
const TIER_SUMMARY = {
  max: 'Max: best available, lossless where playable',
  high: 'High: up to 500 kbps',
  standard: 'Standard: up to 200 kbps',
  saver: 'Data saver: up to 100 kbps',
};
const ADJUST_SUFFIX = ' · Adjust to your connection';
const ATMOS_SUFFIX = ' · Dolby Atmos when available';

const settingsOf = (plugin) => (plugin && plugin.settings) || {};
const declaredOf = (plugin) => {
  const declared = settingsOf(plugin).playbackQuality;
  return declared && typeof declared === 'object' && !Array.isArray(declared) ? declared : null;
};

// The shared Widevine player plays it, so every Playback Quality option applies.
function followsWidevine(plugin) {
  return !!(plugin && plugin.capabilities && plugin.capabilities.widevine === true
    && typeof plugin.getPlaybackManifest === 'function'
    && typeof plugin.relayLicense === 'function');
}

// A plug-in that plays music: one with a resolve capability.
const isMusicPlugin = (plugin) => !!(plugin && plugin.type !== 'meta-service' && plugin.capabilities && plugin.capabilities.resolve);

// The line for `plugin`, or null when it shows none: { follows, summary }.
// `settings` is the Playback Quality setting ({ quality, abr, spatial });
// `host` is what the app plays it with (hostPlayback[plugin.id]).
function playbackQualityLine(plugin, settings = {}, host = {}) {
  if (!isMusicPlugin(plugin)) return null;
  const tier = TIER_SUMMARY[settings.quality] || TIER_SUMMARY.max;
  if (followsWidevine(plugin)) {
    let summary = `Follows Playback Quality: ${tier}`;
    if (settings.abr) summary += ADJUST_SUFFIX;
    if (settings.spatial) summary += ATMOS_SUFFIX;
    return { follows: true, summary };
  }
  const declared = declaredOf(plugin);
  if (declared) {
    if (host && host.nativeApp && typeof declared.nativeApp === 'string') return { follows: false, summary: declared.nativeApp };
    if (declared.follows === true) return { follows: true, summary: `Follows Playback Quality: ${tier}` };
    if (typeof declared.summary === 'string') return { follows: false, summary: declared.summary };
  }
  const caps = plugin.capabilities;
  if (caps.html5Stream) return { follows: false, summary: 'Set by your server' };
  if (caps.embedPlayer) return { follows: false, summary: 'Set by its player' };
  if (caps.local) return { follows: false, summary: 'Plays the file as it is' };
  return null;
}

// "A", "A and B", "A, B and C".
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// The Playback Quality section's copy, from the plug-ins installed:
// { description, adjustPrefix, atmosPrefix }. The connection and Atmos
// options reach only the Widevine plug-ins.
function playbackQualityCopy(plugins, hostPlayback = {}) {
  const music = (plugins || []).filter(isMusicPlugin);
  const names = (list) => [...new Set(list.map((p) => p.name))].sort((a, b) => a.localeCompare(b));
  const follows = names(music.filter((p) => {
    const line = playbackQualityLine(p, {}, hostPlayback[p.id]);
    return line && line.follows;
  }));
  const widevine = names(music.filter(followsWidevine));
  const description = follows.length === 0
    ? 'None of your plug-ins use these settings yet. Services choose their own quality.'
    : `${joinNames(follows)} ${follows.length === 1 ? 'uses' : 'use'} these settings. Other services choose their own quality.`;
  const prefix = widevine.length === 0 ? 'None of your plug-ins use this yet.' : `${joinNames(widevine)} only.`;
  return { description, adjustPrefix: prefix, atmosPrefix: prefix };
}

module.exports = {
  TIER_SUMMARY,
  followsWidevine,
  playbackQualityLine,
  playbackQualityCopy,
  joinNames,
};
