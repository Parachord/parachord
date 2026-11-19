// src/renderer/lib/playback-telemetry.js: starts the playing plug-ins that
// report plays to their own service (capabilities.playbackTelemetry on a
// content resolver: Subsonic's "Report plays to your server", #1546).
//
// A meta service with that capability (Achordion) is started by app.js's
// meta-service loads; this is the same for a plug-in that plays. Its init
// registers with window.scrobbleManager (docs/architecture/scrobbling.md),
// and gets `host.getConfig()`, the plug-in's saved settings read fresh at
// each call, so a switch or a password changed in Settings applies to the
// next play without a reload. Chosen by capability, never by the plug-in's
// id. Loads under plain Node.

async function initPlaybackTelemetry(loader, resolvers, getConfig) {
  const started = [];
  if (!loader || typeof loader.initResolver !== 'function') return started;
  for (const resolver of resolvers || []) {
    if (!resolver || !resolver.capabilities || resolver.capabilities.playbackTelemetry !== true) continue;
    if (typeof resolver.init !== 'function') continue;
    const id = resolver.id;
    try {
      await loader.initResolver(id, {}, {
        getConfig: async () => (typeof getConfig === 'function' ? (await getConfig(id)) || {} : {}),
      });
      started.push(id);
    } catch (e) {
      console.warn(`⚠️ Playback-telemetry init failed for ${id}:`, (e && e.message) || e);
    }
  }
  return started;
}

module.exports = { initPlaybackTelemetry };
