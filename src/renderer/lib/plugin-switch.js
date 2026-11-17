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

// What the switch's hint line says when nothing's missing.
function hintFor(plugin) {
  const caps = plugin.capabilities || {};
  if (plugin.type !== 'meta-service') return 'Include in search and playback';
  if (caps.concerts) return 'Include in Concerts';
  if (caps.chat || caps.generate) return 'Use with Shuffleupagus';
  if (caps.recommendations) return 'Use for recommendations and your history';
  if (caps.scrobbling) return 'Scrobble what you play';
  if (caps.metadata || caps.biography) return 'Use for artist info';
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
  return { checked: c.enabled === true || (c.enabled !== false && hasKey(plugin, c)), disabled: false, hint: hintFor(plugin) };
}

module.exports = { pluginSwitchState, authFieldOf, needsKey, hasKey, keyLabel };
