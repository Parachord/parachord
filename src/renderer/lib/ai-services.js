// src/renderer/lib/ai-services.js: which AI plug-ins offer a capability
// (generate or chat for the playlist prompt, chat for Shuffleupagus), and whether a
// listening-history account is connected. Pure, so the app and the memo'd
// AI prompt panel share one rule.

// Plug-ins with `capability` (or any of an array of them): the loader's (they carry the implementation)
// first, then meta services that have it but haven't loaded yet, so a
// provider still shows in the picker while it loads or after it failed to.
function servicesWithCapability(capability, loader, metaServices) {
  const wanted = Array.isArray(capability) ? capability : [capability];
  const has = (s) => wanted.some(c => s.capabilities?.[c]);
  const fromLoader = loader
    ? loader.getAllResolvers().filter(has)
    : [];
  const loaderIds = new Set(fromLoader.map(r => r.id));
  const fromState = (metaServices || []).filter(ms =>
    has(ms) && !loaderIds.has(ms.id)
  );
  return [...fromLoader, ...fromState];
}

// Plug-ins that make AI playlists: their own `generate`, or any `chat`
// plug-in through the shared fallback (lib/ai-generate.js).
function aiPlaylistServices(loader, metaServices) {
  return servicesWithCapability(['generate', 'chat'], loader, metaServices);
}

// Last.fm or ListenBrainz has a username.
function hasScrobblerConnected(metaServiceConfigs) {
  const configs = metaServiceConfigs || {};
  return !!(configs.lastfm?.username || configs.listenbrainz?.username);
}

module.exports = { servicesWithCapability, aiPlaylistServices, hasScrobblerConnected };
