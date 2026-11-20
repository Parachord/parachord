// Concerts near a location, by text (#1568): the fallback when the location
// or the venue has no coordinates. It matched with substrings, so a venue's
// state code was found inside the location's city name: every Indiana show
// ("IN") was near "Princeton", California's ("CA") near "Chicago",
// Massachusetts' ("MA") near "Miami". The rule now compares whole names.

const { venueMatchesLocationText } = require('../../src/renderer/lib/concert-events');
const app = require('../helpers/renderer-source').appWithPages();

const venue = (city, region) => ({ name: 'Some Venue', city, region });

describe('venueMatchesLocationText', () => {
  test.each([
    ['Princeton, Mercer County', venue('Indianapolis', 'IN')],
    ['Chicago, Cook County', venue('Los Angeles', 'CA')],
    ['Miami', venue('Boston', 'MA')],
    ['Chicago', venue('Fort Wayne', 'IN')],
  ])('a state code is not found inside "%s"', (location, v) => {
    expect(venueMatchesLocationText(v, location)).toBe(false);
  });

  test('the venue city is the location\'s city, in any case and spacing', () => {
    expect(venueMatchesLocationText(venue('Chicago', 'IL'), 'Chicago, Cook County')).toBe(true);
    expect(venueMatchesLocationText(venue(' chicago ', 'IL'), 'CHICAGO')).toBe(true);
  });

  test('a location typed with its state but no comma still matches its city', () => {
    expect(venueMatchesLocationText(venue('Chicago', 'IL'), 'Chicago IL')).toBe(true);
    expect(venueMatchesLocationText(venue('New York', 'NY'), 'New York City')).toBe(true);
  });

  test('a city is not matched inside another city\'s name', () => {
    expect(venueMatchesLocationText(venue('York', 'PA'), 'New York')).toBe(false);
    expect(venueMatchesLocationText(venue('Chicago Heights', 'IL'), 'Chicago')).toBe(false);
  });

  test('the region matches a whole part of the location', () => {
    expect(venueMatchesLocationText(venue('Brooklyn', 'NY'), 'New York, NY')).toBe(true);
    expect(venueMatchesLocationText(venue('Bloomington', 'IN'), 'IN')).toBe(true);
    expect(venueMatchesLocationText(venue('Bloomington', 'IN'), 'Princeton, NJ')).toBe(false);
  });

  test('nothing to compare is no match', () => {
    expect(venueMatchesLocationText(venue('', ''), 'Chicago')).toBe(false);
    expect(venueMatchesLocationText(null, 'Chicago')).toBe(false);
    expect(venueMatchesLocationText(venue('Chicago', 'IL'), '')).toBe(false);
  });
});

describe('Home and the Concerts page use it', () => {
  test('no substring match on a venue city or region is left', () => {
    expect(app).not.toMatch(/locCity\.includes\((city|region)\)/);
  });
  test('Home\'s Concerts near you and the Concerts page call the shared rule', () => {
    expect(app).toMatch(/venueMatchesLocationText\(event\.venue, concertsLocation\)/);
    const page = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/concerts-page.js'), 'utf8');
    expect((page.match(/venueMatchesLocationText\(event\.venue, /g) || []).length).toBe(4);
  });
});
