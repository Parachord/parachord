// Concerts keeps one row per show. A show with two of the user's artists on
// the bill came back once per artist with one event id (Ticketmaster's
// tm-vv1A7Zk4aGkeVuzpx: Modest Mouse AND Interpol at the Aragon Ballroom),
// and both de-duplication keys contained the artist, so both rows survived.
// The list keys its rows by event id; two rows with one key leave stale rows
// behind after a search or filter (2026-11).

const fs = require('fs');
const path = require('path');
const { uniqueConcerts, concertSourceKeys, concertMatchesSource } = require('../../src/renderer/lib/concert-events');

const ROOT = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

const seller = (source, extra = {}) => ({ source, aiProvider: null, ticketUrl: `https://${source}.example/t`, label: source, ...extra });
const show = (id, artist, extra = {}) => ({
  id, source: 'ticketmaster', artist, date: '2026-12-09',
  venue: { name: 'Aragon Ballroom', city: 'Chicago' },
  lineup: ['Q101 Twisted Xmas', 'Interpol', 'Modest Mouse', 'Brigitte Calls Me Baby'],
  ticketSources: [seller('ticketmaster')],
  artistSource: 'history',
  ...extra,
});

describe('uniqueConcerts', () => {
  test('one row per event id, even when it was found under two artists', () => {
    const out = uniqueConcerts([show('tm-1', 'Modest Mouse'), show('tm-1', 'Interpol')]);
    expect(out).toHaveLength(1);
    // Interpol is billed above Modest Mouse on the lineup
    expect(out[0].artist).toBe('Interpol');
  });

  test('the fresh copy wins, and a stale cached copy with another date or venue is dropped', () => {
    const fresh = show('sg-18739689', 'Nathaniel Rateliff', { date: '2026-12-06', venue: { name: 'Vilar Performing Arts Center' } });
    const stale = show('sg-18739689', 'Nathaniel Rateliff', { date: '2027-12-06', venue: { name: 'Vilar Center' } });
    const out = uniqueConcerts([fresh, stale]);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('2026-12-06');
    expect(out[0].venue.name).toBe('Vilar Performing Arts Center');
  });

  test('ticket sources are unioned across the copies', () => {
    const out = uniqueConcerts([
      show('sg-1', 'Fontaines D.C.', { ticketSources: [seller('seatgeek')] }),
      show('sg-1', 'Westside Cowboy', { ticketSources: [seller('seatgeek'), seller('ticketmaster')] }),
    ]);
    expect(out[0].ticketSources.map(s => s.source)).toEqual(['seatgeek', 'ticketmaster']);
  });

  test('every artist a copy was found under is on the kept row\'s lineup, once', () => {
    const out = uniqueConcerts([
      show('tm-2', 'Modest Mouse', { lineup: [] }),
      show('tm-2', 'Interpol', { lineup: [] }),
      show('tm-2', 'interpol', { lineup: [] }),
    ]);
    expect(out[0].lineup).toEqual(['Modest Mouse', 'Interpol']);
  });

  test('a richer lineup from a later copy adds the names the kept one lacks', () => {
    const out = uniqueConcerts([
      show('tm-3', 'Beck', { lineup: ['Beck'] }),
      show('tm-3', 'Courtney Barnett', { lineup: ['The Strokes', 'Beck', 'Courtney Barnett'] }),
    ]);
    expect(out[0].lineup).toEqual(['Beck', 'The Strokes', 'Courtney Barnett']);
  });

  test('without a shared id the old date + artist + venue key still merges', () => {
    const out = uniqueConcerts([
      show('sg-9', 'Friko', { venue: { name: 'Merriweather Post Pavilion' }, ticketSources: [seller('seatgeek')] }),
      show('tm-9', 'Friko', { venue: { name: 'Merriweather Post Pavilion, Columbia MD' }, ticketSources: [seller('ticketmaster')] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('sg-9');
    expect(out[0].ticketSources.map(s => s.source)).toEqual(['seatgeek', 'ticketmaster']);
  });

  test('different shows stay, in order, and the inputs are not changed', () => {
    const a = show('tm-a', 'Modest Mouse');
    const b = show('tm-b', 'Modest Mouse', { date: '2027-01-16', venue: { name: 'Kia Forum' } });
    const c = show('tm-a', 'Interpol');
    const before = JSON.stringify([a, b, c]);
    const out = uniqueConcerts([a, b, c]);
    expect(out.map(e => e.id)).toEqual(['tm-a', 'tm-b']);
    expect(JSON.stringify([a, b, c])).toBe(before);
  });

  test('tolerates junk and events without an id', () => {
    const out = uniqueConcerts([null, 'x', show(undefined, 'Greg Freeman'), show(undefined, 'Greg Freeman', { date: '2027-02-11' })]);
    expect(out).toHaveLength(2);
    expect(uniqueConcerts(undefined)).toEqual([]);
  });
});

// A merged show is listed under its headliner, not whichever copy came
// first: from the date-sorted cache that was often the opener, and Home's
// "Concerts near you" shows only the row's artist.
describe('uniqueConcerts: the headliner names the row', () => {
  const tour = (artist, artistSource, extra = {}) => show('sg-fontaines', artist, {
    source: 'seatgeek', date: '2027-04-27', venue: { name: 'Fox Theatre Detroit' },
    lineup: ['Fontaines D.C.', 'Westside Cowboy'], artistSource, ...extra,
  });

  test('the opener found first gives way to the headliner, with its artistSource', () => {
    const out = uniqueConcerts([tour('Westside Cowboy', 'history', { description: 'fresh' }), tour('Fontaines D.C.', 'collection', { description: 'cached' })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ artist: 'Fontaines D.C.', artistSource: 'collection', description: 'fresh' });
    expect(out[0].lineup).toEqual(['Fontaines D.C.', 'Westside Cowboy']);
  });

  test('billing order wins over the artist source (Dinosaur Jr. over Horse Jumper of Love)', () => {
    const bill = { date: '2027-03-13', venue: { name: 'Citizens House of Blues Boston' }, lineup: ['Dinosaur Jr.', 'Horse Jumper of Love'] };
    const out = uniqueConcerts([
      show('sg-dino', 'Horse Jumper of Love', { ...bill, artistSource: 'library' }),
      show('sg-dino', 'Dinosaur Jr.', { ...bill, artistSource: 'history' }),
    ]);
    expect(out[0]).toMatchObject({ artist: 'Dinosaur Jr.', artistSource: 'history' });
  });

  test('an artist not on the lineup ranks after those that are', () => {
    const out = uniqueConcerts([
      show('tm-x', 'Somebody Else', { lineup: ['Beck', 'Courtney Barnett'], artistSource: 'collection' }),
      show('tm-x', 'Courtney Barnett', { lineup: ['Beck', 'Courtney Barnett'], artistSource: 'history' }),
    ]);
    expect(out[0]).toMatchObject({ artist: 'Courtney Barnett', artistSource: 'history' });
  });

  test('a tie goes to collection, then library, then history, then the first copy', () => {
    const noBill = { lineup: [] };
    const bySource = uniqueConcerts([
      show('tm-t', 'A', { ...noBill, artistSource: 'history' }),
      show('tm-t', 'B', { ...noBill, artistSource: 'library' }),
      show('tm-t', 'C', { ...noBill, artistSource: 'collection' }),
    ]);
    expect(bySource[0]).toMatchObject({ artist: 'C', artistSource: 'collection' });
    const first = uniqueConcerts([show('tm-u', 'A', noBill), show('tm-u', 'B', noBill)]);
    expect(first[0].artist).toBe('A');
  });

  test('lineup names match through normalizeForDedup ("Fontaines DC" is "Fontaines D.C.")', () => {
    const out = uniqueConcerts([
      tour('Westside Cowboy', 'history'),
      tour('Fontaines DC', 'collection', { lineup: ['Fontaines DC', 'Westside Cowboy'] }),
    ]);
    expect(out[0].lineup).toEqual(['Fontaines D.C.', 'Westside Cowboy']);
    expect(out[0].artist).toBe('Fontaines DC');
  });
});

describe('the concerts loader uses it', () => {
  test('the merge of fresh results with the cache goes through uniqueConcerts', () => {
    const at = app.indexOf('const merged = [...allEvents, ...priorCachedEvents];');
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 1500)).toMatch(/uniqueConcerts\(/);
  });

  test('a restored cache is healed on launch', () => {
    const at = app.indexOf("const concertsData = dCaches['cache_concerts'];");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 1200)).toMatch(/uniqueConcerts\(concertsData\.events\)/);
  });
});

// A show two services both list is one row whose ticketSources name both.
// The source filter used to read only event.source (whichever service found
// it first), so picking the other service hid the show, and a service whose
// shows had all merged into another's never appeared in the dropdown.
describe('the source filter sees every service that lists a show', () => {
  const merged = {
    id: 'tm-1', source: 'ticketmaster', artist: 'Interpol',
    ticketSources: [
      { source: 'ticketmaster', ticketUrl: 'https://tm.example/1' },
      { source: 'seatgeek', ticketUrl: 'https://sg.example/1' },
    ],
  };
  const ai = { id: 'ai-1', source: 'ai', aiProvider: 'claude', ticketSources: [{ source: 'ai', aiProvider: 'claude' }] };

  test('concertSourceKeys lists the event source and every ticket source, once each', () => {
    expect(concertSourceKeys(merged)).toEqual(['ticketmaster', 'seatgeek']);
    expect(concertSourceKeys(ai)).toEqual(['ai:claude']);
    expect(concertSourceKeys({ source: 'songkick' })).toEqual(['songkick']);
    expect(concertSourceKeys(null)).toEqual([]);
  });

  test('a merged show matches either service', () => {
    expect(concertMatchesSource(merged, 'all')).toBe(true);
    expect(concertMatchesSource(merged, 'ticketmaster')).toBe(true);
    expect(concertMatchesSource(merged, 'seatgeek')).toBe(true);
    expect(concertMatchesSource(merged, 'songkick')).toBe(false);
    expect(concertMatchesSource(ai, 'ai:claude')).toBe(true);
    expect(concertMatchesSource(ai, 'ai:gemini')).toBe(false);
  });

  test('the Concerts page filters and lists sources through them', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    expect((src.match(/concertMatchesSource\(event, concertsSourceFilter\)/g) || []).length).toBe(2);
    expect(src).toMatch(/for \(const key of concertSourceKeys\(event\)\)/);
    expect(src).not.toMatch(/\} else if \(event\.source !== concertsSourceFilter\)/);
  });
});
