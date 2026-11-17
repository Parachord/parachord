/**
 * src/renderer/lib/host-bridges-hide.js — the ONE hostBridges hide rule every
 * .axe load path runs (#1355; #1432 review, note 7).
 *
 * The rule: read the host's advertised bridges (window.__parachordHostBridges,
 * set by the preload) and hide every .axe whose required bridges this host
 * doesn't supply — hidden, not refused, so the same .axe installs everywhere
 * and runs where the host has the bridge. The pure half (which axe needs
 * what, what "missing" means) lives in main-process/plugin-compat.js, mirrored
 * by mobile's PluginCompat.kt; this module is the renderer plumbing around
 * it — the advertisement read (contextBridge need not hand back a literal
 * Array, so the read uses Array.from) and the loader's log line.
 *
 * initResolvers ran the only copy: the fallback resolver load, the
 * install/reload paths (install-from-file, marketplace install) and the
 * meta-service hot-reload after a marketplace sync (handlePluginsUpdated)
 * materialized .axe content straight onto the resolver list, where the same
 * plugin would load and throw not-ready on every resolve. One rule, one
 * owner — every path that turns .axe content into a live resolver runs this
 * first.
 */

const { hostBridgesHideFilter } = require('../../../main-process/plugin-compat');

// axes minus the ones this host hides, logging each hidden plugin by name.
// `win` is injectable for tests; the default is the real window.
function hideAxesLackingHostBridges(axes, win = window) {
  // Array.from, not Array.isArray: the list crosses contextBridge, which
  // need not hand back a literal Array (a proxy still iterates).
  const supplied = Array.from((win && win.__parachordHostBridges) || []);
  const { visible, hidden } = hostBridgesHideFilter(axes, supplied);
  if (hidden.length > 0) {
    console.log(`🙈 Hidden ${hidden.length} plugin(s) whose host bridges this app doesn't supply: ${hidden.join(', ')}`);
  }
  return visible;
}

module.exports = { hideAxesLackingHostBridges };
