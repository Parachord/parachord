const { readableTextOn } = require('../../src/renderer/lib/readable-text');

describe('readableTextOn', () => {
  test('light brand colours, where white fails 3:1, get dark text', () => {
    expect(readableTextOn('#25D1DA')).toBe('var(--on-art-ink)'); // Amazon Music
    expect(readableTextOn('#1DB954')).toBe('var(--on-art-ink)'); // Spotify, 2.6:1 on white
  });
  test('mid colours where white reads get white, like the plug-in header', () => {
    expect(readableTextOn('#FA243C')).toBe('var(--on-accent)'); // Apple Music, 3.9:1
    expect(readableTextOn('#FF5500')).toBe('var(--on-accent)'); // SoundCloud, 3.2:1
  });
  test('dark and deep colours get white', () => {
    expect(readableTextOn('#333333')).toBe('var(--on-accent)');
    expect(readableTextOn('#7c3aed')).toBe('var(--on-accent)');
    expect(readableTextOn('#000')).toBe('var(--on-accent)');
  });
  test('a missing or non-hex colour gets white', () => {
    expect(readableTextOn(undefined)).toBe('var(--on-accent)');
    expect(readableTextOn('var(--accent-primary)')).toBe('var(--on-accent)');
  });
});

test('the two text colours are the index.html tokens it returns', () => {
  const { LIGHT_RGB, DARK_RGB } = require('../../src/renderer/lib/readable-text');
  const html = require('fs').readFileSync(require('path').join(__dirname, '../../index.html'), 'utf8');
  const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  expect(html).toContain(`--on-accent: ${hex(LIGHT_RGB)};`);
  expect(html).toContain(`--on-art-ink: ${hex(DARK_RGB)};`);
});
