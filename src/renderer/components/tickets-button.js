// src/renderer/components/tickets-button.js: a concert's Tickets button, in
// the Concerts page's teal fill. The Concerts page, Home's concert cards and
// an artist's On tour tab use it.
//
// There were three copies: the Concerts page's (a #10c9b4 fill white text
// can't be read on, with a JS hover), the artist page's and Home's (an
// underlined accent link with its own hand-built dropdown). One seller is a
// link; several open the shared Menu with a link per seller.
//
// Props:
//   sources   [{ label, source, ticketUrl }]: only http(s) links are shown
//   artist    the act, for the accessible name ("Tickets for X")
//   size      a Button size ('sm' | 'md'), default 'md'
//   className extra classes (flex-shrink-0)
// Props-driven; loads under plain Node.

const { buttonClassName } = require('./button');
const { Menu } = require('./menu');
const Icons = require('./icons');
const { PAGE_COLORS } = require('../lib/page-colors');
const { sellerColor } = require('../lib/ticket-sellers');

const e = React.createElement;

const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url.trim());

function TicketsButton({ sources, artist, size = 'md', className }) {
  const safe = (sources || []).filter((s) => s && isHttpUrl(s.ticketUrl));
  if (safe.length === 0) return null;
  const look = {
    className: buttonClassName({ variant: 'primary', size, className: ['flex-shrink-0 no-drag', className].filter(Boolean).join(' ') }),
    style: { backgroundColor: PAGE_COLORS.concerts.fill },
  };
  const name = artist ? `Tickets for ${artist}` : undefined;
  if (safe.length === 1) {
    return e('a', Object.assign({
      href: safe[0].ticketUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': name,
      onClick: (ev) => ev.stopPropagation(),
    }, look), 'Tickets');
  }
  return e(Menu, {
    label: 'Tickets',
    align: 'right',
    items: safe.map((src, i) => ({ key: i, label: src.label || src.source || 'Tickets', dot: sellerColor(src.source), href: src.ticketUrl })),
    renderTrigger: (t) => e('button', Object.assign({}, t, { type: 'button', 'aria-label': name }, look),
      'Tickets',
      e(Icons.ChevronDown, { className: `w-3 h-3 transition-transform ${t.open ? 'rotate-180' : ''}`, strokeWidth: 2.5 })),
  });
}

module.exports = { TicketsButton };
