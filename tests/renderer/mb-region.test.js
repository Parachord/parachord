/**
 * mb-region (src/renderer/lib/mb-region.js): a MusicBrainz country code as a
 * readable name, for the album page's source card (#1238) — "Worldwide" and
 * "Europe" instead of XW and XE on the card's and the edition rows' second
 * line.
 */

const { regionName } = require('../../src/renderer/lib/mb-region');

describe('mb-region: MusicBrainz country codes as readable names', () => {
  test('the supranational codes Intl cannot name are covered by the overrides', () => {
    expect(regionName('XW')).toBe('Worldwide');
    expect(regionName('XE')).toBe('Europe');
  });

  test('the gone countries Intl maps to today\'s successor (or not at all)', () => {
    expect(regionName('XC')).toBe('Czechoslovakia');
    expect(regionName('XG')).toBe('East Germany');
    expect(regionName('SU')).toBe('Soviet Union');
    expect(regionName('YU')).toBe('Yugoslavia');
    expect(regionName('CS')).toBe('Serbia and Montenegro');
    // the ones Intl answers with the successor or the wrong country —
    // live-checked against Node's Intl (AN → Curaçao, ZR → Congo - Kinshasa,
    // TP → Timor-Leste, DY → Benin, HV → Burkina Faso, RH → Zimbabwe)
    expect(regionName('AN')).toBe('Netherlands Antilles');
    expect(regionName('ZR')).toBe('Zaire');
    expect(regionName('TP')).toBe('East Timor');
    expect(regionName('DY')).toBe('Dahomey');
    expect(regionName('HV')).toBe('Upper Volta');
    expect(regionName('RH')).toBe('Rhodesia');
  });

  test('plain ISO country codes go through Intl.DisplayNames', () => {
    expect(regionName('GB')).toBe('United Kingdom');
    expect(regionName('JP')).toBe('Japan');
    expect(regionName('DE')).toBe('Germany');
  });

  test('an unknown code falls back to the code itself', () => {
    expect(regionName('QQ')).toBe('QQ'); // Intl echoes it: unknown
    expect(regionName('X1')).toBe('X1'); // not even a valid subtag: Intl throws, the code stays
  });

  test('no code, no name (a catalog edition carries no region)', () => {
    expect(regionName(null)).toBe(null);
    expect(regionName('')).toBe(null);
    expect(regionName(undefined)).toBe(null);
  });
});
