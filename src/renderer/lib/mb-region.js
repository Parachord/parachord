// src/renderer/lib/mb-region.js — a MusicBrainz country code as a readable
// name, for the album page's source card (#1238). MusicBrainz releases carry
// ISO 3166-1 country codes ("GB", "JP"), its own supranational codes ("XW"
// Worldwide, "XE" Europe), and codes for areas that no longer exist. Node's
// Intl.DisplayNames handles the ISO countries but: returns the X-codes
// unchanged (XW is not an ISO country), maps the historical ones to today's
// successor (SU → Russia, not the Soviet Union; YU → Serbia, not Yugoslavia;
// CS → Serbia, not Serbia and Montenegro), and cannot name "Czechoslovakia"
// or "East Germany" at all. The override map below covers those seven
// (verified against MusicBrainz's areas list and Node's Intl); anything else
// unknown to Intl falls back to the code itself.

// MusicBrainz's own supranational codes, and the historical ones Intl maps
// to today's country or names wrong. Values verified against MusicBrainz's
// area data and Node's Intl (live-checked): AN, ZR and TP are the wrong-answer
// class; DY, HV and RH are the gone-country class; the X-codes are MB's own.
const MB_REGION_OVERRIDES = {
  XW: 'Worldwide',
  XE: 'Europe',
  XC: 'Czechoslovakia',
  XG: 'East Germany',
  SU: 'Soviet Union',
  YU: 'Yugoslavia',
  CS: 'Serbia and Montenegro',
  AN: 'Netherlands Antilles',
  ZR: 'Zaire',
  TP: 'East Timor',
  DY: 'Dahomey',
  HV: 'Upper Volta',
  RH: 'Rhodesia'
};

let displayNames = null;
const displayNamesFor = () => {
  if (!displayNames) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch (_e) { displayNames = null; }
  }
  return displayNames;
};

function regionName(code) {
  if (!code || typeof code !== 'string') return null;
  if (MB_REGION_OVERRIDES[code]) return MB_REGION_OVERRIDES[code];
  const intl = displayNamesFor();
  if (intl) {
    try {
      const name = intl.of(code);
      // An unknown code comes back as the code itself — show that as-is.
      if (name && name !== code) return name;
    } catch (_e) { /* fall through to the code */ }
  }
  return code;
}

module.exports = { regionName, MB_REGION_OVERRIDES };
