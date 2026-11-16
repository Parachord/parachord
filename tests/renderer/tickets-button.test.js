/**
 * A concert's Tickets button is one shared component
 * (components/tickets-button.js), in the Concerts hero's teal with white text: the
 * Concerts page, Home's concert cards and an artist's On tour tab. There were
 * three copies (the Concerts page's with a JS hover, the artist page's in a
 * darker teal, and Home's underlined link with its own dropdown), 2026-11-15.
 */
global.React = require('react');
global.ReactVirtual = global.ReactVirtual || {};
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { TicketsButton } = require('../../src/renderer/components/tickets-button');

const h = (props) => renderToStaticMarkup(React.createElement(TicketsButton, props));
const R = path.join(__dirname, '../../src/renderer');

test('one seller: a teal link to it, named for the act', () => {
  const html = h({ sources: [{ source: 'songkick', label: 'Songkick', ticketUrl: 'https://s' }], artist: 'Hovvdy' });
  expect(html).toMatch(/^<a href="https:\/\/s" target="_blank" rel="noopener noreferrer" aria-label="Tickets for Hovvdy"[^>]*style="background-color:var\(--page-concerts\);color:var\(--on-accent\)"[^>]*>Tickets<\/a>$/);
});

test('several sellers: the shared menu trigger, closed', () => {
  const html = h({ sources: [{ source: 'a', ticketUrl: 'https://a' }, { source: 'b', ticketUrl: 'https://b' }], artist: 'X' });
  expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  expect(html).toContain('background-color:var(--page-concerts);color:var(--on-accent)');
  expect(html).not.toContain('https://a');
});

test('only http(s) links count; none means no button', () => {
  expect(h({ sources: [{ ticketUrl: 'javascript:alert(1)' }] })).toBe('');
  expect(h({ sources: [] })).toBe('');
  expect(h({ sources: [{ ticketUrl: 'javascript:x' }, { ticketUrl: ' https://ok' }] })).toContain('href=" https://ok"');
});

test('the Concerts page, Home and the artist page all use it; no copy is left', () => {
  const files = ['app.js', 'components/home-sections.js', 'components/artist-page.js'].map((f) => fs.readFileSync(path.join(R, f), 'utf8'));
  for (const src of files) expect(src).toContain('TicketsButton');
  expect(files[0]).not.toContain("backgroundColor = '#0eb3a0'");
  expect(files[1]).not.toContain('function TicketsLink');
  for (const src of files) expect(src).not.toMatch(/renderTrigger[\s\S]{0,300}'Tickets'/);
});
