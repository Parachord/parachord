// src/renderer/lib/ticket-sellers.js: a concert ticket seller's colour and
// names, for the Concerts page and the artist page's On Tour tab (#1383
// step 6).
//
// Both kept a per-theme table of these (a lighter shade in dark mode). The
// colours now come from one brand value per seller, the same as its plugin's
// manifest.color, and the shade is mixed with the theme's text colour, so
// one value reads on both themes: darker on light pages, lighter on dark.
//
// Loads under plain Node.

const SELLER_COLORS = {
  bandsintown: '#00B4B3',
  songkick: '#F80046',
  seatgeek: '#FC4C02',
  ticketmaster: '#026CDF',
};
// Unknown and AI-found sources: the Concerts page colour.
const FALLBACK = '#10c9b4';

const SELLER_NAMES = {
  bandsintown: ['BIT', 'Bandsintown'],
  songkick: ['SK', 'Songkick'],
  seatgeek: ['SG', 'SeatGeek'],
  ticketmaster: ['TM', 'Ticketmaster'],
};

const sellerColor = (source) => SELLER_COLORS[source] || FALLBACK;
// Text in the seller's colour, readable on the page in either theme.
const sellerTextColor = (source) => `color-mix(in srgb, ${sellerColor(source)} 70%, var(--text-primary))`;
// A badge's faint fill.
const sellerBadgeBg = (source) => `color-mix(in srgb, ${sellerColor(source)} 15%, transparent)`;
const sellerShortName = (src) => (SELLER_NAMES[src.source] || [])[0] || src.label || 'Unknown';
const sellerName = (src) => (SELLER_NAMES[src.source] || [])[1] || src.label || 'Unknown';

module.exports = { SELLER_COLORS, sellerColor, sellerTextColor, sellerBadgeBg, sellerShortName, sellerName };
