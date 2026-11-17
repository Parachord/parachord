// src/renderer/lib/plugin-switch.js: the one on/off switch in a plug-in's
// settings dialog (#1498 step 2).
//
// The dialog used to turn a plug-in on with up to three controls: a "Use X"
// switch (music plug-ins), a footer button that said "Enable" or "Done" by a
// rule nobody could see, and an "Enable X" switch in the body (Ollama,
// Custom LLM). This decides, for every plug-in, what the single switch shows.
// It keeps what "on" already meant for each kind of plug-in, so turning it
// on or off changes exactly what the old controls changed:
//
//   music plug-ins (no type):      on = in the active list (activeResolvers)
//   key-gated AI and concert ones: on = has its key and isn't switched off
//                                  (isServiceEnabled / getConcertServices).
//                                  With no key the switch is disabled, and
//                                  says what to add first.
//   no-key AI and concert ones:    on = enabled: true (Ollama, Custom LLM)
//   artist-info only (Wikipedia,   on = not switched off: they need nothing
//   Discogs):                      set up, so the Plug-Ins tile always showed
//                                  them on while this read an old install's
//                                  missing `enabled` as off (2026-11-17)
//   everything else (scrobblers,   on = enabled: true, or set up and not
//   metadata, Achordion):          switched off: the rule the footer button
//                                  used. Never disabled: Last.fm, for one,
//                                  serves artist info before a username.
//
// Pure; loads under plain Node.

'use strict';

const settingsOf = (plugin) => plugin.settings || {};
const configurableOf = (plugin) => settingsOf(plugin).configurable || plugin.configurable || {};

// The setting a plug-in's key lives in: its first configurable field that
// isn't the model (apiKey, appId, clientId, username…), the same field
// getConcertServices checks.
function authFieldOf(plugin) {
  return Object.keys(configurableOf(plugin)).find((k) => k !== 'model') || 'apiKey';
}

function needsKey(plugin) {
  const s = settingsOf(plugin);
  return !(s.requiresAuth === false || plugin.requiresAuth === false);
}

function hasKey(plugin, config) {
  const c = config || {};
  return !!(c[authFieldOf(plugin)] || c.apiKey);
}

// AI and concert plug-ins: the ones isServiceEnabled / getConcertServices gate.
function isGatedService(plugin) {
  const caps = plugin.capabilities || {};
  return !!(caps.chat || caps.generate || caps.concerts);
}

// Artist info and nothing else to set up (Wikipedia, Discogs).
function isArtistInfoOnly(plugin) {
  const caps = plugin.capabilities || {};
  return !!(caps.metadata || caps.biography) && !caps.scrobbling && !caps.recommendations;
}

// What the switch's hint line says when nothing's missing.
function hintFor(plugin) {
  const caps = plugin.capabilities || {};
  if (plugin.type !== 'meta-service') return 'Include it in search';
  if (caps.concerts) return 'Upcoming concerts and ticket links';
  if (caps.chat || caps.generate) return 'Use with Shuffleupagus';
  if (caps.recommendations) return 'Use for recommendations and your history';
  if (caps.scrobbling) return 'Scrobble what you play';
  // What it brings, from its capabilities ("Use for artist info" said
  // nothing about what that is, 2026-11-17).
  if (caps.biography && caps.artistImages) return 'Artist biographies and photos';
  if (caps.biography) return 'Artist biographies';
  if (caps.artistImages) return 'Artist photos';
  if (caps.metadata) return 'Artist info';
  return '';
}

// The label of the field to fill in first, in sentence case ("API key").
function keyLabel(plugin) {
  const field = configurableOf(plugin)[authFieldOf(plugin)] || {};
  const label = String(field.label || 'API key').trim().toLowerCase().replace(/\bapi\b/g, 'API').replace(/\bid\b/g, 'ID');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// pluginSwitchState({ plugin, config, activeResolvers }) →
//   { checked, disabled, hint }
function pluginSwitchState({ plugin, config, activeResolvers }) {
  const c = config || {};
  if (plugin.type !== 'meta-service') {
    return { checked: (activeResolvers || []).includes(plugin.id), disabled: false, hint: hintFor(plugin) };
  }
  if (isGatedService(plugin)) {
    if (!needsKey(plugin)) return { checked: c.enabled === true, disabled: false, hint: hintFor(plugin) };
    if (!hasKey(plugin, c)) return { checked: false, disabled: true, hint: `Add your ${keyLabel(plugin)} below first` };
    return { checked: c.enabled !== false, disabled: false, hint: hintFor(plugin) };
  }
  if (isArtistInfoOnly(plugin)) return { checked: c.enabled !== false, disabled: false, hint: hintFor(plugin) };
  return { checked: c.enabled === true || (c.enabled !== false && hasKey(plugin, c)), disabled: false, hint: hintFor(plugin) };
}

// The "Play from X" switch under a music plug-in's "Use X" (#1505): on, a
// plug-in plays and takes a place in the priority order; off, it stays on
// for search, covers and links. The account's plan can switch it off too
// (lib/playback-limits.js): then it's off and can't be turned on, saying why.
//
// playbackSwitchState({ plugin, active, playbackOff, limit }) →
//   { shown, checked, disabled, hint }
function playbackSwitchState({ plugin, active, playbackOff, limit }) {
  const caps = plugin.capabilities || {};
  const shown = plugin.type !== 'meta-service' && !!caps.resolve && !!active;
  if (limit && limit.blocked) return { shown, checked: false, disabled: true, hint: limit.message || limit.label || 'Your plan can\u2019t play from it' };
  return playbackOff
    ? { shown, checked: false, disabled: false, hint: 'Off: found in search, played from other plug-ins' }
    : { shown, checked: true, disabled: false, hint: 'Plays tracks, in your priority order' };
}

// The "Recommendations from X" switch (#1505), for a plug-in that's on and
// offers recommendations (Amazon, Apple Music, Last.fm, ListenBrainz): off,
// the Recommendations page and Home leave its picks out.
function recommendationsSwitchState({ plugin, active, recommendationsOff }) {
  const caps = plugin.capabilities || {};
  const shown = !!caps.recommendations && !!active;
  return recommendationsOff
    ? { shown, checked: false, hint: 'Its picks are left out of Recommendations and Home' }
    : { shown, checked: true, hint: 'Its picks in Recommendations and on Home' };
}

// The "Use metadata from X" switch (#1505), for a music plug-in that's on:
// album covers and artist photos. Off, they come from the other plug-ins.
function metadataSwitchState({ plugin, active, metadataOff }) {
  const shown = plugin.type !== 'meta-service' && !!(plugin.capabilities || {}).resolve && !!active;
  return metadataOff
    ? { shown, checked: false, hint: 'Covers and artist photos come from other plug-ins' }
    : { shown, checked: true, hint: 'Album covers and artist photos' };
}

module.exports = { metadataSwitchState, playbackSwitchState, recommendationsSwitchState, pluginSwitchState, authFieldOf, needsKey, hasKey, keyLabel };
