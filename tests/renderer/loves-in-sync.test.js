/**
 * Loves in sync (#1445, #1559 step 4). A service's loves are part of what it
 * syncs:
 *
 * - The Collection's Sync menu switch pauses everything a service syncs, its
 *   love pushes and Send included. Settings' "Remove sync" (stopped) ends its
 *   library sync, not its loves; a service that never set up sync has
 *   nothing to pause; the import is a one-off you start, so it never asks.
 * - A love provider with no library sync (Last.fm, a server's stars) gets a
 *   loves-only row in the Sync menu, its switch the same "Push loves to X"
 *   as in its plug-in settings; signed out or not set up, it reads off and
 *   opens those settings.
 * - One with library sync (ListenBrainz) gets a "Loved tracks" switch in its
 *   sync dialog, the same setting again, never a second one.
 */

global.React = require('react');
const React = require('react');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const LP = require('../../src/renderer/lib/love-providers');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const noop = () => {};

afterEach(() => LP.clearLoveProviders());

describe('the pause', () => {
  test('only a sync paused from the Sync menu pauses loves', () => {
    expect(LP.lovesPausedBySync({ enabled: false })).toBe(true);
    expect(LP.lovesPausedBySync({ enabled: true })).toBe(false);
    expect(LP.lovesPausedBySync({ enabled: false, stopped: true })).toBe(false); // Remove sync
    expect(LP.lovesPausedBySync(undefined)).toBe(false); // never set up
    expect(LP.lovesPausedBySync(null)).toBe(false);
  });
});

describe('the Sync menu\'s loves rows', () => {
  const services = () => {
    LP.registerLoveProvider(LP.lastfmLoveProvider({ id: 'lastfm', isSignedIn: noop, loveTrack: noop, getLovedTracksPage: noop }));
    LP.registerLoveProvider(LP.listenbrainzLoveProvider({ id: 'listenbrainz', isSignedIn: noop, loveTrack: noop, getLovedTracksPage: noop }, { resolveMbid: noop }));
    return [
      { id: 'lastfm', name: 'Last.fm', color: '#d51007', capabilities: { lovedTracks: true }, loves: { contract: 1, verb: 'Love', needs: 'name', canImport: true } },
      { id: 'listenbrainz', name: 'ListenBrainz', capabilities: { lovedTracks: true }, loves: { contract: 1, verb: 'Love', needs: 'mbid', canImport: true } },
      { id: 'myserver', name: 'My Server', color: '#14b8a6', loves: { contract: 1, verb: 'Star', needs: 'serviceId', canImport: true }, loveTrack: noop, getLovedPage: noop, isConfigured: (c) => !!(c && c.serverUrl) },
      { id: 'spotify', name: 'Spotify' }, // no loves
      { id: 'lastfm', name: 'Last.fm', capabilities: { lovedTracks: true } }, // a second entry for the same plug-in
    ];
  };

  test('every love provider without a sync row, once each, with its switch and whether it can push', () => {
    const rows = LP.loveSyncRows(services(), {
      syncProviderIds: ['spotify', 'listenbrainz'],
      scrobblerConfigs: { lastfm: { sessionKey: 'sk' } },
      pluginConfigs: { myserver: {} },
      pushEnabled: { lastfm: true, myserver: true },
    });
    expect(rows.map((r) => r.id)).toEqual(['lastfm', 'myserver']);
    expect(rows[0]).toMatchObject({ name: 'Last.fm', color: '#d51007', signedIn: true, pushOn: true, offLabel: 'Signed out' });
    expect(rows[0].words.plural).toBe('loves');
    expect(rows[1]).toMatchObject({ name: 'My Server', signedIn: false, pushOn: true, offLabel: 'Not set up', signedOutHint: 'Set up My Server first' });
    expect(rows[1].words.plural).toBe('stars');
  });

  test('without the sync ids, every love provider (the dialog picks its own)', () => {
    expect(LP.loveSyncRows(services(), {}).map((r) => r.id)).toEqual(['lastfm', 'listenbrainz', 'myserver']);
  });

  test('the menu draws them after the sync rows: the switch is the push, signed out it opens the settings', () => {
    const coll = read('src/renderer/components/collection-page.js');
    const menu = coll.slice(coll.indexOf('const loveRows = Array.isArray(syncMenuLoveRows)'), coll.indexOf("return React.createElement(Menu, {\n                  label: 'Sync',"));
    expect(menu).toContain("if (loveRows.length > 0) items.push({ separator: true, key: 'sep-loves' });");
    expect(menu).toContain('label: `${row.name} ${row.words.plural}`,');
    expect(menu).toContain('onSelect: () => openPluginSettings(row.id),');
    expect(menu).toContain('checked: row.signedIn && row.pushOn,');
    expect(menu).toContain('label: `Push ${row.words.plural} to ${row.name}`,');
    expect(menu).toContain('onChange: (next) => (row.signedIn ? setLovePushEnabled(row.id, next) : openPluginSettings(row.id)),');
    // After the sync rows.
    expect(coll.indexOf('const loveRows = Array.isArray(syncMenuLoveRows)')).toBeGreaterThan(coll.indexOf('for (const [pid, config] of Object.entries(syncProviderConfig)) {'));
  });

  test('app.js builds them from every loaded plug-in, split between the menu and the dialogs', () => {
    const app = read('src/renderer/app.js');
    expect(app).toContain('const loveRows = useMemo(() => loveSyncRows([...metaServices, ...loadedResolvers], {');
    expect(app).toContain('const syncMenuLoveRows = useMemo(() => loveRows.filter((r) => !syncProviderConfig[r.id]), [loveRows, syncProviderConfig]);');
    expect(app).toContain('() => Object.fromEntries(loveRows.filter((r) => syncProviderConfig[r.id]).map((r) => [r.id, r])),');
  });
});

describe('the sync dialog\'s "Loved tracks"', () => {
  const { SyncSetupDialog } = require('../../src/renderer/components/sync-setup-dialog');
  const render = (loves, syncSettings = {}) => {
    global.window = global.window || {};
    return renderToStaticMarkup(React.createElement(SyncSetupDialog, {
      resolverSyncSettings: { listenbrainz: syncSettings },
      syncDialogLoves: loves ? { listenbrainz: loves } : {},
      setLovePushEnabled: noop,
      setProviderSyncEnabled: noop,
      setSyncSetupModal: noop,
      startSync: noop,
      syncProviderConfig: { listenbrainz: { name: 'ListenBrainz', color: '#353070', capabilities: { tracks: false, albums: false, artists: false, playlists: true } } },
      syncSetupModal: { open: true, providerId: 'listenbrainz', step: 'options', settings: { syncPlaylists: true }, playlists: [], selectedPlaylists: [] },
    }));
  };
  const row = (over = {}) => ({ id: 'listenbrainz', name: 'ListenBrainz', words: LP.loveWords('Love'), signedIn: true, pushOn: true, signedOutHint: 'Sign in to scrobble first', ...over });
  const section = (html) => html.slice(html.indexOf('data-section="sync-loves"'), html.indexOf('data-section="sync-loves"') + 1600);

  test('a switch beside Playlists, on when the push is, saying what it does', () => {
    const html = render(row());
    expect(html).toContain('Playlists');
    const s = section(html);
    expect(s).toContain('Loved tracks');
    expect(s).toContain('Love it on ListenBrainz when you love it here');
    expect(s).toContain('aria-checked="true"');
    expect(s).toContain('aria-label="Push loves to ListenBrainz"');
  });

  test('a paused sync says its loves are paused too', () => {
    expect(section(render(row(), { enabled: false }))).toContain('Paused with ListenBrainz sync');
  });

  test('signed out: off and locked, with what to do', () => {
    const s = section(render(row({ signedIn: false })));
    expect(s).toContain('aria-checked="false"');
    expect(s).toMatch(/role="switch"[^>]* disabled=""|disabled=""[^>]*role="switch"/);
    expect(s).toContain('Sign in to scrobble first');
  });

  test('no row for a service without loves (Spotify)', () => {
    expect(render(null)).not.toContain('sync-loves');
  });
});
