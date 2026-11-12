/**
 * Upcoming-release badges on recommended albums
 * (src/renderer/lib/release-date.js). No provider sends a release date
 * (Amazon's home albums carry none, live-checked 2026-11-12), so the page
 * looks each album card's first release date up on MusicBrainz and badges
 * one dated after today, like Fresh Drops' "Coming <date>".
 */
const {
  releaseDateKey,
  releaseGroupSearchUrl,
  pickReleaseGroupDate,
  upcomingLabel,
  RELEASE_DATE_TTL_MS
} = require('../../src/renderer/lib/release-date');

describe('release dates for recommended albums', () => {
  test('dates are kept a week (announced dates move)', () => {
    expect(RELEASE_DATE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('the key ignores case, accents and punctuation', () => {
    expect(releaseDateKey('Sigur Rós', 'Ágætis byrjun!')).toBe(releaseDateKey('sigur ros', 'agaetis byrjun'));
    expect(releaseDateKey('A', 'B')).not.toBe(releaseDateKey('A', 'C'));
  });

  test('the search asks MusicBrainz for the release group by title and artist, quotes escaped', () => {
    const url = releaseGroupSearchUrl('Black Country, New Road', 'Forever "Howlong"');
    expect(url.startsWith('https://musicbrainz.org/ws/2/release-group/?query=')).toBe(true);
    const q = decodeURIComponent(new URL(url).searchParams.get('query'));
    expect(q).toBe('releasegroup:"Forever \\"Howlong\\"" AND artist:"Black Country, New Road"');
    expect(new URL(url).searchParams.get('fmt')).toBe('json');
    expect(new URL(url).searchParams.get('limit')).toBe('5');
  });

  test('the search asks for the title without store decorations', () => {
    const q = (title) => decodeURIComponent(new URL(releaseGroupSearchUrl('X', title)).searchParams.get('query'));
    expect(q('Either/Or: Expanded Edition')).toBe('releasegroup:"Either/Or" AND artist:"X"');
    expect(q('Yankee Hotel Foxtrot (Expanded Edition)')).toBe('releasegroup:"Yankee Hotel Foxtrot" AND artist:"X"');
    expect(q('Diydui - EP')).toBe('releasegroup:"Diydui" AND artist:"X"');
    expect(q('Sketches [Explicit] (Deluxe)')).toBe('releasegroup:"Sketches" AND artist:"X"');
    // A colon that is part of the title stays.
    expect(q('Hecklers Choice: Big Gums and Heavy Lifters')).toBe('releasegroup:"Hecklers Choice: Big Gums and Heavy Lifters" AND artist:"X"');
  });

  const rg = (title, artist, date, extra = {}) => ({
    title,
    'first-release-date': date,
    'primary-type': 'Album',
    'artist-credit': [{ name: artist, artist: { name: artist } }],
    ...extra
  });

  test('picks the matching release group\'s first release date', () => {
    const groups = [
      rg('Some Other Album', 'FIDLAR', '2019-01-25'),
      rg('Surviving the Dream', 'FIDLAR', '2026-12-05')
    ];
    expect(pickReleaseGroupDate(groups, { artist: 'FIDLAR', title: 'SURVIVING THE DREAM' })).toBe('2026-12-05');
  });

  test('a title with an edition or explicit marker still matches the plain group', () => {
    const groups = [rg('Either/Or', 'Elliott Smith', '1997-02-25')];
    expect(pickReleaseGroupDate(groups, { artist: 'Elliott Smith', title: 'Either/Or (Expanded Edition)' })).toBe('1997-02-25');
    expect(pickReleaseGroupDate(groups, { artist: 'Elliott Smith', title: 'Either/Or [Explicit]' })).toBe('1997-02-25');
    expect(pickReleaseGroupDate(groups, { artist: 'Elliott Smith', title: 'Either/Or: Expanded Edition' })).toBe('1997-02-25');
  });

  test('another artist\'s album of the same name never counts', () => {
    const groups = [rg('Love', 'Someone Else', '2027-01-01')];
    expect(pickReleaseGroupDate(groups, { artist: 'Michael Bublé', title: 'Love' })).toBeNull();
  });

  test('an album beats a single of the same name; no date, or nothing matching, is null', () => {
    const groups = [
      rg('Too', 'FIDLAR', '2027-03-01', { 'primary-type': 'Single' }),
      rg('Too', 'FIDLAR', '2015-09-04')
    ];
    expect(pickReleaseGroupDate(groups, { artist: 'FIDLAR', title: 'Too' })).toBe('2015-09-04');
    expect(pickReleaseGroupDate([rg('Too', 'FIDLAR', '')], { artist: 'FIDLAR', title: 'Too' })).toBeNull();
    expect(pickReleaseGroupDate([], { artist: 'FIDLAR', title: 'Too' })).toBeNull();
    expect(pickReleaseGroupDate(undefined, { artist: 'FIDLAR', title: 'Too' })).toBeNull();
  });

  describe('upcomingLabel', () => {
    const today = new Date('2026-11-12T15:00:00');

    test('a full date after today is "Coming <Mon D>"', () => {
      expect(upcomingLabel('2026-11-21', today)).toBe('Coming Nov 21');
      expect(upcomingLabel('2027-02-03', today)).toBe('Coming Feb 3, 2027');
    });

    test('today or earlier is no badge', () => {
      expect(upcomingLabel('2026-11-12', today)).toBeNull();
      expect(upcomingLabel('1997-02-25', today)).toBeNull();
    });

    test('a month-only date counts once the month is later; a year-only date once the year is', () => {
      expect(upcomingLabel('2026-12', today)).toBe('Coming Dec 2026');
      expect(upcomingLabel('2026-11', today)).toBeNull();
      expect(upcomingLabel('2027', today)).toBe('Coming 2027');
      expect(upcomingLabel('2026', today)).toBeNull();
    });

    test('anything else is no badge', () => {
      for (const v of [null, undefined, '', 'soon', '2026-13-01', 20261121]) expect(upcomingLabel(v, today)).toBeNull();
    });
  });
});
