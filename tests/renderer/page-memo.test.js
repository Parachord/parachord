/**
 * Pages as React.memo'd modules (Track 2b state-domain split; performance:
 * every Parachord setState used to re-render the page on screen too): the
 * Collection page, the Home page, the playlist view, the artist page and Search. A memo only helps while every prop is stable unless its data
 * changed, and that is easy to break silently: pass one function defined in
 * the component body, or one object literal, and the page re-renders on
 * every Parachord render again with nothing failing. These tests pin it.
 */

const fs = require('fs');
const path = require('path');
const espree = require('espree');
const eslintScope = require('eslint-scope');

const ROOT = path.join(__dirname, '..', '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

global.React = global.React || require('react');
global.ReactVirtual = global.ReactVirtual || require('@tanstack/react-virtual');
const { CollectionPage, COLLECTION_PAGE_HANDLERS } = require('../../src/renderer/components/collection-page');
const { HomePage, HOME_PAGE_HANDLERS } = require('../../src/renderer/components/home-page');
const { PlaylistViewPage, PLAYLIST_VIEW_PAGE_HANDLERS } = require('../../src/renderer/components/playlist-view-page');
const { PlaylistsPage, PLAYLISTS_PAGE_HANDLERS } = require('../../src/renderer/components/playlists-page');
const { ArtistPage, ARTIST_PAGE_HANDLERS } = require('../../src/renderer/components/artist-page');
const { SearchPage, SEARCH_PAGE_HANDLERS } = require('../../src/renderer/components/search-page');
const { FreshDropsPage, FRESH_DROPS_PAGE_HANDLERS } = require('../../src/renderer/components/fresh-drops-page');
const { RecommendationsPage, RECOMMENDATIONS_PAGE_HANDLERS } = require('../../src/renderer/components/recommendations-page');
const { ConcertsPage, CONCERTS_PAGE_HANDLERS } = require('../../src/renderer/components/concerts-page');
const { ChartsPage, CHARTS_PAGE_HANDLERS } = require('../../src/renderer/components/charts-page');
const { CriticsPicksPage, CRITICS_PICKS_PAGE_HANDLERS } = require('../../src/renderer/components/critics-picks-page');
const { HistoryPage, HISTORY_PAGE_HANDLERS } = require('../../src/renderer/components/history-page');
const { FriendHistoryPage, FRIEND_HISTORY_PAGE_HANDLERS } = require('../../src/renderer/components/friend-history-page');
const { ResultsPanel, RESULTS_PANEL_HANDLERS } = require('../../src/renderer/components/results-panel');
const { QueueDrawer, QUEUE_DRAWER_HANDLERS } = require('../../src/renderer/components/queue-drawer');
const { AddToPlaylistPanel, ADD_TO_PLAYLIST_PANEL_HANDLERS } = require('../../src/renderer/components/add-to-playlist-panel');
const { SyncSetupDialog, SYNC_SETUP_DIALOG_HANDLERS } = require('../../src/renderer/components/sync-setup-dialog');
const { SyncStatusDialog, SYNC_STATUS_DIALOG_HANDLERS } = require('../../src/renderer/components/sync-status-dialog');
const { SettingsPage, SETTINGS_PAGE_HANDLERS } = require('../../src/renderer/components/settings-page');
const { Playbar, PLAYBAR_HANDLERS } = require('../../src/renderer/components/playbar');
const { Sidebar, SIDEBAR_HANDLERS } = require('../../src/renderer/components/sidebar');
const { PluginSettingsDialog, PLUGIN_SETTINGS_DIALOG_HANDLERS } = require('../../src/renderer/components/plugin-settings-dialog');
const { FirstRunTutorial, FIRST_RUN_TUTORIAL_HANDLERS } = require('../../src/renderer/components/first-run-tutorial');
const { ExternalTrackPrompt, EXTERNAL_TRACK_PROMPT_HANDLERS } = require('../../src/renderer/components/external-track-prompt');
const { UnsavedFriendDialog, UNSAVED_FRIEND_DIALOG_HANDLERS } = require('../../src/renderer/components/unsaved-friend-dialog');
const { NewPlaylistDialog, NEW_PLAYLIST_DIALOG_HANDLERS } = require('../../src/renderer/components/new-playlist-dialog');
const { QueueSaveDialog, QUEUE_SAVE_DIALOG_HANDLERS } = require('../../src/renderer/components/queue-save-dialog');
const { UrlImportDialog, URL_IMPORT_DIALOG_HANDLERS } = require('../../src/renderer/components/url-import-dialog');
const { PluginSignInDialog } = require('../../src/renderer/components/plugin-sign-in-dialog');
const { SyncDeleteDialog, SYNC_DELETE_DIALOG_HANDLERS } = require('../../src/renderer/components/sync-delete-dialog');
const { NwayMigrationDialog, NWAY_MIGRATION_DIALOG_HANDLERS } = require('../../src/renderer/components/nway-migration-dialog');
const { SyncChannelDisableDialog } = require('../../src/renderer/components/sync-channel-disable-dialog');
const { StopSyncDialog, STOP_SYNC_DIALOG_HANDLERS } = require('../../src/renderer/components/stop-sync-dialog');
const { useStableHandlers } = require('../../src/renderer/lib/stable-handlers');

const PAGES = [
  { component: 'CollectionPage', file: 'collection-page.js', handlersVar: 'collectionPageHandlers', handlers: COLLECTION_PAGE_HANDLERS, memo: CollectionPage },
  { component: 'HomePage', file: 'home-page.js', handlersVar: 'homePageHandlers', handlers: HOME_PAGE_HANDLERS, memo: HomePage },
  { component: 'PlaylistViewPage', file: 'playlist-view-page.js', handlersVar: 'playlistViewPageHandlers', handlers: PLAYLIST_VIEW_PAGE_HANDLERS, memo: PlaylistViewPage },
  { component: 'PlaylistsPage', file: 'playlists-page.js', handlersVar: 'playlistsPageHandlers', handlers: PLAYLISTS_PAGE_HANDLERS, memo: PlaylistsPage },
  { component: 'ArtistPage', file: 'artist-page.js', handlersVar: 'artistPageHandlers', handlers: ARTIST_PAGE_HANDLERS, memo: ArtistPage },
  { component: 'SearchPage', file: 'search-page.js', handlersVar: 'searchPageHandlers', handlers: SEARCH_PAGE_HANDLERS, memo: SearchPage },
  { component: 'FreshDropsPage', file: 'fresh-drops-page.js', handlersVar: 'freshDropsPageHandlers', handlers: FRESH_DROPS_PAGE_HANDLERS, memo: FreshDropsPage },
  { component: 'RecommendationsPage', file: 'recommendations-page.js', handlersVar: 'recommendationsPageHandlers', handlers: RECOMMENDATIONS_PAGE_HANDLERS, memo: RecommendationsPage },
  { component: 'ConcertsPage', file: 'concerts-page.js', handlersVar: 'concertsPageHandlers', handlers: CONCERTS_PAGE_HANDLERS, memo: ConcertsPage },
  { component: 'ChartsPage', file: 'charts-page.js', handlersVar: 'chartsPageHandlers', handlers: CHARTS_PAGE_HANDLERS, memo: ChartsPage },
  { component: 'CriticsPicksPage', file: 'critics-picks-page.js', handlersVar: 'criticsPicksPageHandlers', handlers: CRITICS_PICKS_PAGE_HANDLERS, memo: CriticsPicksPage },
  { component: 'HistoryPage', file: 'history-page.js', handlersVar: 'historyPageHandlers', handlers: HISTORY_PAGE_HANDLERS, memo: HistoryPage },
  { component: 'FriendHistoryPage', file: 'friend-history-page.js', handlersVar: 'friendHistoryPageHandlers', handlers: FRIEND_HISTORY_PAGE_HANDLERS, memo: FriendHistoryPage },
  { component: 'ResultsPanel', file: 'results-panel.js', handlersVar: 'resultsPanelHandlers', handlers: RESULTS_PANEL_HANDLERS, memo: ResultsPanel },
  { component: 'QueueDrawer', file: 'queue-drawer.js', handlersVar: 'queueDrawerHandlers', handlers: QUEUE_DRAWER_HANDLERS, memo: QueueDrawer },
  { component: 'AddToPlaylistPanel', file: 'add-to-playlist-panel.js', handlersVar: 'addToPlaylistPanelHandlers', handlers: ADD_TO_PLAYLIST_PANEL_HANDLERS, memo: AddToPlaylistPanel },
  { component: 'SyncSetupDialog', file: 'sync-setup-dialog.js', handlersVar: 'syncSetupDialogHandlers', handlers: SYNC_SETUP_DIALOG_HANDLERS, memo: SyncSetupDialog },
  { component: 'SyncStatusDialog', file: 'sync-status-dialog.js', handlersVar: 'syncStatusDialogHandlers', handlers: SYNC_STATUS_DIALOG_HANDLERS, memo: SyncStatusDialog },
  { component: 'SettingsPage', file: 'settings-page.js', handlersVar: 'settingsPageHandlers', handlers: SETTINGS_PAGE_HANDLERS, memo: SettingsPage },
  { component: 'Playbar', file: 'playbar.js', handlersVar: 'playbarHandlers', handlers: PLAYBAR_HANDLERS, memo: Playbar },
  { component: 'Sidebar', file: 'sidebar.js', handlersVar: 'sidebarHandlers', handlers: SIDEBAR_HANDLERS, memo: Sidebar },
  { component: 'PluginSettingsDialog', file: 'plugin-settings-dialog.js', handlersVar: 'pluginSettingsDialogHandlers', handlers: PLUGIN_SETTINGS_DIALOG_HANDLERS, memo: PluginSettingsDialog },
  { component: 'FirstRunTutorial', file: 'first-run-tutorial.js', handlersVar: 'firstRunTutorialHandlers', handlers: FIRST_RUN_TUTORIAL_HANDLERS, memo: FirstRunTutorial },
  { component: 'ExternalTrackPrompt', file: 'external-track-prompt.js', handlersVar: 'externalTrackPromptHandlers', handlers: EXTERNAL_TRACK_PROMPT_HANDLERS, memo: ExternalTrackPrompt },
  { component: 'UnsavedFriendDialog', file: 'unsaved-friend-dialog.js', handlersVar: 'unsavedFriendDialogHandlers', handlers: UNSAVED_FRIEND_DIALOG_HANDLERS, memo: UnsavedFriendDialog },
  { component: 'NewPlaylistDialog', file: 'new-playlist-dialog.js', handlersVar: 'newPlaylistDialogHandlers', handlers: NEW_PLAYLIST_DIALOG_HANDLERS, memo: NewPlaylistDialog },
  { component: 'QueueSaveDialog', file: 'queue-save-dialog.js', handlersVar: 'queueSaveDialogHandlers', handlers: QUEUE_SAVE_DIALOG_HANDLERS, memo: QueueSaveDialog },
  { component: 'UrlImportDialog', file: 'url-import-dialog.js', handlersVar: 'urlImportDialogHandlers', handlers: URL_IMPORT_DIALOG_HANDLERS, memo: UrlImportDialog },
  { component: 'PluginSignInDialog', file: 'plugin-sign-in-dialog.js', handlersVar: null, handlers: [], memo: PluginSignInDialog },
  { component: 'SyncDeleteDialog', file: 'sync-delete-dialog.js', handlersVar: 'syncDeleteDialogHandlers', handlers: SYNC_DELETE_DIALOG_HANDLERS, memo: SyncDeleteDialog },
  { component: 'NwayMigrationDialog', file: 'nway-migration-dialog.js', handlersVar: 'nwayMigrationDialogHandlers', handlers: NWAY_MIGRATION_DIALOG_HANDLERS, memo: NwayMigrationDialog },
  { component: 'SyncChannelDisableDialog', file: 'sync-channel-disable-dialog.js', handlersVar: null, handlers: [], memo: SyncChannelDisableDialog },
  { component: 'StopSyncDialog', file: 'stop-sync-dialog.js', handlersVar: 'stopSyncDialogHandlers', handlers: STOP_SYNC_DIALOG_HANDLERS, memo: StopSyncDialog },
];

describe.each(PAGES)('$component', ({ memo }) => {
  test('is React.memo', () => {
    expect(memo.$$typeof).toBe(Symbol.for('react.memo'));
  });
});

describe('useStableHandlers', () => {
  // A minimal hook harness: one component instance, re-rendered by calling
  // the hook again with the same slots.
  function harness() {
    const slots = [];
    let i = 0;
    const realReact = global.React;
    const fakeReact = {
      useRef: (init) => { const k = i++; if (!slots[k]) slots[k] = { current: init }; return slots[k]; },
      useState: (init) => { const k = i++; if (!slots[k]) slots[k] = [typeof init === 'function' ? init() : init, () => {}]; return slots[k]; },
    };
    return (latest) => {
      i = 0;
      global.React = fakeReact;
      try { return useStableHandlers(latest); } finally { global.React = realReact; }
    };
  }

  test('keeps identities across renders and always calls the latest closure', () => {
    const render = harness();
    const first = render({ handlePlay: () => 'v1', isOnAir: (x) => x + 1 });
    const second = render({ handlePlay: () => 'v2', isOnAir: (x) => x + 2 });
    expect(second).toBe(first);
    expect(second.handlePlay).toBe(first.handlePlay);
    expect(first.handlePlay()).toBe('v2');
    expect(first.isOnAir(1)).toBe(3);
  });
});

describe.each(PAGES)('$component: the app.js call site keeps every prop stable', ({ component, file, handlersVar, handlers }) => {
  const ast = espree.parse(appSrc, { ecmaVersion: 'latest', range: true, loc: true });
  const scopes = eslintScope.analyze(ast, { ecmaVersion: 2022 });

  let call = null;
  (function walk(n) {
    if (!n || typeof n.type !== 'string' || call) return;
    if (n.type === 'CallExpression' && n.arguments[0]?.type === 'Identifier' && n.arguments[0].name === component) { call = n; return; }
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
  })(ast);

  const resolve = (identifier) => {
    for (const s of scopes.scopes) for (const r of s.references) {
      if (r.identifier === identifier) return r.resolved;
    }
    return null;
  };

  // Extracted state-domain hooks whose ObjectPattern destructures are
  // state-classified (see below). Review nit: the set is the allowlist;
  // adding a hook here is an explicit step in its extraction PR.
  const EXTRACTED_STATE_DOMAIN_HOOKS = new Set(['useVolume', 'usePlaybackQueue', 'usePlaybackEngine', 'useLocalFiles', 'useLoves']);

  // How a value prop's variable is declared, as far as identity goes.
  const stability = (variable) => {
    const def = variable?.defs[0];
    if (!def || def.node.type !== 'VariableDeclarator') return 'unknown';
    const { id, init } = def.node;
    if (id.type === 'ArrayPattern' && init?.callee?.name === 'useState') return 'state';
    // State-domain hook destructures (Track 2b): `const { currentTrack } =
    // usePlaybackQueue({...})` — the hook returns actual useState/setter
    // bindings under the same names it carried in app.js pre-extraction, so
    // the identity semantics of its keys match the ArrayPattern/useState
    // case. The allowlist is deliberate (review nit on the slice-2 PR): a
    // bare /^use[A-Z]/ match would silence the flag for any FUTURE hook that
    // returns per-render functions a memo page consumes; new extracted
    // state-domain hooks join the set explicitly when they're added.
    // Applies identically to the hook-object era (slice 3): the object
    // itself (`queueDomain = usePlaybackQueue({...})`) classifies state,
    // and destructured keys remain state through the alias branch below,
    // which resolves them back here to this CallExpression recheck.
    if (init?.type === 'CallExpression' && EXTRACTED_STATE_DOMAIN_HOOKS.has(init.callee.name)) return 'state';
    if (init?.type === 'CallExpression' && ['useRef', 'useCallback', 'useMemo', 'useStableHandlers'].includes(init.callee.name)) return init.callee.name;
    // An alias of another stable value (allResolvers = loadedResolvers).
    if (init?.type === 'Identifier') return stability(resolve(init));
    // A comparison always yields a boolean, which React.memo compares by
    // value (ArtistPage's isCompactHeader = mainContentWidth < 700).
    if (init?.type === 'BinaryExpression' && ['<', '>', '<=', '>=', '===', '!==', '==', '!='].includes(init.operator)) return 'primitive';
    return init ? init.type : 'none';
  };

  test('the call site exists', () => {
    expect(call).not.toBeNull();
    expect(call.arguments[1].type).toBe('ObjectExpression');
  });

  test('every value prop is state, a setter, a ref, or a useCallback/useMemo result', () => {
    const unstable = [];
    for (const prop of call.arguments[1].properties) {
      if (prop.type === 'SpreadElement') continue;
      const kind = stability(resolve(prop.value));
      if (!['state', 'useRef', 'useCallback', 'useMemo', 'primitive'].includes(kind)) unstable.push(`${prop.key.name} (${kind})`);
    }
    expect(unstable).toEqual([]);
  });

  test('plain functions come only through the stable-handlers spread, with the documented keys', () => {
    const spread = call.arguments[1].properties.filter((p) => p.type === 'SpreadElement');
    // A dialog with no plain-function props (SyncChannelDisableDialog) has no spread.
    if (handlers.length === 0) { expect(spread).toEqual([]); return; }
    expect(spread.map((s) => s.argument.name)).toEqual([handlersVar]);
    expect(stability(resolve(spread[0].argument))).toBe('useStableHandlers');

    let handlersCall = null;
    (function walk(n) {
      if (!n || typeof n.type !== 'string' || handlersCall) return;
      if (n.type === 'VariableDeclarator' && n.id.name === handlersVar) { handlersCall = n.init; return; }
      for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
    })(ast);
    const keys = handlersCall.arguments[0].properties.map((p) => p.key.name).sort();
    expect(keys).toEqual([...handlers].sort());
  });

  test('the page destructures exactly what the call site passes', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'components', file), 'utf8');
    const destructure = page.match(/const \{\n([\s\S]*?)\n {2}\} = props;/)[1]
      .split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean).sort();
    // `_`-prefixed props are memo invalidators the page reads only through a
    // stable handler (HomePage's _metaServices); the page does not destructure them.
    const passed = call.arguments[1].properties
      .filter((p) => p.type !== 'SpreadElement' && !p.key.name.startsWith('_'))
      .map((p) => p.key.name);
    expect(destructure).toEqual([...passed, ...handlers].sort());
  });
});

// The handlers hook reads each function when the component renders, so a
// function declared below it with const is in the temporal dead zone: the
// app throws on its first render ("Cannot access 'x' before
// initialization"). Recommendations' hook first sat above the service-
// playlist functions it passes (#1451).
describe.each(PAGES)('$component: every handler is declared above its useStableHandlers hook', ({ handlersVar, handlers }) => {
  test('no handler is read in the TDZ', () => {
    if (handlers.length === 0) return;
    const hookAt = appSrc.indexOf(`const ${handlersVar} = useStableHandlers(`);
    expect(hookAt).toBeGreaterThan(-1);
    const late = handlers.filter((name) => {
      const m = new RegExp(`\\n {2}(?:const|let) ${name} = |\\n {2}(?:async )?function ${name}\\(`).exec(appSrc);
      // Declared outside the component body (a require or a hook destructure): not this rule's concern.
      return m && m.index > hookAt;
    });
    expect(late).toEqual([]);
  });
});
