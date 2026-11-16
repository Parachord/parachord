/**
 * Concerts' filter bar has no manual Refresh: listings refresh themselves
 * (24-hour cache, stale-while-refreshing; a location change fetches again),
 * and a forced refresh emptied the page while it asked every plug-in about
 * every artist. The city field is the shared text field: one focus ring
 * (it drew its own teal ring on top of the global one).
 */
const fs = require('fs');
const path = require('path');
const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;

test('no Refresh button in the Concerts filter bar', () => {
  const bar = app.slice(app.indexOf("label: 'Filter concerts by source'"), app.indexOf("placeholder: 'City or region…'"));
  expect(bar).not.toContain('loadConcerts(true)');
  expect(bar).not.toContain('Icons.RefreshCw');
});

test('the city field is the shared field, with no focus style of its own', () => {
  const at = app.indexOf("placeholder: 'City or region…'");
  const field = app.slice(app.lastIndexOf('React.createElement(', at), at + 400);
  expect(field).toMatch(/^React\.createElement\(TextField, \{/);
  expect(field).not.toContain('onFocus');
  expect(field).not.toContain('boxShadow');
});
