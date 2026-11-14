// Concerts keeps one row per show. A show with two of the user's artists on
// the bill came back once per artist with one event id (Ticketmaster's
// tm-vv1A7Zk4aGkeVuzpx: Modest Mouse AND Interpol at the Aragon Ballroom),
// and both de-duplication keys contained the artist, so both rows survived.
// The list keys its rows by event id; two rows with one key leave stale rows
// behind after a search or filter (2026-11).

const fs = require('fs');
const path = require('path');
const { uniqueConcerts } = require('../../src/renderer/lib/concert-events');

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
    expect(out[0].artist).toBe('Modest Mouse');
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
