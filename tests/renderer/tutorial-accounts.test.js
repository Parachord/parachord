/**
 * #1387: the welcome tour's accounts step. The welcome screen promises
 * Last.fm and ListenBrainz; this step connects them, optionally.
 */
const { appWithPages } = require('../helpers/renderer-source');

// The tour itself is components/first-run-tutorial.js; its state is in app.js.
const app = appWithPages();
const step = app.slice(app.indexOf("firstRunTutorial.step === 'accounts' && (() => {"), app.indexOf("firstRunTutorial.step === 'complete' && (() => {"));

test('sources → accounts → complete, and Back goes the same way', () => {
  expect(step.length).toBeGreaterThan(100);
  expect(app).toMatch(/\.\.\.prev, step: 'accounts',\s*lastfmUsername: prev\.lastfmUsername \|\| metaServiceConfigs\.lastfm\?\.username/);
  expect(step).toMatch(/step: 'sources'/);
  expect(app).toMatch(/onClick: \(\) => setFirstRunTutorial\(prev => \(\{ \.\.\.prev, step: 'accounts' \}\)\) \}, 'Back'\)/);
});

test('Continue connects each changed name the way the panels do, keeping saved keys, and stays on a failure', () => {
  expect(step).toMatch(/connectLastfm\(lf, lastfm\.apiKey, lastfm\.apiSecret\)/);
  expect(step).toMatch(/connectListenbrainz\(lbn, lb\.userToken\)/);
  expect(step).toMatch(/step: ok \? 'complete' : prev\.step/);
});

test('Skip moves on without saving; the fields are labelled and described', () => {
  expect(step).toMatch(/'Skip'\)/);
  expect(step).toMatch(/htmlFor: id/);
  expect(step).toMatch(/'aria-describedby': `\$\{id\}-hint`/);
});

test('the unused social/features steps and their state are gone', () => {
  expect(app).not.toMatch(/selectedScrobblers|spotifyConnecting: false/);
  expect(app).toMatch(/step: 'welcome', \/\/ 'welcome' \| 'sources' \| 'accounts' \| 'complete'/);
});
