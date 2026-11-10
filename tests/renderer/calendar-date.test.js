// MusicBrainz dates are calendar dates ("2026-11-06", "2026-11", "2026"), not
// moments. new Date("2026-11-06") is midnight UTC, which is still November 5 in
// the Americas, so the album page showed "November 5, 2026" for a November 6
// release (#1288), and a year-only date showed as December 31 of the year before.
// Run in a US time zone so the old parsing would fail here.
process.env.TZ = 'America/Los_Angeles';

const fs = require('fs');
const path = require('path');
const { formatCalendarDate } = require('../../src/renderer/lib/calendar-date');

describe('formatCalendarDate', () => {
  test('a full date shows its own day', () => {
    expect(formatCalendarDate('2026-11-06')).toBe('November 6, 2026');
    expect(formatCalendarDate('2026-11-06', 'short')).toBe('Nov 6, 2026');
    expect(formatCalendarDate('2026-01-01')).toBe('January 1, 2026');
  });

  test('a year-month date shows the month', () => {
    expect(formatCalendarDate('2026-11')).toBe('November 2026');
    expect(formatCalendarDate('2026-11', 'short')).toBe('Nov 2026');
  });

  test('a year-only date shows the year', () => {
    expect(formatCalendarDate('2026')).toBe('2026');
    expect(formatCalendarDate('1969', 'short')).toBe('1969');
  });

  test('an impossible date or other text is shown as given', () => {
    expect(formatCalendarDate('2026-13-40')).toBe('2026-13-40');
    expect(formatCalendarDate('soon')).toBe('soon');
  });

  test('nothing gives the fallback', () => {
    expect(formatCalendarDate('')).toBe('');
    expect(formatCalendarDate(null, 'long', 'Unknown')).toBe('Unknown');
  });
});

describe('the pages use it', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer/components', p), 'utf8');
  test('the album page date (the source card\'s second line, #1238)', () => {
    const cards = read('cards.js');
    expect(cards).toContain("formatCalendarDate(release.date, 'short', '')");
  });
  test("an artist's founded date", () => {
    const artist = read('artist-page.js');
    expect(artist).toContain("formatCalendarDate(artistExtendedInfo.foundedDate, 'short')");
  });
});
