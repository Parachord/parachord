const { readableTextOn } = require('../../src/renderer/lib/readable-text');

describe('readableTextOn', () => {
  test('light brand colours get dark text', () => {
    expect(readableTextOn('#25D1DA')).toBe('#111827'); // Amazon Music
    expect(readableTextOn('#1DB954')).toBe('#111827'); // Spotify
  });
  test('saturated or dark colours get white', () => {
    expect(readableTextOn('#FA243C')).toBe('#ffffff'); // Apple Music
    expect(readableTextOn('#7c3aed')).toBe('#ffffff');
    expect(readableTextOn('#000')).toBe('#ffffff');
  });
  test('a missing or non-hex colour gets white', () => {
    expect(readableTextOn(undefined)).toBe('#ffffff');
    expect(readableTextOn('var(--accent-primary)')).toBe('#ffffff');
  });
});
