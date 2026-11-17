const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { homeSetupItems } = require('../../src/renderer/lib/home-setup');
const { HomeSetupButton } = require('../../src/renderer/components/home-setup');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const allDone = {
  extensionConnected: true, dismissed: [],
};

describe('homeSetupItems', () => {
  test('everything connected is in whats-new mode', () => {
    const s = homeSetupItems(allDone);
    expect(s.mode).toBe('whats-new');
    expect(s.visible).toBeUndefined();
    expect(s.done).toBe(1);
    expect(s.total).toBe(1);
  });

  test('extensionConnected null counts as done', () => {
    const s = homeSetupItems({ ...allDone, extensionConnected: null });
    expect(s.items.find((i) => i.id === 'browser-extension').done).toBe(true);
    expect(homeSetupItems({ ...allDone, extensionConnected: false }).items.find((i) => i.id === 'browser-extension').done).toBe(false);
  });

  test('a dismissed id leaves items and total', () => {
    const s = homeSetupItems({ ...allDone, gettingStartedLeft: true, dismissed: ['getting-started'] });
    expect(s.total).toBe(1);
    expect(s.items.find((i) => i.id === 'getting-started')).toBeUndefined();
    expect(homeSetupItems({ ...allDone, gettingStartedLeft: true }).total).toBe(2);
  });

  test('services and scrobblers are getting-started steps; skipped steps come back as one item; no Raycast (#1493)', () => {
    expect(homeSetupItems({}).items.map((i) => i.id)).toEqual(['browser-extension']);
    expect(homeSetupItems({ gettingStartedLeft: true }).items.map((i) => i.id)).toEqual(['getting-started', 'browser-extension']);
    // Nothing left: the pill is What's New.
    expect(homeSetupItems(allDone).mode).toBe('whats-new');
  });

  test('whatsNew is reported but never counted or listed', () => {
    const s = homeSetupItems({ ...allDone, extensionConnected: false, appVersion: '0.9.14', whatsNewUnread: true });
    expect(s.whatsNew).toEqual({ version: '0.9.14', unread: true });
    expect(s.total).toBe(1);
    expect(s.done).toBe(0);
    expect(s.items.some((i) => /new/i.test(i.id))).toBe(false);
    expect(homeSetupItems(allDone).whatsNew.unread).toBe(false);
  });

  test('order and labels: no item names a service', () => {
    const s = homeSetupItems({ ...allDone, gettingStartedLeft: true });
    expect(s.items.map((i) => i.label)).toEqual([
      'Finish getting started', 'Install the browser extension',
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
