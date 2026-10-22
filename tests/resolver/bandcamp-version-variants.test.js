/**
 * Bandcamp matches must be the requested recording, not a cover, remix or
 * live cut. Bandcamp's search API ranks those alongside the original, and the
 * plugin's resolve used to return the first containment hit, so the playbar's
 * Buy link pointed at "Cleopatra (Live from Wrigley Field)" while plain
 * "Cleopatra" sat lower in the same results (2026-10). The renderer's
 * isOtherVersion keeps the same word list for the Buy button and the
 * play-time match picker.
 */

const fs = require('fs');
const path = require('path');
const bandcamp = require('../../plugins-src/bandcamp/implementation');
const { isOtherVersion, VARIANT_WORDS } = require('../../src/renderer/lib/track-variants');

const r = (artist, title) => ({ artist, title, bandcampUrl: `https://x.bandcamp.com/track/${encodeURIComponent(title)}` });
const resolveWith = (results, artist, title) =>
  bandcamp.resolve.call({ search: async () => results }, artist, title, '', {});

describe('Bandcamp resolve', () => {
  test('prefers the exact track over a live version ranked above it', async () => {
    const results = [
      r('Lauren Steiner', 'Angela - The Lumineers, Cleopatra'),
      r('The Lumineers', 'Cleopatra (Live from Wrigley Field)'),
      r('The Lumineers', 'Ophelia'),
      r('The Lumineers', 'Cleopatra'),
    ];
    expect((await resolveWith(results, 'The Lumineers', 'Cleopatra')).title).toBe('Cleopatra');
  });

  test('prefers the exact track over an anniversary edition ranked above it', async () => {
    const results = [
      r("What's up with the kids funzine", 'Best Coast - Boyfriend'),
      r('Best Coast', 'Boyfriend (10th Anniversary Edition)'),
      r('Best Coast', 'Boyfriend'),
    ];
    expect((await resolveWith(results, 'Best Coast', 'Boyfriend')).title).toBe('Boyfriend');
  });

  test('returns no match when only covers and remixes are found', async () => {
    expect(await resolveWith([r('Steven Gilpin (covering the Foo Fighters)', 'Dear Rosemary')], 'Foo Fighters', 'Dear Rosemary')).toBeNull();
    expect(await resolveWith([r('The Beatles', 'Dear Prudence (Cover)')], 'The Beatles', 'Dear Prudence')).toBeNull();
    expect(await resolveWith([r('Franz Ferdinand', 'TAKE ME OUT (FUZZ REMIX)')], 'Franz Ferdinand', 'Take Me Out')).toBeNull();
    expect(await resolveWith([r('Sparta', 'Lines In Sand (Acoustic)')], 'Sparta', 'Lines In Sand')).toBeNull();
  });

  test('a version word the requested title has is not a reason to reject', async () => {
    expect((await resolveWith([r('Oasis', 'Live Forever')], 'Oasis', 'Live Forever')).title).toBe('Live Forever');
    expect((await resolveWith([r('Franz Ferdinand', 'Take Me Out (Live)')], 'Franz Ferdinand', 'Take Me Out (Live)')).title)
      .toBe('Take Me Out (Live)');
  });

  test('matches across feat. credits and "Artist - Title" label uploads', async () => {
    expect((await resolveWith([r('Shakey Graves', 'Ready or Not (feat. Sierra Ferrell)')], 'Shakey Graves feat. Sierra Ferrell', 'Ready or Not')).title)
      .toBe('Ready or Not (feat. Sierra Ferrell)');
    expect((await resolveWith([r("You Won't", "You Won't - Who Knew")], "You Won't", 'Who Knew')).title).toBe("You Won't - Who Knew");
  });

  test('non-Latin names fall through to the top result that is not another version', async () => {
    const results = [r('ХЛЕБ', 'Яйца (live)'), r('ХЛЕБ', 'Яйца')];
    expect((await resolveWith(results, 'ХЛЕБ', 'Яйца')).title).toBe('Яйца');
  });

  test('no results is no match', async () => {
    expect(await resolveWith([], 'A', 'B')).toBeNull();
  });
});

describe('isOtherVersion (renderer)', () => {
  test.each([
    [['The Lumineers', 'Cleopatra (Live from Wrigley Field)'], ['The Lumineers', 'Cleopatra'], true],
    [['Steven Gilpin (covering the Foo Fighters)', 'Dear Rosemary'], ['Foo Fighters', 'Dear Rosemary'], true],
    [['Norah Jones, cover by Alex Morf', 'Lonestar'], ['Norah Jones', 'Lonestar'], true],
    [['Best Coast', 'Boyfriend (10th Anniversary Edition)'], ['Best Coast', 'Boyfriend'], false],
    [['Oasis', 'Live Forever'], ['Oasis', 'Live Forever'], false],
    [['Edith Piaf', 'La Vie en rose'], ['Edith Piaf', 'La Vie en rose'], false],
    [['Franz Ferdinand', 'Take Me Out (Live) [Remix]'], ['Franz Ferdinand', 'Take Me Out (Live)'], true],
  ])('%j for %j → %s', ([artist, title], [targetArtist, targetTitle], expected) => {
    expect(isOtherVersion({ artist, title }, targetArtist, targetTitle)).toBe(expected);
  });

  test('the plugin keeps the same word list (plugin functions cannot require renderer modules)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../plugins-src/bandcamp/implementation.js'), 'utf8');
    const m = src.match(/var VARIANT =\s*\/(.*)\/gi;/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(VARIANT_WORDS.source);
  });
});
