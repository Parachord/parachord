const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { homeSetupItems } = require('../../src/renderer/lib/home-setup');
const { HomeSetupButton } = require('../../src/renderer/components/home-setup');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const allDone = {
  servicesConnected: true, scrobblingConnected: true,
  extensionConnected: true, isMac: false, dismissed: [],
};

describe('homeSetupItems', () => {
  test('everything connected is in whats-new mode', () => {
    const s = homeSetupItems(allDone);
    expect(s.mode).toBe('whats-new');
    expect(s.visible).toBeUndefined();
    expect(s.done).toBe(3);
    expect(s.total).toBe(3);
  });

  test('extensionConnected null counts as done', () => {
    const s = homeSetupItems({ ...allDone, extensionConnected: null });
    expect(s.items.find((i) => i.id === 'browser-extension').done).toBe(true);
    expect(homeSetupItems({ ...allDone, extensionConnected: false }).items.find((i) => i.id === 'browser-extension').done).toBe(false);
  });

  test('a dismissed id leaves items and total', () => {
    const s = homeSetupItems({ ...allDone, isMac: true, dismissed: ['raycast'] });
    expect(s.total).toBe(3);
    expect(s.items.find((i) => i.id === 'raycast')).toBeUndefined();
    expect(homeSetupItems({ ...allDone, isMac: true }).total).toBe(4);
  });

  test('no service connected yet gives one open services item', () => {
    const s = homeSetupItems({ ...allDone, servicesConnected: false });
    const r = s.items.filter((i) => i.id === 'resolvers');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ label: 'Connect your music services', done: false, action: 'resolvers' });
    expect(s.mode).toBe('setup');
    // A fresh profile starts with it open (it used to be ticked on day one).
    expect(homeSetupItems().items.find((i) => i.id === 'resolvers').done).toBe(false);
  });

  test('whatsNew is reported but never counted or listed', () => {
    const s = homeSetupItems({ ...allDone, servicesConnected: false, appVersion: '0.9.14', whatsNewUnread: true });
    expect(s.whatsNew).toEqual({ version: '0.9.14', unread: true });
    expect(s.total).toBe(3);
    expect(s.done).toBe(2);
    expect(s.items.some((i) => /new/i.test(i.id))).toBe(false);
    expect(homeSetupItems(allDone).whatsNew.unread).toBe(false);
  });

  test('scrobbling is one item; dismissing both old per-service items dismissed it', () => {
    const open = homeSetupItems({ ...allDone, scrobblingConnected: false });
    expect(open.items.filter((i) => i.id === 'scrobbling')).toEqual([
      expect.objectContaining({ label: 'Connect a scrobbling service', done: false }),
    ]);
    expect(homeSetupItems({ ...allDone, dismissed: ['lastfm'] }).items.some((i) => i.id === 'scrobbling')).toBe(true);
    expect(homeSetupItems({ ...allDone, dismissed: ['lastfm', 'listenbrainz'] }).items.some((i) => i.id === 'scrobbling')).toBe(false);
  });

  test('order and labels: no item names a service', () => {
    const s = homeSetupItems({ ...allDone, isMac: true });
    expect(s.items.map((i) => i.label)).toEqual([
      'Connect your music services', 'Connect a scrobbling service',
      'Install the browser extension', 'Add the Raycast extension',
    ]);
    expect(s.items.map((i) => i.label).join(' ')).not.toMatch(/Spotify|Last\.fm|ListenBrainz/);
  });
});

describe('HomeSetupButton', () => {
  const render = (props) => renderToStaticMarkup(React.createElement(HomeSetupButton, props));
  const setupMode = (unread) => ({
    items: [
      { id: 'a', label: 'A', done: true, action: 'a' }, { id: 'b', label: 'B', done: true, action: 'b' },
      { id: 'c', label: 'C', done: false, action: 'c' }, { id: 'd', label: 'D', done: false, action: 'd' },
    ],
    done: 2, total: 4, mode: 'setup', whatsNew: { version: '0.9.14', unread },
  });
  const notesMode = (unread) => ({ items: [], done: 0, total: 0, mode: 'whats-new', whatsNew: { version: '0.9.14', unread } });

  test('setup mode shows the progress label', () => {
    expect(render({ setup: setupMode(false) })).toContain('Finish setting up · 2 of 4');
  });
  test('setup mode shows the dot only when unread', () => {
    expect(render({ setup: setupMode(true) })).toContain('aria-label="New release notes"');
    expect(render({ setup: setupMode(false) })).not.toContain('New release notes');
  });
  test('whats-new mode reads What\'s new in v{version}', () => {
    const html = render({ setup: notesMode(false) });
    expect(html).toContain('What&#x27;s new in v0.9.14');
    expect(html).not.toContain('Finish setting up');
    expect(html).not.toContain('New release notes');
  });
  test('whats-new mode shows the dot when unread', () => {
    expect(render({ setup: notesMode(true) })).toContain('aria-label="New release notes"');
  });
  test('renders nothing without a setup model', () => {
    expect(render({ setup: null })).toBe('');
  });
});

describe('wiring', () => {
  test('the store allows the dismissed key', () => {
    expect(read('main-process/ipc/store.js')).toContain("'home_setup_dismissed'");
  });
  test('app.js loads the key at start and Home gets the handler', () => {
    const app = read('src/renderer/app.js');
    expect(app).toContain("'home_setup_dismissed'");
    expect(app).toContain('dismissHomeSetupItem');
    expect(read('src/renderer/components/home-page.js')).toContain("'dismissHomeSetupItem'");
  });
  test('Home wires openWhatsNew and no longer hides the element', () => {
    const page = read('src/renderer/components/home-page.js');
    expect(page).toContain("'openWhatsNew'");
    expect(page).not.toContain('homeSetup.visible');
    expect(read('src/renderer/app.js')).toContain('openWhatsNew');
  });
  test('the old Enhance Your Experience section is gone', () => {
    expect(read('src/renderer/components/home-page.js')).not.toContain('Enhance Your Experience');
  });
});

describe('HomeSetupButton without a release version', () => {
  const mk = (whatsNew) => ({ mode: 'whats-new', items: [], done: 5, total: 5, whatsNew });
  test('reads "What\'s new" with no "vnull"', () => {
    const html = renderToStaticMarkup(React.createElement(HomeSetupButton, { setup: mk({ version: null, unread: false }) }));
    expect(html).toContain('What&#x27;s new');
    expect(html).not.toMatch(/vnull|vundefined/);
  });
  test('keeps the version when there is one', () => {
    const html = renderToStaticMarkup(React.createElement(HomeSetupButton, { setup: mk({ version: '1.2.3', unread: false }) }));
    expect(html).toContain('v1.2.3');
  });
});
