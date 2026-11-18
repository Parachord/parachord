// src/renderer/lib/plugin-setup.js: whether an enabled plug-in still needs
// setting up, for the "Needs setup" mark on Settings › Plug-Ins (#1522).
//
// Pure: app.js passes in what it knows, keyed by plug-in id, and the page
// reads one map. Nothing here names a service. Loads under plain Node.
//
// Three sources, in this order:
//   1. the plug-in's own status reply (capabilities.status, getStatus): a
//      reply with `signedIn` is the verdict. Amazon Music answers here
//      (#1356); any plug-in that declares the capability does the same.
//   2. what the host holds for it (`host`): a sign-in whose token lives in
//      app.js (Spotify, Apple Music, SoundCloud today) or the music folders
//      the Local Files plug-in plays from. true is set up, false is not.
//   3. otherwise its manifest (getting-started.js setupMissing): a plug-in
//      that answers isConfigured(config) decides (Plex, Subsonic), else the
//      settings fields it needs and has none saved for.
// A status-capable plug-in with no verdict yet (not read, or the read
// failed: the loader's { failed: true }) is not marked: no verdict is the
// safe reading, as the limit map treats it (lib/playback-limits.js).

const { setupMissing } = require('./getting-started');

const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// What a status reply says about the sign-in: true, false, or null for no
// verdict.
function statusSignedIn(reply) {
  return reply && typeof reply.signedIn === 'boolean' ? reply.signedIn : null;
}

// The sign-ins the host knows, with each plug-in's own status reply laid
// over them: a plug-in's reply wins for its own id. Home's getting-started
// tiles read this as `accounts`.
function signedInMap(host, statuses) {
  const out = { ...(host || {}) };
  for (const [id, reply] of Object.entries(statuses || {})) {
    const signedIn = statusSignedIn(reply);
    if (signedIn !== null) out[id] = signedIn;
  }
  return out;
}

// One plug-in: true while it needs setting up. `known` is signedInMap's
// output (plus any other host fact), `config` its saved settings.
function needsSetup(resolver, { known = {}, config } = {}) {
  const id = resolver && resolver.id;
  if (!id) return false;
  if (hasOwn(known, id)) return known[id] !== true;
  if (resolver.capabilities && resolver.capabilities.status) return false;
  return setupMissing(resolver, config);
}

// { [id]: true } for every plug-in in `resolvers` that needs setting up.
//   host      { [id]: boolean } what the host holds (see above)
//   statuses  { [id]: reply } the getStatus replies (app.js pluginStatuses)
//   configs   { [id]: saved settings } (meta_service_configs)
function needsSetupMap(resolvers, { host, statuses, configs } = {}) {
  const known = signedInMap(host, statuses);
  const out = {};
  for (const r of Array.isArray(resolvers) ? resolvers : []) {
    if (r && r.id && needsSetup(r, { known, config: configs && configs[r.id] })) out[r.id] = true;
  }
  return out;
}

module.exports = { statusSignedIn, signedInMap, needsSetup, needsSetupMap };
