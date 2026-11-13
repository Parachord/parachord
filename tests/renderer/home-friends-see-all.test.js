/**
 * Home's Friend Activity "See all". It called navigateTo('friends'), a view
 * that was only a placeholder line since the initial commit, so the link led
 * to a blank page; and the on-air count replaced the link, so with anyone on
 * air there was no way from Home to the rest of the list. The friends list is
 * the Collection's Friends tab.
 *
 * The redesigned Home (2026-11) has no friends section (the sidebar shows
 * friends), so only the app-wide checks are left here.
 */
const fs = require('fs');
const path = require('path');

const home = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/home-page.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('Home Friend Activity "See all"', () => {
  test('nothing navigates to the old placeholder view', () => {
    expect(home).not.toMatch(/navigateTo\('friends'\)/);
    expect(app).not.toMatch(/navigateTo\('friends'\)|setActiveView\('friends'\)/);
    expect(app).not.toMatch(/activeView === 'friends' && React\.createElement/);
  });

  test('a saved last view of the old placeholder restores to the Friends tab', () => {
    expect(app).toMatch(/savedLastView\.view === 'friends'\) \{[\s\S]{0,300}?setActiveView\('library'\);[\s\S]{0,80}?setCollectionTab\('friends'\);/);
  });
});
