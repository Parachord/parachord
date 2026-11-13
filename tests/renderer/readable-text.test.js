const { readableTextOn } = require('../../src/renderer/lib/readable-text');

describe('readableTextOn', () => {
  test('light and mid brand colours get dark text', () => {
    expect(readableTextOn('#FA243C')).toBe('#111827'); // Apple Music, 3.9:1 on white
    expect(readableTextOn('#25D1DA')).toBe('#111827'); // Amazon Music
    expect(readableTextOn('#1DB954')).toBe('#111827'); // Spotify
  });
  test('dark and deep colours get white', () => {
    expect(readableTextOn('#333333')).toBe('#ffffff');
    expect(readableTextOn('#7c3aed')).toBe('#ffffff');
    expect(readableTextOn('#000')).toBe('#ffffff');
  });
  test('a missing or non-hex colour gets white', () => {
    expect(readableTextOn(undefined)).toBe('#ffffff');
    expect(readableTextOn('var(--accent-primary)')).toBe('#ffffff');
  });
});
