// components/seller-badges.js: a concert's ticket sellers as the shared
// Badge, in each seller plug-in's colour, with its full name.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { SellerBadges } = require('../../src/renderer/components/seller-badges');
const { setSellerColorLookup } = require('../../src/renderer/lib/ticket-sellers');

const html = (sources) => renderToStaticMarkup(React.createElement('div', null, ...SellerBadges({ sources })));

beforeAll(() => setSellerColorLookup((id) => ({ seatgeek: '#FF5B49', ticketmaster: '#026CDF' }[id] || null)));

test('each seller is a Badge with its full name, tinted by its plug-in colour', () => {
  const out = html([{ source: 'seatgeek' }, { source: 'ticketmaster' }]);
  expect(out).toContain('>SeatGeek<');
  expect(out).toContain('>Ticketmaster<');
  expect(out).not.toMatch(/>SG<|>TM</);
  expect(out).toContain('data-badge');
  expect(out).toContain('background-color:#FF5B49');
  expect(out).not.toContain('title=');
});

test('a concert Shuffleupagus found: the AI badge and the note, with a shared tooltip', () => {
  const out = html([{ source: 'ai', aiProviderName: 'ChatGPT' }]);
  expect(out).toContain('>ChatGPT<');
  expect(out).toContain('AI results may be wrong');
  expect(out).toContain('data-tooltip="AI-generated results may not be accurate. Check the details before buying tickets."');
});

test('no sources: nothing', () => {
  expect(SellerBadges({ sources: [] })).toEqual([]);
});
