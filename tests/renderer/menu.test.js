/**
 * Menu (components/menu.js): the shared action menu behind Share, the ticket
 * menus and Sync. Markup through react-dom/server; behaviour through a small
 * hook harness (no DOM in the jest environment).
 */
global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Menu } = require('../../src/renderer/components/menu');

const trigger = (t) => React.createElement('button', Object.assign({}, t, { open: undefined }), 'Share');
const items = [
  { key: 'a', label: 'Copy link', onSelect: jest.fn() },
  { key: 'b', label: 'Export as XSPF…', onSelect: jest.fn() },
  { key: 'c', label: 'Ticketmaster', href: 'https://example.com/t', dot: '#026cdf' },
];

describe('markup', () => {
  test('closed: a trigger that says it has a menu, and no menu', () => {
    const html = renderToStaticMarkup(React.createElement(Menu, { label: 'Share', items, renderTrigger: trigger }));
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
  });
});

// A hook harness: renders Menu as a function with controllable state.
function harness(props, { open = false } = {}) {
  const real = global.React;
  const state = { open };
  const focusLog = [];
  const els = [];
  const doc = { activeElement: null, addEventListener() {}, removeEventListener() {} };
  global.document = doc;
  global.window = { innerWidth: 1000, innerHeight: 800 };
  let layout = [];
  const render = () => {
    let s = 0; let r = 0; layout = [];
    global.React = Object.assign({}, real, {
      useState: (init) => {
        const k = s++;
        if (k === 0) return [state.open, (v) => { state.open = typeof v === 'function' ? v(state.open) : v; }];
        return [init, () => {}];
      },
      useRef: () => {
        const k = r++;
        if (k === 0) return { current: { contains: () => false, querySelector: () => ({ focus: () => focusLog.push('trigger') }) } };
        if (k === 1) return { current: { querySelectorAll: () => els, getBoundingClientRect: () => ({ left: 10, right: 200, top: 10, bottom: 100, height: 90 }) } };
        return { current: 'first' };
      },
      useEffect: () => {},
      useLayoutEffect: (fn) => layout.push(fn),
      useId: () => 'm',
    });
    try { return Menu(props); } finally { global.React = real; }
  };
  const tree = render();
  // Fake menu items, one per rendered item, that record focus.
  const menu = tree.props.children[1];
  if (menu) {
    for (const child of [].concat(...menu.props.children).filter((c) => c && /^menuitem/.test(c.props.role))) {
      const el = { label: child.props.children[2].props.children, focus() { doc.activeElement = el; focusLog.push(el.label); } };
      el.textContent = el.label;
      els.push(el);
    }
  }
  return { tree, menu, state, focusLog, doc, els, runLayout: () => layout.forEach((fn) => fn()) };
}

describe('behaviour', () => {
  afterEach(() => { delete global.document; delete global.window; });

  test('the trigger opens it; ArrowDown on the trigger opens it too', () => {
    const h = harness({ label: 'Share', items, renderTrigger: (t) => t });
    h.tree.props.children[0].onClick({ stopPropagation() {} });
    expect(h.state.open).toBe(true);
    const h2 = harness({ label: 'Share', items, renderTrigger: (t) => t });
    h2.tree.props.children[0].onKeyDown({ key: 'ArrowDown', preventDefault() {} });
    expect(h2.state.open).toBe(true);
  });

  test('open: a labelled role=menu; actions are buttons, links open in the browser', () => {
    const h = harness({ label: 'Share', items, renderTrigger: trigger }, { open: true });
    const html = renderToStaticMarkup(h.menu);
    expect(html).toMatch(/^<div id="m-menu" role="menu" aria-label="Share"/);
    expect((html.match(/role="menuitem"/g) || []).length).toBe(3);
    expect(html).toMatch(/<a role="menuitem" tabindex="-1"[^>]*href="https:\/\/example.com\/t" target="_blank" rel="noopener noreferrer"/);
    expect(html).toContain('background-color:#026cdf');
  });

  test('focus lands on the first item; arrows wrap; Home/End jump; a letter jumps', () => {
    const h = harness({ label: 'Share', items, renderTrigger: trigger }, { open: true });
    h.runLayout();
    expect(h.doc.activeElement.label).toBe('Copy link');
    const key = (k) => h.menu.props.onKeyDown({ key: k, preventDefault() {}, stopPropagation() {} });
    key('ArrowUp'); expect(h.doc.activeElement.label).toBe('Ticketmaster');
    key('ArrowDown'); expect(h.doc.activeElement.label).toBe('Copy link');
    key('End'); expect(h.doc.activeElement.label).toBe('Ticketmaster');
    key('Home'); expect(h.doc.activeElement.label).toBe('Copy link');
    key('e'); expect(h.doc.activeElement.label).toBe('Export as XSPF…');
  });

  test('Escape closes and gives focus back to the trigger', () => {
    const h = harness({ label: 'Share', items, renderTrigger: trigger }, { open: true });
    h.menu.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    expect(h.state.open).toBe(false);
    expect(h.focusLog).toContain('trigger');
  });

  test('checked items are menuitemradio with a check; the heading is a label, not an item', () => {
    const pick = [{ key: 's', label: 'Spotify', checked: true }, { key: 'y', label: 'YouTube', checked: false }];
    const h = harness({ label: 'Play from', heading: 'Play from', items: pick, renderTrigger: trigger }, { open: true });
    const html = renderToStaticMarkup(h.menu);
    expect(html).toMatch(/role="menuitemradio" aria-checked="true"[^>]*>.*Spotify.*data-icon="Check"/);
    expect(html).toMatch(/role="menuitemradio" aria-checked="false"/);
    expect(html).toMatch(/aria-hidden="true" class="uppercase"[^>]*>Play from</);
  });

  test('a separator is a rule, not an item', () => {
    const h = harness({ label: 'Sync', items: [items[0], { separator: true }, items[1]], renderTrigger: trigger }, { open: true });
    const html = renderToStaticMarkup(h.menu);
    expect(html).toContain('role="separator"');
    expect((html.match(/role="menuitem"/g) || []).length).toBe(2);
  });

  test('picking an action closes the menu and runs it', () => {
    const h = harness({ label: 'Share', items, renderTrigger: trigger }, { open: true });
    [].concat(...h.menu.props.children).filter(Boolean)[0].props.onClick({ preventDefault() {} });
    expect(h.state.open).toBe(false);
    expect(items[0].onSelect).toHaveBeenCalled();
  });
});

describe('callers', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  test('Share (album and playlist pages) and the two ticket menus use it', () => {
    expect(read('src/renderer/components/cards.js')).toMatch(/React\.createElement\(Menu, \{\n\s*label: 'Share'/);
    expect(read('src/renderer/components/playlist-view-page.js')).toMatch(/React\.createElement\(Menu, \{\n\s*label: 'Share'/);
    expect(read('src/renderer/app.js')).toMatch(/return React\.createElement\(Menu, \{\n\s*label: 'Tickets'/);
    expect(read('src/renderer/components/artist-page.js')).toMatch(/return React\.createElement\(Menu, \{\n\s*label: 'Tickets'/);
  });
  test('Sync (Collection) uses it, with a separator after the status item', () => {
    const page = read('src/renderer/components/collection-page.js');
    expect(page).toMatch(/return React\.createElement\(Menu, \{\n\s*label: 'Sync'/);
    expect(page).toContain("items.push({ separator: true, key: 'sep' });");
  });
  test("the playbar's Play from and the chat provider picker use it, as choices", () => {
    const app = read('src/renderer/app.js');
    expect(app).toMatch(/React\.createElement\(Menu, \{\n\s*label: 'Play from',\n\s*heading: 'Play from',/);
    expect(app).toContain('checked: resId === currentResolverId,');
    expect(app).toMatch(/return React\.createElement\(Menu, \{\n\s*label: 'Chat provider',/);
    expect(app).toContain('checked: service.id === selectedChatProvider,');
  });
  test('the chat panel is no longer a button that closes the picker', () => {
    expect(read('src/renderer/app.js')).not.toContain("data-provider-dropdown");
  });
  test('their hand-built open state is gone', () => {
    const app = read('src/renderer/app.js');
    for (const v of ['shareDropdownOpen', 'concertsTicketFlyout', 'artistConcertsTicketFlyout', 'syncMenuOpen', 'playbarSourceDropdownOpen', 'chatProviderDropdownOpen']) expect(app).not.toContain(v);
  });
});
