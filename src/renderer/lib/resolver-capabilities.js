// src/renderer/lib/resolver-capabilities.js: what a plug-in declares in its
// manifest's `capabilities`, by id, for code that must treat a source by what
// its plug-in does rather than by its name (CLAUDE.md, "Route by the plugin
// registry, never by service name"; #1520).
//
// The loaded registry answers once it has loaded. Before that, the bundled
// copy of the plug-in answers (the generated FALLBACK_RESOLVERS array, which
// app.js has at module load): a restored track's playbar, a page's first
// resolutions and the stream-quality backfill can all ask before
// `initResolvers` fills the registry, and an id check answered them then. A
// plug-in the loaded registry doesn't have (removed, hidden for a missing
// host bridge) declares nothing.
//
// Pure, so jest drives it directly (tests/renderer/resolver-capabilities.test.js).

'use strict';

const NONE = Object.freeze({});

// `loaded`: the registry's resolver instances ({ id, capabilities }).
// `bundled`: .axe objects ({ manifest: { id }, capabilities }).
function capabilitiesOf(id, loaded, bundled) {
  if (!id) return NONE;
  if (Array.isArray(loaded) && loaded.length > 0) {
    const resolver = loaded.find((r) => r && r.id === id);
    return (resolver && resolver.capabilities) || NONE;
  }
  const axe = Array.isArray(bundled) ? bundled.find((a) => a && a.manifest && a.manifest.id === id) : null;
  return (axe && axe.capabilities) || NONE;
}

// `capabilities.local`: the plug-in's sources are files in the local library
// (the local-files DB). The host plays them from disk through local-audio:,
// they need no network, the file is checked before it plays, and a source
// whose file has left the library is a miss. Local Files declares it.
function isLocalResolver(id, loaded, bundled) {
  return !!capabilitiesOf(id, loaded, bundled).local;
}

module.exports = { capabilitiesOf, isLocalResolver };
