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

  // #1306: containment accepted a medley whose title lists the song.
  test('a medley that lists the song is not the song', async () => {
    const medley = r('The Beatles', 'You Never Give Me Your Money/Sun King/Mean Mr. Mustard/Polythene Pam/She Came in Through the Bathroom Window/Golden Slumbers/Carry That Weight/The End/Her Majesty');
    expect(await resolveWith([medley], 'The Beatles', 'Her Majesty')).toBeNull();
    expect((await resolveWith([medley, r('The Beatles', 'Her Majesty')], 'The Beatles', 'Her Majesty')).title).toBe('Her Majesty');
    expect(await resolveWith([r('Erykah Badu', 'Breezy Medley')], 'Erykah Badu', 'Breezy')).toBeNull();
  });

  test('a slash that does not join songs still matches', async () => {
    expect((await resolveWith([r('AC/DC', 'AC/DC - Back in Black')], 'AC/DC', 'Back in Black')).title).toBe('AC/DC - Back in Black');
    expect((await resolveWith([r('Ty Dolla $ign', 'Paranoid (w/ B.o.B)')], 'Ty Dolla $ign', 'Paranoid')).title).toBe('Paranoid (w/ B.o.B)');
    expect((await resolveWith([r('Ghostface Killah', '24/7')], 'Ghostface Killah', '24/7')).title).toBe('24/7');
    expect((await resolveWith([r('Diana Ross', 'Upside Down / Medley')], 'Diana Ross', 'Upside Down / Medley')).title).toBe('Upside Down / Medley');
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
    [['The Beatles', 'You Never Give Me Your Money/Sun King/The End/Her Majesty'], ['The Beatles', 'Her Majesty'], true],
    [['The Beatles', 'Abbey Road Medley'], ['The Beatles', 'Her Majesty'], true],
    [['Bill Medley', 'Brown Eyed Woman'], ['Bill Medley', 'Brown Eyed Woman'], false],
    [['AC/DC', 'AC/DC - Back in Black'], ['AC/DC', 'Back in Black'], false],
    [['Ghostface Killah', '24/7'], ['Ghostface Killah', '24/7'], false],
    [['Ty Dolla $ign', 'Paranoid (w/ B.o.B)'], ['Ty Dolla $ign', 'Paranoid'], false],
  ])('%j for %j → %s', ([artist, title], [targetArtist, targetTitle], expected) => {
    expect(isOtherVersion({ artist, title }, targetArtist, targetTitle)).toBe(expected);
  });

  test.each(['bandcamp', 'soundcloud', 'amazonmusic'])('the %s plugin keeps the same word list and slash check (plugin functions cannot require renderer modules)', (id) => {
    const src = fs.readFileSync(path.join(__dirname, `../../plugins-src/${id}/implementation.js`), 'utf8');
    const m = src.match(/var VARIANT =\s*\/(.*)\/gi;/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(VARIANT_WORDS.source);
    const shared = fs.readFileSync(path.join(__dirname, '../../sync-providers/track-variants.js'), 'utf8');
    for (const re of [/s\.replace\((\/\\bw.*?\/g), ' '\)/, /return (\/\[\^\\s\\d\].*?\/)\.test\(s\)/]) {
      const want = shared.match(re);
      expect(want).not.toBeNull();
      expect(src).toContain(want[1]);
    }
  });
});
