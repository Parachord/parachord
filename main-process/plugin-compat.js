// plugin-compat.js — the host features a plugin declares it needs.
//
// Two fields, one rule shape (absent is no requirement, malformed is no
// requirement, build-axes rejects a malformed one at source):
//
//   1. The minimum app version (minAppVersion, per platform, in the manifest) —
//      an app below the floor refuses to download/load/install the plugin.
//   2. The required host bridges (requires.hostBridges, top-level) — a host
//      that doesn't supply every named bridge HIDES the plugin (#1355).
//
// The marketplace serves only the latest copy of each plugin, and every
// installed app downloads it. A plugin that relies on a host feature an older
// app lacks (a new IPC surface, a native player) would break there, so a
// plugin can declare the oldest app it runs on, per platform:
//
//   .axe manifest (and its marketplace-manifest.json entry):
//     "minAppVersion": { "desktop": "0.9.12", "android": "1.4.0", "ios": "1.0.0" }
//
// Desktop and mobile version independently and gain host features at
// different times, so each platform gets its own floor. A platform with no
// entry, or a plugin with no field, has no floor. An app below the floor
// keeps the copy it already has (the bundled one, or an older cached one).
//
// The Android/iOS clients mirror this module (parachord-mobile), so keep the
// rules here and in docs/architecture/plugins.md in step with it.

const PLUGIN_PLATFORMS = Object.freeze(['desktop', 'android', 'ios']);

const VERSION_RE = /^\d+\.\d+\.\d+$/;

// "0.9.12" → [0, 9, 12]. A pre-release or build suffix ("0.9.12-beta.1") is
// dropped, so a pre-release counts as its release.
function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const core = version.trim().split(/[-+]/)[0];
  if (!VERSION_RE.test(core)) return null;
  return core.split('.').map(Number);
}

// >0 if a > b, <0 if a < b, 0 if equal or either is unparseable.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// The floor a manifest (an .axe `manifest` or a marketplace entry) declares
// for `platform`, or null when it declares none. A malformed value is no
// floor: build-axes rejects one before it can ship (see validateMinAppVersion).
function pluginMinAppVersion(manifest, platform) {
  const map = manifest && manifest.minAppVersion;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const floor = map[platform];
  return parseVersion(floor) ? floor : null;
}

// { ok: true } when the app can run the plugin, else
// { ok: false, requires } naming the floor it is below.
function pluginCompatibility(manifest, appVersion, platform) {
  const requires = pluginMinAppVersion(manifest, platform);
  if (!requires) return { ok: true };
  // An app that can't report its version is not refused on that account.
  if (!parseVersion(appVersion)) return { ok: true };
  return compareVersions(appVersion, requires) >= 0 ? { ok: true } : { ok: false, requires };
}

// For build-axes: the list of problems with a source manifest's field
// (empty when it is absent or well formed).
function validateMinAppVersion(value) {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['minAppVersion must be an object such as { "desktop": "0.9.12" }'];
  }
  const problems = [];
  for (const [platform, version] of Object.entries(value)) {
    if (!PLUGIN_PLATFORMS.includes(platform)) {
      problems.push(`minAppVersion has unknown platform "${platform}" (use ${PLUGIN_PLATFORMS.join(', ')})`);
    } else if (typeof version !== 'string' || !VERSION_RE.test(version)) {
      problems.push(`minAppVersion.${platform} must be a plain x.y.z version, got ${JSON.stringify(version)}`);
    }
  }
  return problems;
}

// ── Required host bridges (#1355) ─────────────────────────────────────────────
//
// A plugin that calls a host bridge (window.electron.webSession, ...) can
// declare the ones it needs, as a top-level .axe field:
//
//   "requires": { "hostBridges": ["webSession"] }
//
// Each host advertises what it supplies (desktop's preload sets
// window.__parachordHostBridges; the mobile apps set the same global in their
// JS runtimes), and the plugin loader HIDES a plugin whose required bridges
// are not all supplied — hidden, not refused: the same .axe installs
// everywhere and runs where the host has the bridge (a loaded plugin without
// its bridge would throw not-ready on every resolve, and a retrying resolver
// would keep re-asking it). Mirrors the minAppVersion rule shapes: absent is
// no requirement, and a malformed declaration is no requirement (build-axes
// rejects a malformed one at source, so a shipped plugin never carries one).

// The bridges an .axe requires, or null when it requires none (absent or
// malformed — see the section header).
function pluginRequiredHostBridges(axe) {
  const requires = axe && axe.requires;
  if (!requires || typeof requires !== 'object' || Array.isArray(requires)) return null;
  const bridges = requires.hostBridges;
  if (!Array.isArray(bridges) || !bridges.every((b) => typeof b === 'string' && b)) return null;
  return bridges;
}

// { ok: true } when the host supplies every bridge the .axe requires, else
// { ok: false, missing } naming the ones it lacks.
function hostBridgesCompatibility(axe, supplied) {
  const required = pluginRequiredHostBridges(axe);
  if (!required) return { ok: true };
  const have = new Set(Array.isArray(supplied) ? supplied : []);
  const missing = required.filter((bridge) => !have.has(bridge));
  return missing.length > 0 ? { ok: false, missing } : { ok: true };
}

// The hide-filter the renderer's plugin loader runs over its .axe list
// (#1355 wiring): every axe whose required bridges the host doesn't fully
// supply is dropped, and each dropped one is named for the loader's log
// line ("Name (needs bridge, …)"). Extracted here — not left inline in
// app.js's initResolvers — so tests drive the filter the renderer actually
// runs (app.js executes only in the Electron renderer, never under jest);
// mobile mirrors the RULE (PluginCompat.kt), not this loader plumbing.
function hostBridgesHideFilter(axes, supplied) {
  const visible = [];
  const hidden = [];
  for (const axe of Array.isArray(axes) ? axes : []) {
    const bridges = hostBridgesCompatibility(axe, supplied);
    if (bridges.ok) {
      visible.push(axe);
    } else {
      hidden.push(`${axe.manifest?.name || axe.manifest?.id} (needs ${bridges.missing.join(', ')})`);
    }
  }
  return { visible, hidden };
}

// For build-axes: the list of problems with an .axe's `requires` field
// (empty when it is absent or well formed). Only hostBridges is known today;
// future requires keys ("playback": the host's DRM list) pass through
// untouched until they exist.
function validateRequires(value) {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['requires must be an object such as { "hostBridges": ["webSession"] }'];
  }
  if (value.hostBridges === undefined) return [];
  if (!Array.isArray(value.hostBridges)) {
    return [`requires.hostBridges must be an array of bridge names, got ${JSON.stringify(value.hostBridges)}`];
  }
  const problems = [];
  for (const bridge of value.hostBridges) {
    if (typeof bridge !== 'string' || !bridge) {
      problems.push(`requires.hostBridges must contain bridge names (non-empty strings), got ${JSON.stringify(bridge)}`);
    }
  }
  return problems;
}

module.exports = {
  PLUGIN_PLATFORMS,
  parseVersion,
  compareVersions,
  pluginMinAppVersion,
  pluginCompatibility,
  validateMinAppVersion,
  pluginRequiredHostBridges,
  hostBridgesCompatibility,
  hostBridgesHideFilter,
  validateRequires
};
