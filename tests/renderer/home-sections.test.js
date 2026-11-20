/**
 * Home section components: hover actions per asset type, the source filter,
 * the Ask box, and the theme rule (no hard-coded neutrals).
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
global.ReactDOM = require('react-dom');
const { renderToStaticMarkup } = require('react-dom/server');

const COMP = path.join(__dirname, '..', '..', 'src', 'renderer', 'components');
const S = require('../../src/renderer/components/home-sections');
const h = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const count = (html, re) => (html.match(re) || []).length;

describe('AlbumCard', () => {
  const album = { title: 'Frog', artist: 'Hovvdy', imageUrl: 'https://x/y.jpg', tag: 'Out Friday' };
  // The shared card shows an action only when its handler is passed (Home's rows pass all three).
  const acts = { onPlay() {}, onQueue() {}, onAddToPlaylist() {} };
  test('has the three labelled actions', () => {
    const html = h(S.AlbumCard, { album, ...acts });
    expect(html).toContain('aria-label="Add Frog to a playlist"');
    expect(html).toContain('aria-label="Play Frog"');
    expect(html).toContain('aria-label="Add Frog to the queue"');
    expect(count(html, /<button/g)).toBeGreaterThanOrEqual(3);
  });
  test('the hover is the app\'s card hover: the overlay and buttons the old CollectionAlbumCard had, in its order', () => {
    const cards = fs.readFileSync(path.join(COMP, 'card-art.js'), 'utf8');
    const overlay = 'absolute inset-0 bg-black/50';
    const side = 'w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110';
    const play = 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110';
    for (const cls of [overlay, side, play, 'transition-opacity duration-base flex items-center justify-center gap-3']) expect(cards).toContain(cls);
    const html = h(S.AlbumCard, { album, ...acts });
    expect(html).toMatch(/data-art-actions[^>]*class="absolute inset-0 bg-black\/50 transition-opacity duration-base flex items-center justify-center gap-3"[^>]*opacity:0/);
    // The side buttons' tint and hover are classes now (not JS hover).
    expect(html).toMatch(new RegExp(`aria-label="Add Frog to a playlist"[^>]*class="${side} bg-white/15 hover:bg-white/25 text-white"`));
    expect(html).toMatch(new RegExp(`aria-label="Play Frog"[^>]*class="${play}"`));
    expect(html.indexOf('Add Frog to a playlist')).toBeLessThan(html.indexOf('aria-label="Play Frog"'));
    expect(html.indexOf('aria-label="Play Frog"')).toBeLessThan(html.indexOf('Add Frog to the queue'));
  });
  test('on a narrow card the buttons shrink in proportion and stay round, the overlay padded 8px', () => {
    const html = h(S.AlbumCard, { album, ...acts });
    expect(count(html, /flex-shrink:1;min-width:0;height:auto;aspect-ratio:1/g)).toBe(3);
    expect(html).toMatch(/data-art-actions[^>]*padding:8px;box-sizing:border-box/);
  });
  test('an album card names no source: no badge on an ordinary album, and no source line', () => {
    const html = h(S.AlbumCard, { album: { ...album, resolverId: 'lastfm', why: 'Last.fm · like Hovvdy' } });
    expect(html).not.toContain('Why Shuffleupagus');
    expect(html).not.toContain('Last.fm');
    expect(h(S.AlbumCard, { album: { ...album, resolverId: 'amazonmusic', why: 'Amazon Music' } })).not.toContain('Amazon Music');
  });
  test('a Shuffleupagus album has a focusable icon badge and no reason line', () => {
    const html = h(S.AlbumCard, { album: { ...album, resolverId: 'shuffleupagus', reason: 'Because you love slowcore', why: 'Shuffleupagus · Because you love slowcore' } });
    expect(html).toMatch(/<button[^>]*aria-label="Why Shuffleupagus picked this"/);
    expect(html).toMatch(/aria-label="Why Shuffleupagus picked this"[^>]*>.*<svg[^>]*width="18"/);
    expect(html).not.toContain('Shuffleupagus ·');
  });
  test('the badge sits in the art\'s lower right corner, clear of the top-left tag', () => {
    const html = h(S.AlbumCard, { album: { ...album, tag: 'New', resolverId: 'shuffleupagus', reason: 'r' } });
    expect(html).toMatch(/bottom:8px;right:8px;z-index:3/);
    expect(html).not.toMatch(/top:8px;left:8px;z-index:2/);
  });
  test('the badge reason reaches screen readers: aria-describedby names a hidden copy', () => {
    const html = h(S.AlbumCard, { album: { ...album, resolverId: 'shuffleupagus', reason: 'Because you love slowcore' } });
    const id = (html.match(/aria-describedby="([^"]+)"/) || [])[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>Because you love slowcore<`));
  });
  test('the badge wrapper is a div, never a div inside a span', () => {
    const html = h(S.AlbumCard, { album: { ...album, resolverId: 'shuffleupagus', reason: 'r' } });
    expect(html).not.toMatch(/<span[^>]*><div/);
  });
  test('a Critical Darlings pick badges only when it has a summary', () => {
    const pick = { title: 'Valentine', artist: 'CMA', homeRow: 'critical' };
    expect(h(S.AlbumCard, { album: pick })).not.toContain('What the critics said');
    const html = h(S.AlbumCard, { album: { ...pick, description: 'A quiet masterpiece.' } });
    expect(html).toMatch(/<button[^>]*aria-label="What the critics said"/);
    // The same Shuffleupagus badge as Shuffleupagus's picks, not a trophy.
    const shuffle = h(S.AlbumCard, { album: { title: 'X', artist: 'Y', resolverId: 'shuffleupagus', reason: 'r' } });
    const icon = (s2, label) => (s2.match(new RegExp(`aria-label="${label}"[^>]*>(<svg[\\s\\S]*?</svg>)`)) || [])[1];
    expect(icon(html, 'What the critics said')).toMatch(/width="18"/);
    expect(icon(html, 'What the critics said')).toBe(icon(shuffle, 'Why Shuffleupagus picked this'));
  });
  test('shows the artist', () => {
    expect(h(S.AlbumCard, { album })).toContain('Hovvdy');
  });
  test('a Fresh Drops card wears the Fresh Drops page\'s release-type badge, top right', () => {
    const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages / panels moved out of it (#1451)
    // One badge for both: the Fresh Drops page hands its release type to the
    // shared AlbumCard, which draws card-art.js's releaseBadge, the badge
    // Home's Fresh Drops row wears too.
    // The Fresh Drops page (components/fresh-drops-page.js, #1451).
    const freshDrops = fs.readFileSync(path.join(COMP, 'fresh-drops-page.js'), 'utf8');
    expect(freshDrops).toMatch(/e\(AlbumCard, Object\.assign\(\{[\s\S]{0,600}?releaseType: release\.releaseType,/);
    const { RELEASE_BADGE_BG } = require('../../src/renderer/components/card-art');
    // The album page's palette (lib/release-types.js) at 90%, every type.
    expect(RELEASE_BADGE_BG.album).toBe('color-mix(in srgb, rgb(99, 102, 241) 90%, transparent)');
    expect(RELEASE_BADGE_BG.live).toBe('color-mix(in srgb, #d97706 90%, transparent)');
    expect(RELEASE_BADGE_BG.compilation).toBe('color-mix(in srgb, #0eb3a0 90%, transparent)');
    const badge = (releaseType) => {
      const html = h(S.AlbumCard, { album: { ...album, homeRow: 'fresh', releaseType } });
      return (html.match(/<div style="position:absolute;top:8px;right:8px"><span class="release-badge" style="([^"]*)">([^<]*)<\/span>/) || []).slice(1);
    };
    expect(badge('album')).toEqual(['background-color:color-mix(in srgb, rgb(99, 102, 241) 90%, transparent);color:white', 'Album']);
    expect(badge('ep')).toEqual(['background-color:color-mix(in srgb, #a855f7 90%, transparent);color:white', 'EP']);
    expect(badge('single')).toEqual(['background-color:color-mix(in srgb, #db2777 90%, transparent);color:white', 'Single']);
    // Live has its own colour (it wore Single's pink before).
    expect(badge('live')).toEqual(['background-color:color-mix(in srgb, #d97706 90%, transparent);color:white', 'Live']);
    // No date chip, and no badge outside Fresh Drops or without a type.
    expect(h(S.AlbumCard, { album: { ...album, homeRow: 'fresh', releaseType: 'album' } })).not.toContain('Out Friday');
    expect(h(S.AlbumCard, { album: { ...album, releaseType: 'album' } })).not.toContain('release-badge');
    expect(h(S.AlbumCard, { album: { ...album, homeRow: 'fresh' } })).not.toContain('release-badge');
  });
});

describe('PlaylistCard', () => {
  test('with an add-to-playlist handler it shows the full app trio, as the Playlists page does', () => {
    const html = h(S.PlaylistCard, { playlist: { id: 'p', title: 'Pl', imageUrl: 'https://img/p.jpg' }, onAddToPlaylist: () => {}, onPlay() {}, onQueue() {} });
    const add = html.indexOf('Add Pl to a playlist');
    expect(add).toBeGreaterThan(-1);
    expect(add).toBeLessThan(html.indexOf('aria-label="Play Pl"'));
  });
  test('takes the same app hover as albums: Play, then Add to Queue (Home has no add-to-playlist for a playlist)', () => {
    const html = h(S.PlaylistCard, { playlist: { id: 'p', title: 'Pl', imageUrl: 'https://img/p.jpg' }, onPlay() {}, onQueue() {} });
    expect(html).toMatch(/data-art-actions[^>]*class="absolute inset-0 bg-black\/50 transition-opacity duration-base flex items-center justify-center gap-3"/);
    expect(html).toMatch(/aria-label="Play Pl"[^>]*class="w-12 h-12 bg-white rounded-full/);
    expect(html.indexOf('aria-label="Play Pl"')).toBeLessThan(html.indexOf('Add Pl to the queue'));
    expect(html).not.toContain('to a playlist');
  });
  const playlist = { id: 'p1', title: 'Daily Brew', mosaic: ['https://a/1.jpg', 'https://a/2.jpg'] };
  test('has Play and Add to Queue only', () => {
    // Each action shows when its handler is passed (Home passes Play and Queue).
    const html = h(S.PlaylistCard, { playlist, badge: 'Δ 12', subtitle: 'Refreshed 2h ago', onPlay() {}, onQueue() {} });
    expect(html).toContain('aria-label="Play Daily Brew"');
    expect(html).toContain('aria-label="Add Daily Brew to the queue"');
    expect(html).not.toContain('to a playlist');
    expect(html).toContain('Δ 12');
    expect(html).toContain('Refreshed 2h ago');
  });
  test('no badge when none given', () => {
    expect(h(S.PlaylistCard, { playlist })).not.toContain('+');
  });
});

describe('SourceFilter', () => {
  test('chips carry aria-pressed', () => {
    const html = h(S.SourceFilter, { sources: ['All', 'Last.fm'], value: 'Last.fm' });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });
});

describe('SourceFilter colours', () => {
  const sources = [{ id: 'All', label: 'All' }, { id: 'amazonmusic', label: 'Amazon Music', color: '#25D1DA' }, { id: 'x', label: 'X' }];
  test('an idle chip shows a dot in the service colour', () => {
    const html = h(S.SourceFilter, { sources, value: 'All' });
    expect(html).toMatch(/data-chip-dot[^>]*background-color:#25D1DA/);
    expect(html).toContain('background-color:var(--text-secondary)');
  });
  test('the selected chip fills with the colour and reads on it', () => {
    const html = h(S.SourceFilter, { sources, value: 'amazonmusic' });
    expect(html).toMatch(/aria-pressed="true"[^>]*background-color:#25D1DA;color:var\(--on-art-ink\)/);
    expect(html).not.toMatch(/data-chip-dot[^>]*#25D1DA/);
  });
  test('All stays neutral and has no dot', () => {
    const html = h(S.SourceFilter, { sources, value: 'All' });
    expect(html).toMatch(/aria-pressed="true"[^>]*background-color:var\(--accent-fill\)/);
  });
});

describe('JumpBackIn', () => {
  test('a tile opens; its art takes the app\'s card hover with Play alone', () => {
    const tiles = [{ kind: 'loves', item: [], subtitle: 'Your recent loves' }];
    const html = h(S.JumpBackIn, { tiles });
    expect(html).toContain('aria-label="Open Recent Loves"');
    expect(html).toMatch(/data-art-actions[^>]*class="absolute inset-0 bg-black\/50[^"]*"[^>]*opacity:0/);
    expect(html).toMatch(/aria-label="Play Recent Loves"[^>]*class="w-12 h-12 bg-white rounded-full/);
    expect(html).not.toContain('to the queue');
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/);
  });
  test('with no tiles, the import card shows only for a new user', () => {
    expect(h(S.JumpBackIn, { tiles: [], showImport: true })).toContain('Import');
    expect(h(S.JumpBackIn, { tiles: [], showImport: false })).toBe('');
  });
  test('a playlist tile with no covers yet shows the playlist glyph, not an empty box', () => {
    const html = h(S.JumpBackIn, { tiles: [{ kind: 'playlist', item: { id: 'p', title: 'Hosted' }, subtitle: 'Playlist' }] });
    expect(html).toContain('data-playlist-glyph');
  });
  test('the grid is four across when wide and two by two when narrow, shared with the skeleton', () => {
    const { HOME_JUMP_GRID } = require('../../src/renderer/components/home-skeletons');
    const html = h(S.JumpBackIn, { tiles: [{ kind: 'loves', item: [], subtitle: 'x' }] });
    expect(html).toContain(`grid-template-columns:${HOME_JUMP_GRID}`);
    expect(HOME_JUMP_GRID).toMatch(/^repeat\(auto-fit, minmax\(clamp\(calc\(25% - 10px\), calc\(\(920px - 100%\) \* 999\), calc\(50% - 7px\)\), 1fr\)\)$/);
  });
});

describe('JumpTile hover contrast', () => {
  const find = (node, pred) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const n of node) { const f = find(n, pred); if (f) return f; } return null; }
    if (node.props && pred(node)) return node;
    return find(node.props && node.props.children, pred);
  };
  const subtitleColor = (hovered) => {
    const tile = { kind: 'loves', item: [], subtitle: 'Your recent loves' };
    const jt = find(S.JumpBackIn({ tiles: [tile] }), (n) => n.props.tile === tile);
    const real = global.React;
    global.React = { ...real, useState: () => [hovered, () => {}] };
    try {
      const inner = jt.type(jt.props);
      return find(inner, (n) => n.props['data-jump-subtitle'] === '').props.style.color;
    } finally { global.React = real; }
  };
  test('the subtitle is secondary at rest and primary on the hover fill (4.5:1 in light mode)', () => {
    expect(subtitleColor(false)).toBe('var(--text-secondary)');
    expect(subtitleColor(true)).toBe('var(--text-primary)');
  });
});

describe('JumpBackIn handlers', () => {
  // Walk the element tree: plain function components are called, so the
  // handlers on the rendered buttons can be fired.
  const find = (node, pred) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const n of node) { const f = find(n, pred); if (f) return f; } return null; }
    if (node.props && pred(node)) return node;
    return find(node.props && node.props.children, pred);
  };
  test('Open calls onOpenTile and Play calls onPlayTile, not each other', () => {
    const tile = { kind: 'playlist', item: { id: 'p', title: 'Daily' }, subtitle: 'Playlist' };
    const onOpenTile = jest.fn();
    const onPlayTile = jest.fn();
    const tree = S.JumpBackIn({ tiles: [tile], onOpenTile, onPlayTile });
    const jt = find(tree, (n) => n.props.tile === tile);
    const real = global.React;
    global.React = { ...real, useState: (v) => [v, () => {}] };
    let inner;
    try { inner = jt.type(jt.props); } finally { global.React = real; }
    find(inner, (n) => n.props['aria-label'] === 'Open Daily').props.onClick();
    expect(onOpenTile).toHaveBeenCalledWith(tile);
    expect(onPlayTile).not.toHaveBeenCalled();
    const overlay = find(inner, (n) => typeof n.props.onPlay === 'function');
    overlay.props.onPlay();
    expect(onPlayTile).toHaveBeenCalledWith(tile);
    expect(onOpenTile).toHaveBeenCalledTimes(1);
    overlay.props.onClick();
    expect(onOpenTile).toHaveBeenCalledTimes(2);
  });
});

describe('Rows', () => {
  test('See all links carry an aria-label', () => {
    const html = h(S.PlaylistsRow, { playlists: [{ id: 'a', title: 'A' }], navigateTo: () => {} });
    expect(html).toContain('aria-label="See all in Playlists"');
  });
  test('Recent Loves leads Made from your listening under All', () => {
    const loves = { id: 'recent-loves', title: 'Recent Loves', subtitle: 'Your 50 latest loves' };
    const alone = h(S.MixesRow, { mixes: [], loves });
    expect(alone).toContain('aria-label="Open Recent Loves"');
    expect(alone).not.toContain('Filter mixes by source');
    const mixes = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, title: `Mix ${i}`, resolverId: 'listenbrainz', serviceLabel: 'ListenBrainz', resolverName: 'ListenBrainz' }));
    const html = h(S.MixesRow, { mixes, loves, lovesActions: { onOpen: () => {}, onPlay: () => {}, onQueue: () => {}, onAddToPlaylist: () => {} } });
    const opens = html.match(/aria-label="Open [^"]*"/g);
    expect(opens[0]).toBe('aria-label="Open Recent Loves"');
    expect(opens).toHaveLength(6); // loves plus five mixes fill the row
    expect(html).toContain('aria-label="Add Recent Loves to a playlist"');
    expect(html).toContain('Your 50 latest loves');
    // Not a service, so it adds no filter chip.
    expect(html.match(/aria-pressed=/g)).toHaveLength(2); // All, ListenBrainz
  });
  test('a service chip shows only that service\'s mixes: Recent Loves steps out', () => {
    const loves = { id: 'recent-loves', title: 'Recent Loves', subtitle: 'Your 50 latest loves' };
    const mixes = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, title: `Mix ${i}`, resolverId: 'listenbrainz', resolverName: 'ListenBrainz' }));
    // Render the row as if the ListenBrainz chip were picked.
    const real = global.React;
    global.React = { ...real, useState: (v) => [v === 'All' ? 'listenbrainz' : v, () => {}] };
    let tree;
    try { tree = S.MixesRow({ mixes, loves, lovesActions: {} }); } finally { global.React = real; }
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain('Recent Loves');
    expect(html.match(/aria-label="Open [^"]*"/g)).toHaveLength(6); // six ListenBrainz mixes fill the row
    expect(html).toMatch(/aria-pressed="true"[^>]*>(?:<span[^>]*><\/span>)?ListenBrainz/);
  });
  test('Mixes row has no See all', () => {
    const html = h(S.MixesRow, { mixes: [{ id: 'm', title: 'Heavy Rotation', resolverId: 'applemusic', resolverName: 'Apple Music' }] });
    expect(html).not.toContain('See all');
    expect(html).toContain('Heavy Rotation');
    // The card names its service.
    expect(html).toContain('Apple Music');
  });
  test('a selected source chip that is gone falls back to All', () => {
    const spy = jest.spyOn(React, 'useState').mockImplementation(() => ['lastfm', () => {}]);
    try {
      const mixes = h(S.MixesRow, { mixes: [{ id: 'm', title: 'Heavy Rotation', resolverId: 'applemusic', resolverName: 'Apple Music' }] });
      expect(mixes).toContain('Heavy Rotation');
      const albums = h(S.AlbumsRow, { albums: [{ title: 'Frog', artist: 'Hovvdy', resolverId: 'listenbrainz' }], navigateTo: () => {} });
      expect(albums).toContain('Frog');
    } finally { spy.mockRestore(); }
  });
  test('a mix card names no service on its art: the source filter does that', () => {
    const one = h(S.MixesRow, { mixes: [{ id: 'm', title: 'Heavy Rotation', resolverId: 'applemusic', serviceLabel: 'Apple Music', resolverName: 'Apple Music' }] });
    expect(one.match(/Apple Music/g)).toHaveLength(1);
    const two = h(S.MixesRow, { mixes: [
      { id: 'm', title: 'Heavy Rotation', resolverId: 'applemusic', serviceLabel: 'Apple Music', resolverName: 'Apple Music' },
      { id: 'n', title: 'Weekly Jams', resolverId: 'listenbrainz', serviceLabel: 'ListenBrainz', resolverName: 'ListenBrainz' },
    ] });
    // Each name once: in its filter chip, not on the card.
    expect(two.match(/Apple Music/g)).toHaveLength(1);
    expect(two.match(/ListenBrainz/g)).toHaveLength(1);
  });
  test('each See all takes its page\'s sidebar colour', () => {
    const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages / panels moved out of it (#1451)
    // The sidebar's colours for those pages, which the links copy.
    // The sidebar and the links read the same map (lib/page-colors.js).
    const { PAGE_COLORS } = require('../../src/renderer/lib/page-colors');
    expect(PAGE_COLORS.playlists.color).toBe('var(--page-playlists)');
    expect(PAGE_COLORS.recommendations.color).toBe('var(--page-recommendations)');
    expect(PAGE_COLORS.concerts.color).toBe('var(--page-concerts)');
    // The sidebar's NavItem colours its current page from the same map.
    expect(fs.readFileSync(path.join(COMP, 'nav-item.js'), 'utf8')).toContain("color: active ? colors.color : 'var(--nav-inactive)',");
    for (const key of ['playlists', 'recommendations', 'concerts']) expect(app).toMatch(new RegExp(`React\\.createElement\\(NavItem, \\{\\s*page: '${key}'`));
    const link = (html, page) => (html.match(new RegExp(`aria-label="See all in ${page}"[^>]*style="[^"]*color:(var\\(--page-[a-z-]+\\))`)) || [])[1];
    expect(link(h(S.PlaylistsRow, { playlists: [{ id: 'a', title: 'A' }], navigateTo: () => {} }), 'Playlists')).toBe('var(--page-playlists)');
    expect(link(h(S.AlbumsRow, { albums: [{ title: 'T', artist: 'A', resolverId: 'lastfm' }], navigateTo: () => {} }), 'Recommendations')).toBe('var(--page-recommendations)');
    expect(link(h(S.ConcertsRow, { concerts: [{ id: 'c', artist: 'A', date: '2099-01-01', venue: { name: 'V', city: 'C' } }], navigateTo: () => {} }), 'Concerts')).toBe('var(--page-concerts)');
  });
  test('Albums row see-all goes to Recommendations', () => {
    const html = h(S.AlbumsRow, { albums: [{ title: 'T', artist: 'A', resolverId: 'lastfm' }], navigateTo: () => {} });
    expect(html).toContain('aria-label="See all in Recommendations"');
  });
  test('Fresh and critical halves hide independently', () => {
    const html = h(S.FreshCriticalRow, { fresh: [{ title: 'T', artist: 'A' }], critical: [], navigateTo: () => {} });
    expect(html).toContain('aria-label="See all in Fresh Drops"');
    expect(html).not.toContain('Critical Darlings');
  });
  test('a half that is still loading draws its skeleton in place beside the other half', () => {
    const html = h(S.FreshCriticalRow, { fresh: [{ title: 'T', artist: 'A' }], critical: [], criticalLoading: true, navigateTo: () => {} });
    const fresh = html.indexOf('id="home-fresh"');
    const critical = html.indexOf('id="home-critical"');
    expect(fresh).toBeGreaterThan(-1);
    expect(critical).toBeGreaterThan(fresh);
    expect((html.slice(critical).match(/aspect-square/g) || []).length).toBe(3);
    expect(html).toMatch(/aria-labelledby="home-critical" aria-busy="true"/);
    expect(html.slice(fresh, critical)).not.toContain('animate-shimmer');
  });
  test('each half keeps a fixed half-width basis, alone or not, and the row never wraps', () => {
    const { HOME_HALF_FLEX } = require('../../src/renderer/components/home-skeletons');
    expect(HOME_HALF_FLEX).toBe('0 0 calc(50% - 16px)');
    const alone = h(S.FreshCriticalRow, { fresh: [{ title: 'T', artist: 'A' }], critical: [], navigateTo: () => {} });
    expect(alone).toContain('flex:0 0 calc(50% - 16px)');
    expect(alone.startsWith('<div style="display:flex;flex-direction:row;gap:32px">')).toBe(true);
    const loading = h(S.FreshCriticalRow, { fresh: [], critical: [], freshLoading: true, criticalLoading: true });
    expect((loading.match(/flex:0 0 calc\(50% - 16px\)/g) || []).length).toBe(2);
    // A narrow window (#1389): the halves stack, each the full row.
    const stacked = h(S.FreshCriticalRow, { stacked: true, fresh: [{ title: 'T', artist: 'A' }], critical: [{ title: 'U', artist: 'B' }], navigateTo: () => {} });
    expect(stacked.startsWith('<div style="display:flex;flex-direction:column;gap:32px">')).toBe(true);
    expect(stacked).not.toContain('calc(50% - 16px)');
  });
  test('card counts fit the content width (#1389)', () => {
    const sk = require('../../src/renderer/components/home-skeletons');
    expect(sk.homeRowCards(0)).toBe(6); // not measured yet: the spec count
    expect(sk.homeRowCards(744)).toBe(4); // the 1000px minimum window
    expect(sk.homeRowCards(1184)).toBe(6);
    expect(sk.homeConcertCards(744)).toBe(3);
    expect(sk.homeConcertCards(1184)).toBe(4);
    expect(sk.homeHalvesStacked(744)).toBe(true);
    expect(sk.homeHalvesStacked(1184)).toBe(false);
    expect(sk.homeHalvesStacked(0)).toBe(false);
  });
  test('each half opens with a hero band copied from its page\'s hero', () => {
    const app = require('../helpers/renderer-source').appWithPages(); // app.js and the pages / panels moved out of it (#1451)
    // The pages' own hero gradients and collapsed-title style, which the bands copy.
    expect(app).toContain("page: 'new-releases'");
    expect(app).toContain("page: 'critics-picks'");
    // The pages' heroes are the shared PageHero (components/page-hero.js).
    expect(require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/page-hero.js'), 'utf8')).toContain("const COLLAPSED_TITLE_STYLE = { textShadow: 'var(--hero-text-shadow-bar)', letterSpacing: '0.2em', textTransform: 'uppercase' };");
    const html = h(S.FreshCriticalRow, { fresh: [{ title: 'T', artist: 'A' }], critical: [{ title: 'U', artist: 'B' }], navigateTo: () => {} });
    const sections = html.split('<section').slice(1);
    expect(sections).toHaveLength(2);
    const band = (sec) => (sec.match(/<div data-home-hero="" class="([^"]*)"/) || [])[1];
    const { PAGE_COLORS: PC } = require('../../src/renderer/lib/page-colors');
    expect(band(sections[0])).toBe(PC['new-releases'].hero);
    expect(band(sections[1])).toBe(PC['critics-picks'].hero);
    for (const sec of sections) {
      // A bordered card on the page background; the cards sit below the band.
      expect(sec).toMatch(/^[^>]*border-radius:16px;overflow:hidden;border:1px solid var\(--border-default\);background-color:var\(--bg-primary\)/);
      expect(sec).toMatch(/<h2 id="home-(fresh|critical)" style="[^"]*font-weight:300;letter-spacing:0\.2em;text-transform:uppercase;color:var\(--on-accent\);text-shadow:var\(--hero-text-shadow-bar\)"/);
      expect(sec).toMatch(/aria-label="See all in (Fresh Drops|Critical Darlings)"[^>]*color:var\(--on-accent\)[^>]*>See all</);
      expect(sec.indexOf('data-home-hero')).toBeLessThan(sec.indexOf('Open '));
    }
    expect(sections[0]).toContain('Fresh Drops');
    expect(sections[1]).toContain('Critical Darlings');
    // A half still loading keeps its band, with the skeleton below it where the cards will be.
    const loading = h(S.FreshCriticalRow, { fresh: [], critical: [], freshLoading: true, criticalLoading: true });
    expect(loading.split('<section').slice(1).every((sec) => sec.includes('data-home-hero'))).toBe(true);
  });

  test('neither half: nothing', () => {
    expect(h(S.FreshCriticalRow, { fresh: [], critical: [] })).toBe('');
  });
  test('the Albums row has no refresh control (the Recommendations page keeps its own)', () => {
    const html = h(S.AlbumsRow, { albums: [{ title: 'T', artist: 'A', resolverId: 'lastfm' }], onRefresh: () => {}, refreshing: true });
    expect(html).not.toMatch(/Refresh suggestions|Refreshing suggestions|animate-spin/);
  });
  test('a playlist card with no covers shows the playlist glyph', () => {
    expect(h(S.PlaylistCard, { playlist: { id: 'p', title: 'P' } })).toContain('data-playlist-glyph');
    expect(h(S.PlaylistCard, { playlist: { id: 'p', title: 'P', mosaic: ['a', 'b', 'c', 'd'] } })).not.toContain('data-playlist-glyph');
    expect(h(S.AlbumCard, { album: { title: 'T', artist: 'A' } })).not.toContain('data-playlist-glyph');
  });
  test('Concert card shows date, artist, venue, city', () => {
    const concerts = [{ id: 'c1', date: '2026-12-05', artist: 'Hovvdy', venue: { name: 'Lodge Room', city: 'Los Angeles' }, ticketSources: [{ source: 'songkick', ticketUrl: 'https://t' }] }];
    const html = h(S.ConcertsRow, { concerts, navigateTo: () => {} });
    expect(html).toContain('Hovvdy');
    expect(html).toContain('Lodge Room');
    expect(html).toContain('Los Angeles');
    expect(html).toContain('Tickets');
    expect(html).toContain('aria-label="See all in Concerts"');
  });
  test('the venue and the city / state are separate lines', () => {
    const concerts = [{ id: 'c1', date: '2026-12-05', artist: 'Hovvdy', venue: { name: 'Lodge Room', city: 'Los Angeles', region: 'CA' } }];
    const html = h(S.ConcertsRow, { concerts, navigateTo: () => {} });
    expect(html).toMatch(/>Lodge Room<\/span><span[^>]*>Los Angeles, CA<\/span>/);
    expect(html).not.toContain(' · ');
    // No city: the venue line alone, no empty line under it.
    const bare = h(S.ConcertsRow, { concerts: [{ ...concerts[0], venue: { name: 'Lodge Room' } }], navigateTo: () => {} });
    expect(bare).toMatch(/>Lodge Room<\/span>(?!<span)/);
  });
});

describe('Concert cards', () => {
  const base = { id: 'c1', date: '2026-12-05', artist: 'Hovvdy', venue: { name: 'Lodge Room' } };
  const sellers2 = [
    { source: 'songkick', label: 'Songkick', ticketUrl: 'https://s' },
    { source: 'seatgeek', label: 'SeatGeek', ticketUrl: 'https://g' },
  ];
  const walk = (node, out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
    if (node.props) { out.push(node); walk(node.props.children, out); }
    return out;
  };
  // #1572: the card opens the artist's On Tour tab, as the Concerts page's
  // cards do; Tickets stays its own action, above the card's button.
  test("the card is a CardButton named Open <artist>; activating it opens the artist's On Tour tab", () => {
    const opened = [];
    const tree = S.ConcertsRow({ concerts: [{ ...base, ticketSources: [sellers2[0]] }], onOpenArtist: (a) => opened.push(a) });
    const card = walk(tree).find((n) => n.props && n.props.concert);
    expect(card.props.onOpenArtist).toEqual(expect.any(Function));
    const el = card.type(card.props);
    expect(el.props.label).toBe('Open Hovvdy');
    el.props.onActivate();
    expect(opened).toEqual(['Hovvdy']);
    const html = h(S.ConcertsRow, { concerts: [{ ...base, ticketSources: [sellers2[0]] }], onOpenArtist: () => {} });
    expect(html).toMatch(/<button type="button" class="card-button-hit no-drag" aria-label="Open Hovvdy"/);
  });
  test('Tickets sits above the card button (card-link), so it opens only the ticket link', () => {
    const html = h(S.ConcertsRow, { concerts: [{ ...base, ticketSources: [sellers2[0]] }], onOpenArtist: () => {} });
    expect(html).toMatch(/class="card-link"[^>]*><a href="https:\/\/s"[^>]*>Tickets<\/a>/);
    // Tickets comes before the stretched button in the markup but is drawn
    // above it (index.html's .card-button .card-link: z-index 2).
    const css = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    expect(css).toMatch(/\.card-button \.card-link \{ position: relative; z-index: 2; \}/);
  });
  test('the card keeps its box (the skeleton matches it)', () => {
    const tree = S.ConcertsRow({ concerts: [base], onOpenArtist: () => {} });
    const card = walk(tree).find((n) => n.props && n.props.concert);
    const style = card.type(card.props).props.style;
    expect(style).toMatchObject({ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderRadius: '16px', border: '1px solid var(--border-default)' });
  });
  test("the artist's photo, face-centred, with the date as a badge on it", () => {
    const images = { hovvdy: { url: 'https://img/h.jpg', facePosition: 'center 30%' } };
    const html = h(S.ConcertsRow, { concerts: [{ ...base, artist: 'Hovvdy ' }], artistImages: images });
    expect(html).toMatch(/<img src="https:\/\/img\/h.jpg" alt=""[^>]*object-position:center 30%/);
    expect(html).toMatch(/<span style="position:absolute;left:4px;bottom:4px[^"]*">Dec 5<\/span>/);
  });
  test('no photo yet: a placeholder, the badge still there', () => {
    const html = h(S.ConcertsRow, { concerts: [base] });
    expect(html).not.toContain('<img');
    expect(html).toContain('>Dec 5</span>');
  });
  test('one seller is a direct link', () => {
    const html = h(S.ConcertsRow, { concerts: [{ ...base, ticketSources: [sellers2[0]] }] });
    expect(html).toMatch(/<a href="https:\/\/s"[^>]*>Tickets<\/a>/);
  });
  test('several sellers: Tickets opens the shared menu, closed to start', () => {
    const html = h(S.ConcertsRow, { concerts: [{ ...base, ticketSources: sellers2 }] });
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*>Tickets/);
    expect(html).not.toContain('Songkick');
  });
  test('Tickets is the shared teal button (components/tickets-button.js)', () => {
    const html = h(S.ConcertsRow, { concerts: [{ ...base, ticketSources: [sellers2[0]] }] });
    expect(html).toContain('background-color:var(--page-concerts);color:var(--on-accent)');
    expect(html).not.toContain('text-decoration:underline');
  });
  test('only http(s) ticket links reach an href', () => {
    const bad = [{ source: 'x', ticketUrl: 'javascript:alert(1)' }, { source: 'y', ticketUrl: 'data:text/html,hi' }];
    expect(h(S.ConcertsRow, { concerts: [{ ...base, ticketSources: bad }] })).not.toContain('Tickets for');
    const one = h(S.ConcertsRow, { concerts: [{ ...base, ticketSources: [bad[0], sellers2[0]] }] });
    expect(one).toMatch(/<a href="https:\/\/s"[^>]*>Tickets<\/a>/);
    expect(one).not.toContain('javascript:');
  });
});

describe('AskShuffleupagus', () => {
  test('input with label, maxLength 500 and an Ask button', () => {
    const html = h(S.AskShuffleupagus, { initialPrompt: 'A rainy Sunday', chatAvailable: true });
    expect(html).toContain('<input');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('<label');
    expect(html).toContain('value="A rainy Sunday"');
    expect(html).toContain('>Ask<');
  });
  // A minimal hook harness: one instance, re-rendered with new props; state
  // writes land at once, as React's re-render after a render-phase update.
  function askHarness() {
    const slots = [];
    let i = 0;
    const real = global.React;
    const fake = {
      ...real,
      useState: (init) => {
        const k = i++;
        if (!slots[k]) {
          const slot = [typeof init === 'function' ? init() : init];
          slot[1] = (v) => { slot[0] = typeof v === 'function' ? v(slot[0]) : v; };
          slots[k] = slot;
        }
        return [slots[k][0], slots[k][1]];
      },
      useRef: (init) => { const k = i++; if (!slots[k]) slots[k] = { current: init }; return slots[k]; },
    };
    const find = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) { for (const n of node) { const f = find(n); if (f) return f; } return null; }
      if (node.props && node.props.id === 'home-ask-prompt') return node;
      return find(node.props && node.props.children);
    };
    return (props) => {
      global.React = fake;
      try {
        let tree;
        for (let pass = 0; pass < 2; pass++) { i = 0; tree = S.AskShuffleupagus(props); }
        return find(tree);
      } finally { global.React = real; }
    };
  }
  test('a new example replaces the prompt while the field is untouched', () => {
    const render = askHarness();
    expect(render({ initialPrompt: 'Make me a playlist', chatAvailable: true }).props.value).toBe('Make me a playlist');
    expect(render({ initialPrompt: 'Songs that sound like Frog', chatAvailable: true }).props.value).toBe('Songs that sound like Frog');
  });
  test('once the user types, a new example never overwrites it', () => {
    const render = askHarness();
    const input = render({ initialPrompt: 'Make me a playlist', chatAvailable: true });
    input.props.onChange('my own words');
    expect(render({ initialPrompt: 'Make me a playlist', chatAvailable: true }).props.value).toBe('my own words');
    expect(render({ initialPrompt: 'Songs that sound like Frog', chatAvailable: true }).props.value).toBe('my own words');
  });
  test('chatAvailable false renders only the setup button', () => {
    const html = h(S.AskShuffleupagus, { initialPrompt: 'x', chatAvailable: false });
    expect(html).not.toContain('<input');
    expect(html).toContain('Set up Shuffleupagus');
  });
});

describe('theme: no hard-coded neutrals in the Home modules', () => {
  const NEUTRAL = /#(?:fff|ffffff|111827|374151|4b5563|6b7280|9ca3af|d1d5db|e5e7eb|f3f4f6|f9fafb)\b/i;
  const MARK = /\/\/ (?:fill-accent|on-art|on-color)\b/;
  test.each(['home-sections.js', 'home-skeletons.js', 'home-banner.js', 'home-setup.js', 'home-page.js'])('%s', (file) => {
    const lines = fs.readFileSync(path.join(COMP, file), 'utf8').split('\n');
    const bad = lines.map((l, i) => [i + 1, l]).filter(([, l]) => NEUTRAL.test(l) && !MARK.test(l));
    expect(bad).toEqual([]);
  });
});

describe('a card with no cover', () => {
  test('an album card shows a music note, a playlist card the playlist glyph', () => {
    const { AlbumCard } = require('../../src/renderer/components/album-card');
    const album = h(AlbumCard, { album: { title: 'A', artist: 'B' } });
    expect(album).toContain('data-album-glyph');
    expect(album).toContain('data-icon="Music"');
    expect(h(S.PlaylistCard, { playlist: { id: 'p', title: 'P' } })).toContain('data-playlist-glyph');
    expect(h(AlbumCard, { album: { title: 'A', artist: 'B', imageUrl: 'https://x/a.jpg' } })).not.toContain('data-album-glyph');
  });
});
