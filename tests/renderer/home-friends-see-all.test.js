/**
 * Home's Friend Activity "See all". It called navigateTo('friends'), a view
 * that was only a placeholder line since the initial commit, so the link led
 * to a blank page; and the on-air count replaced the link, so with anyone on
 * air there was no way from Home to the rest of the list. The friends list is
 * the Collection's Friends tab.
 */
const fs = require('fs');
const path = require('path');

const home = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/home-page.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('Home Friend Activity "See all"', () => {
  test('opens the Collection Friends tab', () => {
    expect(home).toMatch(/onClick: \(\) => \{ navigateTo\('library'\); setCollectionTab\('friends'\); \},\s*className: 'text-sm text-purple-600[^']*'\s*\}, 'See all'\)/);
  });

  test('nothing navigates to the old placeholder view', () => {
    expect(home).not.toMatch(/navigateTo\('friends'\)/);
    expect(app).not.toMatch(/navigateTo\('friends'\)|setActiveView\('friends'\)/);
    expect(app).not.toMatch(/activeView === 'friends' && React\.createElement/);
  });

  test('shows next to the on-air count, not instead of it', () => {
    expect(home).not.toMatch(/listening now`\s*\)\s*:\s*React\.createElement\('button'/);
    expect(home).toMatch(/onlineFriends\.length > 0 && React\.createElement\('span'/);
  });

  test('a saved last view of the old placeholder restores to the Friends tab', () => {
    expect(app).toMatch(/savedLastView\.view === 'friends'\) \{[\s\S]{0,300}?setActiveView\('library'\);[\s\S]{0,80}?setCollectionTab\('friends'\);/);
  });
});
