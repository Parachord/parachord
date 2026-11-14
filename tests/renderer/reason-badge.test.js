/**
 * The "why it's here" badge (components/reason-badge.js): one component for
 * Home's album cards and the Recommendations page's album and artist cards.
 */
global.React = require('react');
global.ReactDOM = require('react-dom');
const fs = require('fs');
const path = require('path');
const { renderToStaticMarkup } = require('react-dom/server');
const { ReasonBadge, shuffleupagusBadgeProps } = require('../../src/renderer/components/reason-badge');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('shuffleupagusBadgeProps', () => {
  test("Shuffleupagus's own items and merged items it sent get the badge", () => {
    expect(shuffleupagusBadgeProps({ resolverId: 'shuffleupagus', reason: 'Because slowcore' }))
      .toEqual({ label: 'Why Shuffleupagus picked this', text: 'Because slowcore' });
    expect(shuffleupagusBadgeProps({ sourceIds: ['lastfm', 'shuffleupagus'] }).text).toBe('Picked by Shuffleupagus');
  });
  test('other sources get none', () => {
    expect(shuffleupagusBadgeProps({ sourceIds: ['lastfm'], reason: 'Similar to X' })).toBeNull();
    expect(shuffleupagusBadgeProps(null)).toBeNull();
  });
});

describe('ReasonBadge', () => {
  test('a named button described by a hidden copy of the reason', () => {
    const html = renderToStaticMarkup(React.createElement(ReasonBadge, { label: 'Why Shuffleupagus picked this', text: 'Because slowcore' }));
    expect(html).toMatch(/<button type="button" aria-label="Why Shuffleupagus picked this" aria-describedby="([^"]+)-why"/);
    expect(html).toMatch(/-why"[^>]*>Because slowcore<\/span>/);
    expect(html).toMatch(/<svg/);
  });
  test('no text, no badge', () => {
    expect(renderToStaticMarkup(React.createElement(ReasonBadge, { label: 'x', text: '' }))).toBe('');
  });
});

describe('Recommendations cards carry it', () => {
  test('album and artist cards render the badge on the cover', () => {
    expect(app.match(/shuffleupagusBadgeProps\(item\) && React\.createElement\(ReasonBadge, shuffleupagusBadgeProps\(item\)\)/g)).toHaveLength(2);
  });
  test("a Shuffleupagus pick's reason is on the badge, not also on the name", () => {
    expect(app.match(/item\.reason && !shuffleupagusBadgeProps\(item\)\n\s*\? React\.createElement\(FixedTooltip/g)).toHaveLength(2);
  });
  test('Home uses the same component', () => {
    const home = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/home-sections.js'), 'utf8');
    expect(home).toMatch(/badge && e\(ReasonBadge, badge\)/);
  });
});
