/**
 * Recommendation blocklist matching (parachord#1006). The blocklist was
 * persisted but never read by any surface; these helpers are what the
 * Recommendations page, Fresh Drops, Home AI suggestions and the chat system
 * prompt now share.
 */

const { isBlocked, filterBlocked, formatForPrompt, isEmpty } = require('../../recommendation-blocklist');

const blocklist = {
  artists: [{ name: 'Nickelback' }],
  albums: [{ title: 'Greatest Hits', artist: 'Some Band' }],
  tracks: [{ title: 'Wonderwall', artist: 'Oasis' }],
};

describe('isBlocked', () => {
  test('blocked artist blocks the artist, their albums and their tracks, case-insensitively', () => {
    expect(isBlocked(blocklist, { artist: 'nickelback' })).toBe(true);
    expect(isBlocked(blocklist, { artist: ' NICKELBACK ', title: 'Photograph' })).toBe(true);
    expect(isBlocked(blocklist, { artist: 'Nickelback', album: 'All the Right Reasons', title: 'Photograph' })).toBe(true);
  });

  test('blocked album blocks that album and tracks on it, not the artist\'s other work', () => {
    expect(isBlocked(blocklist, { artist: 'Some Band', title: 'Greatest Hits' })).toBe(true);
    expect(isBlocked(blocklist, { artist: 'Some Band', album: 'Greatest Hits', title: 'Hit One' })).toBe(true);
    expect(isBlocked(blocklist, { artist: 'Some Band', album: 'Debut', title: 'Deep Cut' })).toBe(false);
    expect(isBlocked(blocklist, { artist: 'Some Band' })).toBe(false);
  });

  test('blocked track blocks only that track', () => {
    expect(isBlocked(blocklist, { artist: 'Oasis', title: 'Wonderwall' })).toBe(true);
    expect(isBlocked(blocklist, { artist: 'Oasis', title: 'Live Forever' })).toBe(false);
    expect(isBlocked(blocklist, { artist: 'Oasis' })).toBe(false);
  });

  test('no fuzzy matching and no cross-artist leakage', () => {
    expect(isBlocked(blocklist, { artist: 'Nickelback Tribute Band' })).toBe(false);
    expect(isBlocked(blocklist, { artist: 'Another Band', title: 'Greatest Hits' })).toBe(false);
    expect(isBlocked(blocklist, { artist: 'Ryan Adams', title: 'Wonderwall' })).toBe(false);
  });

  test('empty, missing or malformed blocklists block nothing', () => {
    expect(isBlocked(null, { artist: 'Nickelback' })).toBe(false);
    expect(isBlocked({ artists: [], albums: [], tracks: [] }, { artist: 'Nickelback' })).toBe(false);
    expect(isBlocked({ artists: [{}], albums: [null], tracks: [{ title: '' }] }, { artist: '', title: '' })).toBe(false);
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty(blocklist)).toBe(false);
  });
});

describe('filterBlocked', () => {
  test('keeps unblocked items and maps through pick', () => {
    const releases = [
      { artist: 'Nickelback', title: 'New One' },
      { artist: 'Some Band', title: 'Greatest Hits' },
      { artist: 'Some Band', title: 'Debut' },
    ];
    expect(filterBlocked(blocklist, releases)).toEqual([{ artist: 'Some Band', title: 'Debut' }]);
    const wrapped = releases.map((r) => ({ rg: r }));
    expect(filterBlocked(blocklist, wrapped, (w) => w.rg)).toEqual([{ rg: { artist: 'Some Band', title: 'Debut' } }]);
  });

  test('returns the input untouched when the blocklist is empty', () => {
    const items = [{ artist: 'Nickelback' }];
    expect(filterBlocked(null, items)).toBe(items);
  });
});

describe('formatForPrompt', () => {
  test('lists each populated section and nothing for an empty list', () => {
    const lines = formatForPrompt(blocklist);
    expect(lines[0]).toMatch(/BLOCKLIST/);
    expect(lines).toContain('  Artists: Nickelback');
    expect(lines).toContain('  Albums: "Greatest Hits" by Some Band');
    expect(lines).toContain('  Tracks: "Wonderwall" by Oasis');
    expect(formatForPrompt({ artists: [], albums: [], tracks: [] })).toEqual([]);
    expect(formatForPrompt(undefined)).toEqual([]);
  });
});
