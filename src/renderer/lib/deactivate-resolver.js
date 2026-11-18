// src/renderer/lib/deactivate-resolver.js: take a plug-in out of play when
// its account signs out (#1522). Every sign-out that turns its plug-in off
// (Spotify, SoundCloud, Apple Music today) calls this one path instead of
// its own copy of the lines.
//
// It does three things, in this order:
//   1. drops the plug-in's sources from every track (removeResolverSources);
//   2. takes it out of the active list (setActiveResolvers);
//   3. takes it out of the saved active list too
//      (savedActiveResolversRef), so reEnableResolver, which restores a
//      plug-in a failed startup auth check removed, treats the sign-out as
//      the person's own choice and never turns it back on.
//
// Pure apart from the host functions it is handed; loads under plain Node.

function deactivateResolver({ removeResolverSources, setActiveResolvers, savedActiveResolversRef }, resolverId) {
  if (!resolverId) return;
  removeResolverSources(resolverId);
  setActiveResolvers(prev => prev.filter(id => id !== resolverId));
  if (savedActiveResolversRef && savedActiveResolversRef.current) {
    savedActiveResolversRef.current = savedActiveResolversRef.current.filter(id => id !== resolverId);
  }
}

module.exports = { deactivateResolver };
