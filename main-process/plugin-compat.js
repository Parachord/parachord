// plugin-compat.js — the minimum app version a plugin declares.
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

module.exports = {
  PLUGIN_PLATFORMS,
  parseVersion,
  compareVersions,
  pluginMinAppVersion,
  pluginCompatibility,
  validateMinAppVersion
};
