// src/renderer/lib/ticket-sellers.js: a concert ticket seller's colour and
// names, for the Concerts page and the artist page's On Tour tab (#1383
// step 6).
//
// A seller's colour is its plug-in's (manifest.color), read from the plug-in
// registry: app.js hands this module a lookup once (setSellerColorLookup).
// This used to keep its own copy of the four manifest colours, which a new
// seller plug-in would not have been in. The shade is mixed with the theme's
// text colour, so one value reads on both themes: darker on light pages,
// lighter on dark.
//
// Loads under plain Node.

const { PAGE_COLORS } = require('./page-colors');

// Unknown and AI-found sources, and any seller before the plug-ins load:
// the Concerts page colour.
const FALLBACK = PAGE_COLORS.concerts.color;

let lookup = () => null;
// fn(sellerId) -> the seller plug-in's colour, or null when unknown.
function setSellerColorLookup(fn) { lookup = typeof fn === 'function' ? fn : () => null; }

const SELLER_NAMES = {
  bandsintown: ['BIT', 'Bandsintown'],
  songkick: ['SK', 'Songkick'],
  seatgeek: ['SG', 'SeatGeek'],
  ticketmaster: ['TM', 'Ticketmaster'],
};

const sellerColor = (source) => (source && lookup(source)) || FALLBACK;
// Text in the seller's colour, readable on the page in either theme.
const sellerTextColor = (source) => `color-mix(in srgb, ${sellerColor(source)} 70%, var(--text-primary))`;
// A badge's faint fill.
const sellerBadgeBg = (source) => `color-mix(in srgb, ${sellerColor(source)} 15%, transparent)`;
const sellerShortName = (src) => (SELLER_NAMES[src.source] || [])[0] || src.label || 'Unknown';
const sellerName = (src) => (SELLER_NAMES[src.source] || [])[1] || src.label || 'Unknown';

module.exports = { setSellerColorLookup, sellerColor, sellerTextColor, sellerBadgeBg, sellerShortName, sellerName };
