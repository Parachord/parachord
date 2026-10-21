/**
 * parachord#1009: the Library Sync modal (with the only explicit "Sync Now"
 * button) existed since 2026-01 but nothing ever opened it. Pin that the
 * Collection Sync dropdown opens it and that Sync Now bypasses the stagger.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
// The Collection page header (where the opener lives) moved into its own
// module in the Track 2b split.
const collectionPage = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'collection-page.js'), 'utf8');

describe('Sync Now is reachable', () => {
  test('something opens syncStatusModal', () => {
    expect(collectionPage).toMatch(/setSyncStatusModal\(\{ open: true \}\)/);
    expect(collectionPage).toMatch(/'Sync status & Sync Now'/);
  });

  test('the modal\'s Sync Now runs a full (unstaggered) sync', () => {
    const start = app.indexOf("syncStatusModal.open && React.createElement('div', {");
    expect(start).toBeGreaterThan(-1);
    const src = app.slice(start, start + 12000);
    expect(src).toMatch(/window\.electron\.sync\.start\(providerId, \{ settings, fullSync: true \}\)/);
    expect(src).toMatch(/navigateTo\('settings'\);\s*\n\s*setSettingsTab\('plugins'\);/);
  });
});
