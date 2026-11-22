// A playlist's duplicate tracks, and the banner that removes them (#1635,
// mobile parity: parachord-mobile#804's PlaylistDuplicates /
// PlaylistDuplicateCopy, whose vectors these are). "The same song" is sync's
// identity (sync-engine/playlist-key-unify.js unifyTrackKeys).
const { duplicateIndexes, duplicateCount, withoutDuplicates, offersRemoval, duplicateCopy } = require('../../src/renderer/lib/playlist-duplicates');

const t = (artist, title, extra = {}) => ({ artist, title, ...extra });
const titles = (list) => list.map((x) => x.title);

describe('which copies go', () => {
  test('no duplicates leaves the list alone', () => {
    const tracks = [t('A', 'One'), t('B', 'Two')];
    expect(duplicateCount(tracks)).toBe(0);
    expect(withoutDuplicates(tracks)).toEqual(tracks);
  });

  test('keeps the first copy in place, removes every later one (the #802 shape)', () => {
    const tracks = [
      t('Birdmonster', 'Balloons'), t('Pond', 'Glimmer'), t('C', 'Three'),
      t('Birdmonster', 'Balloons'), t('Pond', 'Glimmer'),
      t('Birdmonster', 'Balloons'),
    ];
    expect([...duplicateIndexes(tracks)].sort()).toEqual([3, 4, 5]);
    expect(titles(withoutDuplicates(tracks))).toEqual(['Balloons', 'Glimmer', 'Three']);
  });

  test('case and spacing don\'t make a different song', () => {
    expect(duplicateCount([t('Pond', 'Glimmer'), t(' pond ', 'GLIMMER')])).toBe(1);
  });

  test('a remaster tag is the same song', () => {
    expect(duplicateCount([t('Ramones', 'Judy Is a Punk'), t('Ramones', 'Judy Is a Punk - 2016 Remaster')])).toBe(1);
  });

  test('a live version or remix is a different song', () => {
    expect(duplicateCount([
      t('Ramones', 'Judy Is a Punk'),
      t('Ramones', 'Judy Is a Punk (Live)'),
      t('Ramones', 'Judy Is a Punk - Remix'),
    ])).toBe(0);
  });

  test('the same ISRC under different names is a duplicate, wherever the ISRC is kept', () => {
    expect(duplicateCount([
      t('Beatles', 'Help', { isrc: 'GBAYE6500001' }),
      t('The Beatles', 'Help!', { sources: { spotify: { isrc: 'gbaye6500001' } } }),
    ])).toBe(1);
  });

  test('the same recording MBID under different names is a duplicate', () => {
    const mbid = 'b1a9c0e9-d987-4042-ae91-78d6a3267d69';
    expect(duplicateCount([t('X', 'Song', { mbid }), t('X feat Y', 'Song (Edit)', { mbid })])).toBe(1);
  });

  test('two different ISRCs with one name stay two recordings', () => {
    expect(duplicateCount([
      t('Band', 'Intro', { isrc: 'USAAA0000001' }),
      t('Band', 'Intro', { isrc: 'USAAA0000002' }),
    ])).toBe(0);
  });

  test('blank rows are never duplicates of each other', () => {
    expect(duplicateCount([t('', ''), t('', ''), t('A', 'One')])).toBe(0);
  });

  test('a source marked noMatch is not where an ISRC comes from', () => {
    expect(duplicateCount([
      t('A', 'One', { isrc: 'USAAA0000001' }),
      t('B', 'Two', { sources: { x: { noMatch: true, isrc: 'USAAA0000001' } } }),
    ])).toBe(0);
  });

  test('nothing in, nothing out', () => {
    expect(duplicateCount(null)).toBe(0);
    expect(withoutDuplicates(undefined)).toEqual([]);
  });
});

describe('when the banner shows', () => {
  test('only for a saved playlist we can edit that has duplicates', () => {
    const local = { id: 'local-1', title: 'Mine' };
    expect(offersRemoval(local, 2)).toBe(true);
    expect(offersRemoval(local, 0)).toBe(false);
    expect(offersRemoval(null, 2)).toBe(false);
    // A hosted XSPF is a copy of its feed: the next poll would bring them back.
    expect(offersRemoval({ ...local, sourceUrl: 'https://example.com/p.xspf', source: 'hosted-xspf' }, 2)).toBe(false);
    // A provider import keeps its link only as provenance: it's ours to edit.
    expect(offersRemoval({ ...local, sourceUrl: 'https://open.spotify.com/playlist/x', source: 'spotify-import' }, 2)).toBe(true);
    // A recommendation shown but not saved.
    expect(offersRemoval({ ...local, isEphemeral: true }, 2)).toBe(false);
  });
});

describe('the words, the same on every app', () => {
  test('counts read naturally', () => {
    expect(duplicateCopy.banner(1)).toBe('1 duplicate track in this playlist');
    expect(duplicateCopy.confirmTitle(877)).toBe('Remove 877 duplicate tracks?');
    expect(duplicateCopy.done(1204)).toBe('Removed 1,204 duplicate tracks');
    expect(duplicateCopy.confirmBody('Mine')).toBe('The first copy of each track stays in “Mine”. Synced copies on other services update on the next sync.');
    expect(duplicateCopy.remove).toBe('Remove duplicates');
  });
});
