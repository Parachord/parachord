const { homeBannerItems, BANNER_SEVERITY_COLORS } = require('../../src/renderer/lib/home-banners');

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastOnWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

describe('homeBannerItems', () => {
  test('empty inputs give an empty list', () => {
    expect(homeBannerItems({ announcements: [] })).toEqual([]);
  });

  test('only announcements, in their given order; a whatsNew input is ignored', () => {
    const items = homeBannerItems({
      whatsNew: { version: '0.9.14', title: "What's new in 0.9.14" },
      announcements: [
        { id: 'a1', title: 'One', body: 'b1', severity: 'warn' },
        { id: 'a2', title: 'Two', body: 'b2' },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['a1', 'a2']);
    expect(items.every((i) => i.kind === 'announcement')).toBe(true);
    expect(items.some((i) => i.kind === 'whats-new')).toBe(false);
  });

  test('an announcement without severity gets info', () => {
    const [item] = homeBannerItems({ announcements: [{ id: 'x', title: 'T' }] });
    expect(item.severity).toBe('info');
  });

  test('tolerates missing arguments', () => {
    expect(homeBannerItems({})).toEqual([]);
    expect(homeBannerItems()).toEqual([]);
  });
});

describe('BANNER_SEVERITY_COLORS', () => {
  test('has the four severities', () => {
    expect(Object.keys(BANNER_SEVERITY_COLORS).sort()).toEqual(['error', 'info', 'success', 'warn']);
  });
  // Each fill is an index.html --fill-* token; read its value there (the
  // one place it's written) and check white text reads on it.
  const html = require('fs').readFileSync(require('path').join(__dirname, '../../index.html'), 'utf8');
  const fills = Object.entries(BANNER_SEVERITY_COLORS).map(([k, v]) => {
    const name = v.match(/^var\((--fill-[a-z]+)\)$/)[1];
    return [k, (html.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`)) || [])[1]];
  });
  test.each(fills)('%s is an index.html fill with contrast >= 4.5 against white', (_k, hex) => {
    expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(contrastOnWhite(hex)).toBeGreaterThanOrEqual(4.5);
  });
});
