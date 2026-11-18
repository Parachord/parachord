// src/renderer/lib/ai-services.js: which AI plug-ins offer a capability
// (chat for Shuffleupagus), and whether a listening-history account is
// connected. Pure, so the app and its memo'd panels share one rule.

// Plug-ins with `capability`: the loader's (they carry the implementation)
// first, then meta services that have it but haven't loaded yet, so a
// provider still shows in the picker while it loads or after it failed to.
function servicesWithCapability(capability, loader, metaServices) {
  const fromLoader = loader
    ? loader.getAllResolvers().filter(r => r.capabilities?.[capability])
    : [];
  const loaderIds = new Set(fromLoader.map(r => r.id));
  const fromState = (metaServices || []).filter(ms =>
    ms.capabilities?.[capability] && !loaderIds.has(ms.id)
  );
  return [...fromLoader, ...fromState];
}

// Last.fm or ListenBrainz has a username.
function hasScrobblerConnected(metaServiceConfigs) {
  const configs = metaServiceConfigs || {};
  return !!(configs.lastfm?.username || configs.listenbrainz?.username);
}

module.exports = { servicesWithCapability, hasScrobblerConnected };
