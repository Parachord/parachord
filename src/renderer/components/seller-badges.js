// src/renderer/components/seller-badges.js: where a concert's tickets come
// from, as pills after its title (the Concerts page and an artist's On tour
// tab).
//
// Both pages drew their own pill: abbreviations ("SG", "TM") in a hand-built
// span with a native title, unlike every other service pill. Each seller is
// now the shared Badge in its plug-in's colour (lib/ticket-sellers.js
// sellerColor) with its full name; a concert found by Shuffleupagus is the
// AI badge the playlists use, followed by the note that AI results need
// checking.
//
// Props: sources: [{ source, label?, aiProviderName? }] (event.ticketSources,
// or the event's own source).
// Props-driven; loads under plain Node.

const { Badge } = require('./badge');
const Icons = require('./icons');
const { sellerColor, sellerName } = require('../lib/ticket-sellers');

function SellerBadges({ sources }) {
  const e = React.createElement;
  const list = Array.isArray(sources) ? sources : [];
  const badges = list.map((src, i) => (src && src.source === 'ai'
    ? e(Badge, { key: `seller-${i}`, tone: 'accent', icon: Icons.Sparkles, tooltip: 'Found by Shuffleupagus' }, src.aiProviderName || 'AI')
    : e(Badge, { key: `seller-${i}`, color: sellerColor(src && src.source) }, sellerName(src || {}))));
  if (list.some((s) => s && s.source === 'ai')) {
    badges.push(e('span', {
      key: 'ai-note',
      className: 'text-xs text-page-concerts italic flex-shrink-0',
      'data-tooltip': 'AI-generated results may not be accurate. Check the details before buying tickets.',
    }, 'AI results may be wrong'));
  }
  return badges;
}

module.exports = { SellerBadges };
