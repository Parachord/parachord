/**
 * A service's display name comes from its plug-in's manifest, through one
 * lookup (src/renderer/lib/plugin-names.js, #1521), never a per-service
 * ternary: concert ticket sellers, friend toasts, the loved-tracks labels and
 * the playlist page's provider and source names.
 */
const fs = require('fs');
const path = require('path');
const N = require('../../src/renderer/lib/plugin-names');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifest = (id) => {
  const m = JSON.parse(read(`plugins-src/${id}/manifest.json`));
  return m.manifest || m;
};

// The names these sites used to write out. Each must be exactly what the
// plug-in's manifest says, so moving to the registry changes no text.
const WRITTEN_OUT = {
  bandsintown: 'Bandsintown',
  songkick: 'Songkick',
  seatgeek: 'SeatGeek',
  ticketmaster: 'Ticketmaster',
  lastfm: 'Last.fm',
  listenbrainz: 'ListenBrainz',
  spotify: 'Spotify',
  applemusic: 'Apple Music',
  amazonmusic: 'Amazon Music',
  soundcloud: 'SoundCloud',
  youtube: 'YouTube',
};

afterEach(() => N.setPluginLookup(null));

test("a known id gives its manifest's name, exactly as the UI wrote it before", () => {
  const registry = Object.fromEntries(Object.keys(WRITTEN_OUT).map((id) => [id, manifest(id)]));
  N.setPluginLookup((id) => registry[id] || null);
  for (const [id, name] of Object.entries(WRITTEN_OUT)) expect(N.pluginName(id)).toBe(name);
});

test('an unknown id is never blank: the fallback, else the id capitalised', () => {
  N.setPluginLookup(() => null);
  expect(N.pluginName('tidal')).toBe('Tidal');
  expect(N.pluginName('tidal', 'TIDAL')).toBe('TIDAL');
  expect(N.pluginName('')).toBe('Unknown');
  expect(N.pluginName(undefined)).toBe('Unknown');
  // A plug-in with no name, or a lookup that throws, falls back too.
  N.setPluginLookup(() => ({ name: '  ' }));
  expect(N.pluginName('qobuz')).toBe('Qobuz');
  N.setPluginLookup(() => { throw new Error('not loaded'); });
  expect(N.pluginName('deezer')).toBe('Deezer');
});

test("an import source maps to its plug-in: the part before -sync / -import", () => {
  expect(N.importSourcePluginId('spotify-sync')).toBe('spotify');
  expect(N.importSourcePluginId('applemusic-import')).toBe('applemusic');
  expect(N.importSourcePluginId('amazonmusic-import')).toBe('amazonmusic');
  expect(N.importSourcePluginId('hosted-xspf')).toBeNull();
  expect(N.importSourcePluginId('imported-xspf')).toBeNull();
  expect(N.importSourcePluginId('web')).toBeNull();
  expect(N.importSourcePluginId('spotify')).toBeNull();
  expect(N.importSourcePluginId(undefined)).toBeNull();
});

test('the sites read the registry, not a written-out name', () => {
  // app.js and the loves hook moved out of it (#1559 step 1).
  const app = read('src/renderer/app.js') + read('src/renderer/hooks/use-loves.js');
  const page = read('src/renderer/components/playlist-view-page.js');
  // app.js hands over its registry lookup; window.resolverLabelById is the same one.
  expect(app).toContain('setPluginLookup((id) => findLoadedResolver(id)');
  expect(app).toContain("window.resolverLabelById = (id) => (id ? pluginName(id) : 'Stream');");
  // Concerts (two copies), friend toasts, love backfill and import.
  expect(app).not.toMatch(/event\.source === '(?:bandsintown|songkick|seatgeek|ticketmaster)'/);
  expect(app.match(/label: (?:event\.source === 'ai' \? \(event\.aiProviderName \|\| 'AI'\)\s*: )?pluginName\(event\.source\)/g)).toHaveLength(2);
  expect(app).not.toMatch(/service === 'listenbrainz' \? 'ListenBrainz'/);
  expect(app).not.toMatch(/service === 'lastfm' \? '(?:Last\.fm|ListenBrainz)'/);
  expect(app).toContain('is not currently listening on ${pluginName(service)}');
  expect(app).toContain('const otherLabel = pluginName(otherService);');
  // The playlist page: provider names and the import-source label.
  expect(page).not.toMatch(/providerId === '(?:spotify|applemusic)'/);
  expect(page).not.toMatch(/source === '[a-z]+-(?:sync|import)'/);
  expect(page).toContain('sourceLabel = pluginName(sourcePlugin);');
});

// A service's colour comes from the same lookup (the playlist page's sync
// badges read "listenbrainz", uncoloured, when they looked only at the
// playback plug-ins; ListenBrainz is a meta service).
test('pluginColor reads the plug-in\'s manifest colour, and nothing for an unknown id', () => {
  N.setPluginLookup((id) => (id === 'listenbrainz' ? { id, name: 'ListenBrainz', color: '#eb743b' } : null));
  expect(N.pluginColor('listenbrainz')).toBe('#eb743b');
  expect(N.pluginColor('nope')).toBeUndefined();
  expect(N.pluginColor(null)).toBeUndefined();
});

test('the playlist page\'s sync badges are named and coloured through the registry', () => {
  const page = read('src/renderer/components/playlist-view-page.js');
  const start = page.indexOf('...mirrors.map(pid => {');
  const body = page.slice(start, start + 600);
  expect(body).toMatch(/const name = pluginName\(pid\);/);
  expect(body).toMatch(/pluginColor\(pid\)/);
  expect(body).not.toMatch(/allResolvers/);
});
