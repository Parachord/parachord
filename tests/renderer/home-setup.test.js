const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { homeSetupItems, missingPopularResolverCount } = require('../../src/renderer/lib/home-setup');
const { HomeSetupButton } = require('../../src/renderer/components/home-setup');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const allDone = {
  missingPopularResolvers: 0, lastfmConnected: true, listenbrainzConnected: true,
  spotifyConnected: true, extensionConnected: true, isMac: false, dismissed: [],
};

describe('homeSetupItems', () => {
  test('everything connected and not a Mac is not visible', () => {
    const s = homeSetupItems(allDone);
    expect(s.visible).toBe(false);
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
    expect(s.visible).toBe(true);
  });

  test('order and labels', () => {
    const s = homeSetupItems({ ...allDone, isMac: true });
    expect(s.items.map((i) => i.label)).toEqual([
      'Add more music sources', 'Connect Last.fm', 'Connect ListenBrainz',
      'Connect Spotify', 'Install the browser extension', 'Add the Raycast extension',
    ]);
  });

  test('counts missing popular resolvers against installed ones', () => {
    expect(missingPopularResolverCount([{ id: 'youtube' }, { id: 'spotify' }])).toBe(2);
    expect(missingPopularResolverCount([{ id: 'youtube' }, { id: 'soundcloud' }, { id: 'bandcamp' }])).toBe(0);
  });
});

describe('HomeSetupButton', () => {
  test('shows the progress label', () => {
    const setup = {
      items: [
        { id: 'a', label: 'A', done: true, action: 'a' }, { id: 'b', label: 'B', done: true, action: 'b' },
        { id: 'c', label: 'C', done: false, action: 'c' }, { id: 'd', label: 'D', done: false, action: 'd' },
      ],
      done: 2, total: 4, visible: true,
    };
    expect(renderToStaticMarkup(React.createElement(HomeSetupButton, { setup }))).toContain('Finish setting up · 2 of 4');
  });

  test('renders nothing when not visible', () => {
    expect(renderToStaticMarkup(React.createElement(HomeSetupButton, { setup: { items: [], done: 0, total: 0, visible: false } }))).toBe('');
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
  test('the old Enhance Your Experience section is gone', () => {
    expect(read('src/renderer/components/home-page.js')).not.toContain('Enhance Your Experience');
  });
});
