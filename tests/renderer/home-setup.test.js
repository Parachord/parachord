const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { homeSetupItems, missingPopularResolverCount } = require('../../src/renderer/lib/home-setup');
const { HomeSetupButton } = require('../../src/renderer/components/home-setup');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const allDone = {
  missingPopularResolvers: 0, lastfmConnected: true, listenbrainzConnected: true,
  librarySyncEnabled: true, extensionConnected: true, isMac: false, dismissed: [],
};

describe('homeSetupItems', () => {
  test('everything connected is in whats-new mode', () => {
    const s = homeSetupItems(allDone);
    expect(s.mode).toBe('whats-new');
    expect(s.visible).toBeUndefined();
    expect(s.done).toBe(5);
    expect(s.total).toBe(5);
  });

  test('extensionConnected null counts as done', () => {
    const s = homeSetupItems({ ...allDone, extensionConnected: null });
    expect(s.items.find((i) => i.id === 'browser-extension').done).toBe(true);
    expect(homeSetupItems({ ...allDone, extensionConnected: false }).items.find((i) => i.id === 'browser-extension').done).toBe(false);
  });

  test('a dismissed id leaves items and total', () => {
    const s = homeSetupItems({ ...allDone, isMac: true, dismissed: ['raycast'] });
    expect(s.total).toBe(5);
    expect(s.items.find((i) => i.id === 'raycast')).toBeUndefined();
    expect(homeSetupItems({ ...allDone, isMac: true }).total).toBe(6);
  });

  test('missing popular resolvers give one open resolvers item', () => {
    const s = homeSetupItems({ ...allDone, missingPopularResolvers: 2 });
    const r = s.items.filter((i) => i.id === 'resolvers');
    expect(r).toHaveLength(1);
    expect(r[0].done).toBe(false);
    expect(r[0].action).toBe('resolvers');
    expect(s.mode).toBe('setup');
  });

  test('whatsNew is reported but never counted or listed', () => {
    const s = homeSetupItems({ ...allDone, missingPopularResolvers: 1, appVersion: '0.9.14', whatsNewUnread: true });
    expect(s.whatsNew).toEqual({ version: '0.9.14', unread: true });
    expect(s.total).toBe(5);
    expect(s.done).toBe(4);
    expect(s.items.some((i) => /new/i.test(i.id))).toBe(false);
    expect(homeSetupItems(allDone).whatsNew.unread).toBe(false);
  });

  test('the sync item names no service, and an old "spotify" dismissal still hides it', () => {
    const open = homeSetupItems({ ...allDone, librarySyncEnabled: false });
    expect(open.items.find((i) => i.id === 'library-sync')).toMatchObject({ label: 'Sync your library', done: false });
    expect(open.items.map((i) => i.label).join(' ')).not.toMatch(/Spotify/);
    const dismissed = homeSetupItems({ ...allDone, librarySyncEnabled: false, dismissed: ['spotify'] });
    expect(dismissed.items.some((i) => i.id === 'library-sync')).toBe(false);
  });

  test('order and labels', () => {
    const s = homeSetupItems({ ...allDone, isMac: true });
    expect(s.items.map((i) => i.label)).toEqual([
      'Add more music sources', 'Connect Last.fm', 'Connect ListenBrainz',
      'Sync your library', 'Install the browser extension', 'Add the Raycast extension',
    ]);
  });

  test('counts missing popular resolvers against installed ones', () => {
    expect(missingPopularResolverCount([{ id: 'youtube' }, { id: 'spotify' }])).toBe(2);
    expect(missingPopularResolverCount([{ id: 'youtube' }, { id: 'soundcloud' }, { id: 'bandcamp' }])).toBe(0);
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
