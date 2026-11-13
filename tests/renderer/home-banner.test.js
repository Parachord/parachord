const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { bannerViewId } = require('../../src/renderer/lib/home-banners');
const { HomeBanner } = require('../../src/renderer/components/home-banner');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const render = (props) => renderToStaticMarkup(React.createElement(HomeBanner, props));

const item = (over = {}) => ({
  id: 'a1', kind: 'announcement', title: 'First title', body: 'Body text',
  icon: null, iconUrl: null, cta: null, severity: 'info', ...over,
});

describe('HomeBanner', () => {
  test('renders nothing when there are no items', () => {
    expect(render({ items: [] })).toBe('');
  });

  test('renders the first item only', () => {
    const html = render({ items: [item(), item({ id: 'a2', title: 'Second title' })] });
    expect(html).toContain('First title');
    expect(html).not.toContain('Second title');
  });

  test('has a dismiss button labelled for assistive tech', () => {
    expect(render({ items: [item()] })).toContain('aria-label="Dismiss announcement"');
  });

  test('omits the body when absent, and renders a valid CTA', () => {
    const html = render({ items: [item({ body: undefined, cta: { label: 'Go', url: 'https://x.test' } })] });
    expect(html).not.toContain('Body text');
    expect(html).toContain('>Go<');
  });

  test('prefers an https iconUrl, falls back to the glyph', () => {
    expect(render({ items: [item({ iconUrl: 'https://x.test/i.png', icon: 'A' })] })).toContain('<img');
    expect(render({ items: [item({ iconUrl: 'http://x.test/i.png', icon: 'A' })] })).not.toContain('<img');
  });
});

describe('Home-only wiring', () => {
  const app = read('src/renderer/app.js');
  test('the global banner render is gone', () => {
    expect(app).not.toContain('// In-app announcement banner');
  });
  test('the view telemetry effect only fires on Home', () => {
    const i = app.indexOf("recordAnnouncementEvent(viewId, 'view')");
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i - 600, i)).toContain("activeView !== 'home'");
  });
  test('Home no longer builds its own What\'s New card', () => {
    expect(read('src/renderer/components/home-page.js')).not.toContain("What's New card");
  });
});

describe('release notes stay out of the banner', () => {
  test.each([
    'src/renderer/app.js', 'src/renderer/components/home-banner.js', 'src/renderer/lib/home-banners.js',
  ])("%s has no 'whats-new' kind", (f) => {
    expect(read(f)).not.toContain("'whats-new'");
  });
});

describe('bannerViewId', () => {
  test('returns the id only when the painted banner is an announcement', () => {
    expect(bannerViewId([item({ id: 'a1' })])).toBe('a1');
    expect(bannerViewId([item({ id: 'w', kind: 'other' }), item({ id: 'a1' })])).toBeNull();
    expect(bannerViewId([])).toBeNull();
    expect(bannerViewId(undefined)).toBeNull();
  });
  test('the view effect uses it on bannerItems', () => {
    const app = read('src/renderer/app.js');
    const i = app.indexOf("recordAnnouncementEvent(viewId, 'view')");
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i - 500, i + 120)).toContain('bannerViewId(bannerItems)');
    expect(app.indexOf('const bannerItems = useMemo')).toBeLessThan(i);
  });
});
