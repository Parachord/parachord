// Critical Darlings comes from Achordion's feed alone (#964). The RSSground
// top-up was a cutover crutch while Achordion's store backfilled; the feed now
// carries 25+ picks on its own, so nothing in the app may ask RSSground again.

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const start = app.indexOf('const loadCriticsPicks = async (forceRefresh = false) => {');
const load = app.slice(start, app.indexOf('\n  };', start));

test('nothing in the app asks RSSground', () => {
  expect(app).not.toMatch(/rssground/i);
  expect(app).not.toMatch(/fetchLegacyCriticsPicks/);
});

test('the feed is Achordion, topped up only from the local cache', () => {
  expect(start).toBeGreaterThan(-1);
  expect(load).toContain("fetch('https://achordion.xyz/api/critical-darlings/feed.xml'");
  expect(load).toContain('addFill(cachedAlbums);');
});

test('a failed feed falls back to the cache, and only then shows an error', () => {
  const catchBlock = load.slice(load.indexOf('} catch (error) {'));
  expect(catchBlock).toContain('const fallback = criticsPicksCache.current.albums || [];');
  expect(catchBlock).toContain("setCriticsPicksError('Failed to load Critic\\'s Picks. Please try again.')");
});
