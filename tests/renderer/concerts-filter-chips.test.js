/**
 * #1385 step 10 (what was left of #1360): Concerts' source filter is the
 * app's FilterChips, not its own dropdown.
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe("Concerts' source filter", () => {
  test('is FilterChips, labelled, on the page colour', () => {
    expect(app).toContain("pageColor: PAGE_COLORS.concerts.fill, label: 'Filter concerts by source',");
  });
  test('each source chip takes its plugin colour', () => {
    expect(app).toMatch(/const resolver = allResolvers\.find\(r => r\.id === resolverId\);\s*chips\.push\(\{[\s\S]{0,300}color: resolver\?\.color \|\| undefined,/);
  });
  test('the old dropdown and its state are gone', () => {
    expect(app).not.toContain('concertsSourceFilterDropdownOpen');
    expect(app).not.toContain("'All Sources'");
  });
});
