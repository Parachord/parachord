// src/renderer/lib/plugin-names.js: a plug-in's display name, from the
// plug-in registry (#1521).
//
// UI text that names a service ("…isn't listening on ListenBrainz", a
// concert's ticket seller, a playlist's "Source: Spotify") reads the plug-in's
// own manifest `name`, never a per-service ternary: a new or renamed plug-in
// then reads right everywhere with no code change (CLAUDE.md, "Route by the
// plugin registry"). app.js hands this module its registry lookup once
// (setPluginLookup): playback plug-ins, meta services (Last.fm,
// ListenBrainz, the concert sellers) and anything else the loader holds.
// `window.resolverLabelById` is the same lookup, for code that reads it off
// window.
//
// A name is never blank. A plug-in the registry doesn't have (removed, or
// not loaded yet) reads as the caller's fallback, else its id capitalised.
//
// Loads under plain Node.

let lookup = () => null;
// fn(pluginId) -> the plug-in (anything with a `name`), or null when unknown.
function setPluginLookup(fn) { lookup = typeof fn === 'function' ? fn : () => null; }

const capitalise = (id) => id.charAt(0).toUpperCase() + id.slice(1);

// The plug-in's name; else `fallback`; else the id capitalised; else 'Unknown'.
function pluginName(id, fallback) {
  let plugin = null;
  if (id) {
    try { plugin = lookup(id); } catch { plugin = null; }
  }
  const name = plugin && typeof plugin.name === 'string' ? plugin.name.trim() : '';
  if (name) return name;
  if (fallback) return fallback;
  return id ? capitalise(String(id)) : 'Unknown';
}

// A playlist's import source names the plug-in it came from: 'spotify-sync'
// (a playlist the user owns there) or 'applemusic-import' (one they follow,
// or a link import) is `<plug-in id>-sync` / `<plug-in id>-import`
// (main-process/ipc/sync-start.js, the link importer in app.js). The plug-in
// id, or null for any other source ('hosted-xspf', 'imported-xspf', 'web').
function importSourcePluginId(source) {
  if (typeof source !== 'string') return null;
  const m = /^(.+)-(?:sync|import)$/.exec(source);
  return m ? m[1] : null;
}

// The plug-in's manifest `color`, from the same registry, or undefined when
// it has none or isn't known (the caller then draws its neutral look). The
// playlist page's sync badges looked only at the playback plug-ins, so a meta
// service (ListenBrainz) read "listenbrainz", uncoloured.
function pluginColor(id) {
  if (!id) return undefined;
  let plugin = null;
  try { plugin = lookup(id); } catch { plugin = null; }
  return plugin && typeof plugin.color === 'string' && plugin.color ? plugin.color : undefined;
}

module.exports = { setPluginLookup, pluginName, pluginColor, importSourcePluginId };
