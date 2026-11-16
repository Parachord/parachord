// A friend's hexagon avatar (components/friend-avatar.js): their photo, or
// their initial on the avatar gradient; one look in the sidebar and on
// their profile page (whose hero drew the initial on translucent white).
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { FriendAvatar } = require('../../src/renderer/components/friend-avatar');
const html = (p) => renderToStaticMarkup(React.createElement(FriendAvatar, p));

test('no photo: the initial on the avatar gradient, in the hexagon', () => {
  const out = html({ name: 'kutx', size: 'lg' });
  expect(out).toContain('background:var(--avatar-gradient)');
  expect(out).toContain('color:var(--on-accent)');
  expect(out).toMatch(/>K<\/div>/);
  expect(out).toContain('width:96px');
  expect(out).toContain('clip-path:polygon(');
});

test('a photo is the image; sizes are the sidebar, a collapsed hero and a profile hero', () => {
  expect(html({ name: 'a', avatarUrl: 'https://x/a.jpg' })).toMatch(/<img src="https:\/\/x\/a\.jpg"/);
  expect(html({ name: 'a', size: 'sm' })).toContain('width:32px');
  expect(html({ name: 'a', size: 'md' })).toContain('width:40px');
});

test('the sidebar and the profile page use it; no translucent-white initial is left', () => {
  const root = path.join(__dirname, '../../src/renderer');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'components/friend-history-page.js'), 'utf8');
  expect(app).toContain("React.createElement(FriendAvatar, { name: friend.displayName, avatarUrl: friend.avatarUrl, size: 'sm' })");
  expect((page.match(/React\.createElement\(FriendAvatar, \{ name: currentFriend\.displayName/g) || []).length).toBe(2);
  expect(page).not.toMatch(/bg-white\/20 text-white'\s*\}, currentFriend\.displayName\.charAt\(0\)/);
});
