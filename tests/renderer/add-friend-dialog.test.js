// The Add a friend dialog (components/add-friend-dialog.js): the service
// first, then the username; a profile link fills both; errors under the field.
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
global.React = React;
const { AddFriendDialog, parseFriendLink } = require('../../src/renderer/components/add-friend-dialog');

test('a profile link gives its service and username; anything else is not a link', () => {
  expect(parseFriendLink('https://www.last.fm/user/RJ')).toEqual({ service: 'lastfm', username: 'RJ' });
  expect(parseFriendLink('https://listenbrainz.org/user/mayhem/?page=2')).toEqual({ service: 'listenbrainz', username: 'mayhem' });
  expect(parseFriendLink('last.fm/user/a%20b')).toEqual({ service: 'lastfm', username: 'a b' });
  expect(parseFriendLink('rj')).toBeNull();
  expect(parseFriendLink('https://example.com/user/rj')).toBeNull();
});

test('it asks for the service (two tiles with logos), then a labelled username field', () => {
  const html = renderToStaticMarkup(React.createElement(AddFriendDialog, { onClose() {}, onAdd: async () => {} }));
  expect(html).toContain('Add a friend');
  expect(html).toMatch(/role="radiogroup" aria-label="Service"/);
  expect((html.match(/role="radio"/g) || []).length).toBe(2);
  expect(html).toMatch(/aria-checked="true"[^>]*>.*Last\.fm/);
  expect((html.match(/<svg/g) || []).length).toBeGreaterThanOrEqual(2);
  expect(html).toMatch(/<label for="[^"]+-username"[^>]*>Username<\/label>/);
  expect(html).toContain('placeholder="Their Last.fm username"');
  expect(html).toContain('Or paste their profile link.');
  // No bullet list of example URLs any more.
  expect(html).not.toContain('Examples:');
});

test('defaultService picks the tile', () => {
  const html = renderToStaticMarkup(React.createElement(AddFriendDialog, { onClose() {}, onAdd: async () => {}, defaultService: 'listenbrainz' }));
  expect(html).toContain('placeholder="Their ListenBrainz username"');
});

test('app.js opens it and adds through addFriendCore with the chosen service', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toMatch(/addFriendModalOpen && React\.createElement\(AddFriendDialog, \{\s*onClose: \(\) => setAddFriendModalOpen\(false\),\s*onAdd: \(service, username\) => addFriendCore\(\{ service, username \}\)/);
  expect(app).not.toContain('addFriendInput');
});
