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
  test('has the three labelled actions', () => {
    const html = h(S.AlbumCard, { album });
    expect(html).toContain('aria-label="Add Frog to a playlist"');
    expect(html).toContain('aria-label="Play Frog"');
    expect(html).toContain('aria-label="Add Frog to the queue"');
    expect(count(html, /<button/g)).toBeGreaterThanOrEqual(3);
  });
  test('play button is 52px', () => {
    expect(h(S.AlbumCard, { album })).toMatch(/aria-label="Play Frog"[^>]*width:52px|width:52px[^>]*aria-label="Play Frog"/);
  });
  test('shows the tag and the artist', () => {
    const html = h(S.AlbumCard, { album });
    expect(html).toContain('Out Friday');
    expect(html).toContain('Hovvdy');
  });
});

describe('PlaylistCard', () => {
  const playlist = { id: 'p1', title: 'Daily Brew', mosaic: ['https://a/1.jpg', 'https://a/2.jpg'] };
  test('has Play and Add to Queue only', () => {
    const html = h(S.PlaylistCard, { playlist, badge: '+12', subtitle: 'Refreshed 2h ago' });
    expect(html).toContain('aria-label="Play Daily Brew"');
    expect(html).toContain('aria-label="Add Daily Brew to the queue"');
    expect(html).not.toContain('to a playlist');
    expect(html).toContain('+12');
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

describe('JumpBackIn', () => {
  test('each tile is a button; empty shows the import card', () => {
    const tiles = [{ kind: 'loves', item: [], subtitle: 'Your recent loves' }];
    expect(h(S.JumpBackIn, { tiles })).toMatch(/<button[^>]*>.*Recent loves/);
    const empty = h(S.JumpBackIn, { tiles: [] });
    expect(empty).toContain('Import');
  });
});

describe('Rows', () => {
  test('See all links carry an aria-label', () => {
    const html = h(S.PlaylistsRow, { playlists: [{ id: 'a', title: 'A' }], navigateTo: () => {} });
    expect(html).toContain('aria-label="See all in Playlists"');
  });
  test('Mixes row has no See all', () => {
    const html = h(S.MixesRow, { mixes: [{ id: 'm', title: 'Heavy Rotation', resolverId: 'applemusic', serviceLabel: 'Apple Music' }] });
    expect(html).not.toContain('See all');
    expect(html).toContain('Heavy Rotation');
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
  test('Concert card shows date, artist, venue, city', () => {
    const concerts = [{ id: 'c1', date: '2026-12-05', artist: 'Hovvdy', venue: { name: 'Lodge Room', city: 'Los Angeles' }, ticketSources: [{ source: 'songkick', ticketUrl: 'https://t' }] }];
    const html = h(S.ConcertsRow, { concerts, navigateTo: () => {} });
    expect(html).toContain('Hovvdy');
    expect(html).toContain('Lodge Room');
    expect(html).toContain('Los Angeles');
    expect(html).toContain('Tickets');
    expect(html).toContain('aria-label="See all in Concerts"');
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
    input.props.onChange({ target: { value: 'my own words' } });
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
