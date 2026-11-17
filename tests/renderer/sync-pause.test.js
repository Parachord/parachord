/**
 * The Collection page's Sync menu turns each service's sync on and off
 * (2026-11-15). Off is a pause: only `enabled` changes, and nothing calls the
 * service until it's back on.
 *
 * - Menu (components/menu.js) items take `toggle`: a menuitemcheckbox beside
 *   the item (never a control nested in a menuitem). The row still runs
 *   onSelect; the switch flips without closing the menu.
 * - app.js's setProviderSyncEnabled writes `enabled` only, cancels a sync in
 *   flight when turning off, and opens setup for a service never set up.
 * - Every path that calls a service checks `enabled`: the background loop,
 *   the startup syncs, the love/unlove pushes and removals, and the main
 *   process's N-way drive.
 * - The setup dialog: nothing ticked can't start; a syncing service says
 *   Save, and with nothing ticked offers Turn off sync.
 */
global.React = require('react');
const fs = require('fs');
const path = require('path');
const { Menu } = require('../../src/renderer/components/menu');

const ROOT = path.join(__dirname, '../..');
const app = require('../helpers/renderer-source').appWithPages(); // app.js and the dialogs moved out of it (#1451)
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const coll = fs.readFileSync(path.join(ROOT, 'src/renderer/components/collection-page.js'), 'utf8');

// Renders an open Menu as a plain function (no DOM).
function openMenu(props) {
  const real = global.React;
  global.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
  global.window = { innerWidth: 1000, innerHeight: 800 };
  let s = 0;
  global.React = Object.assign({}, real, {
    useState: (init) => (s++ === 0 ? [true, () => {}] : [init, () => {}]),
    useRef: (v) => ({ current: v === undefined ? null : v }),
    useEffect: () => {}, useLayoutEffect: () => {}, useId: () => 'm',
  });
  try { return Menu(props); } finally { global.React = real; }
}
const walk = (n, out = []) => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((c) => walk(c, out)); return out; }
  if (n.props) { out.push(n); walk(n.props.children, out); }
  return out;
};

describe('Menu toggle items', () => {
  const onSelect = jest.fn();
  const onChange = jest.fn();
  const tree = openMenu({
    label: 'Sync', renderTrigger: (t) => React.createElement('button', t, 'Sync'),
    items: [{ key: 'spotify', label: 'Spotify', onSelect, toggle: { checked: false, label: 'Sync Spotify', onChange } }],
  });
  const nodes = walk(tree);
  const item = nodes.find((n) => n.props.role === 'menuitem');
  const sw = nodes.find((n) => n.props.role === 'menuitemcheckbox');

  test('a menuitem and a menuitemcheckbox side by side, not nested', () => {
    expect(item).toBeTruthy();
    expect(sw).toBeTruthy();
    expect(walk(item.props.children).some((n) => n.props.role === 'menuitemcheckbox')).toBe(false);
    expect(sw.props['aria-checked']).toBe('false');
    expect(sw.props['aria-label']).toBe('Sync Spotify');
    expect(sw.props.tabIndex).toBe(-1);
  });

  test('the switch flips and stays in the menu; the row opens Manage sync', () => {
    const stop = jest.fn();
    sw.props.onClick({ stopPropagation: stop });
    expect(onChange).toHaveBeenCalledWith(true);
    expect(stop).toHaveBeenCalled();
    item.props.onClick({ preventDefault() {} });
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('the Sync menu', () => {
  test("each service's row has its switch; the row still opens setup", () => {
    expect(coll).toMatch(/onSelect: \(\) => openSyncSetupModal\(pid\),[\s\S]{0,1200}toggle: \{\s*checked: !!resolverSyncSettings\[pid\]\?\.enabled && !syncSignedOut\?\.\[pid\],\s*label: `Sync \$\{config\.name\}`,\s*onChange: \(next\) => setProviderSyncEnabled\(pid, next\),/);
    expect(coll).not.toContain("'aria-label': 'Sync on'");
  });
});

describe('pause semantics', () => {
  const fn = app.slice(app.indexOf('const setProviderSyncEnabled = async (providerId, enabled) => {'));
  const body = fn.slice(0, fn.indexOf('\n  };\n'));
  test('only enabled changes; setup opens for a service never set up', () => {
    expect(body).toContain('if (enabled && (!existing || existing.stopped || syncSignedOutView[providerId])) { openSyncSetupModal(providerId); return; }');
    expect(body).toContain('const next = { ...existing, enabled };');
    expect(body).toContain('await window.electron.syncSettings.setProvider(providerId, next);');
    expect(body).toContain('if (!enabled) window.electron.sync.cancel(providerId).catch(() => {});');
    // Not Stop syncing: nothing synced is removed.
    expect(body).not.toMatch(/syncSources|removeSource|syncedFrom|syncedTo/);
  });
  test('the background loop and the startup syncs check enabled', () => {
    expect(app).toMatch(/for \(const \[providerId, settings\] of Object\.entries\(currentSettings\)\) \{[\s\S]{0,400}if \(settings\.enabled\) \{/);
    expect(app).toMatch(/if \(syncSettings\?\.spotify\?\.enabled\) \{\s*console\.log\('\[Sync\] Spotify re-authenticated with sync enabled/);
    expect(app).toMatch(/if \(syncSettings\?\.applemusic\?\.enabled\) \{\s*console\.log\('\[Sync\] Apple Music re-authenticated with sync enabled/);
  });
  test('love and unlove only reach Spotify while its sync is on', () => {
    for (const id of ['existingTrack', 'existingAlbum', 'existingArtist']) {
      expect(app).toContain(`if (syncSettings?.spotify?.enabled && ${id}.spotifyId) {`);
      expect(app).not.toContain(`(${id}.syncSources?.spotify || syncSettings?.spotify?.enabled)`);
    }
  });
  test('the N-way drive skips a paused provider', () => {
    expect(main).toMatch(/if \(providerSyncSettings\[pid\] && providerSyncSettings\[pid\]\.enabled === false\) \{[\s\S]{0,120}neededProviders\.delete\(pid\);/);
  });
});

describe('the setup dialog', () => {
  test("nothing ticked can't start; a syncing service saves or turns off", () => {
    // Only the options the service offers count (ListenBrainz: Playlists).
    expect(app).toContain("const nothingChosen = !chosen('tracks', 'syncTracks') && !chosen('albums', 'syncAlbums') && !chosen('artists', 'syncArtists') && !chosen('playlists', 'syncPlaylists');");
    expect(app).toContain("nothingChosen && syncingNow\n                  ? React.createElement(Button, { key: 'off', variant: 'primary', pageColor: fill, onClick: () => { setProviderSyncEnabled(pid, false); close(); } }, 'Turn off sync')");
    expect(app).toMatch(/key: 'go', variant: 'primary', pageColor: fill, disabled: nothingChosen,/);
    expect(app).toContain("chosen('playlists', 'syncPlaylists') ? 'Next' : (syncingNow ? 'Save' : 'Start sync')");
    expect(app).not.toContain("'Start Sync')");
  });
});

describe('signed out', () => {
  test("a service that's signed out shows its switch off, without new sign-in calls", () => {
    expect(coll).toMatch(/trailing: syncSignedOut\?\.\[pid\]\s*\? React\.createElement\('span', \{ style: \{ fontSize: '11px', opacity: 0\.7 \} \}, 'Signed out'\)/);
    // Fed by the checks the app already makes: the background loop, setup, Sync now.
    expect((app.match(/noteSyncAuth\(providerId, authStatus\);/g) || []).length).toBe(4);
  });
  test('only a definite answer counts: a check that never reached the service changes nothing', () => {
    expect(app).toContain("else if (authStatus.status === 401 || authStatus.status === 403 || authStatus.tokenRejected");
    expect(app).toContain('if (out === null) return;');
  });
});
