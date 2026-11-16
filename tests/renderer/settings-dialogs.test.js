/**
 * Settings › Dialogs: each prompt is a SettingRow with a Switch, like every
 * other setting, instead of a read-only Hidden / Showing badge.
 */
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

test('the three prompts are switches that write their store keys', () => {
  expect(app).toContain("checked: !skipped,");
  for (const key of ['skip_external_prompt', 'skip_unsaved_friend_warning', 'skip_unplayable_prompt']) {
    expect(app).toMatch(new RegExp(`promptRow\\('[^']+', '[^']+', skip\\w+, setSkip\\w+, '${key}'\\)`));
  }
});

test('no Hidden / Showing badges, and the Home checklist has its own Reset', () => {
  expect(app).not.toMatch(/\? 'Hidden' : 'Showing'/);
  expect(app).not.toContain('statusBadgeStyle');
  expect(app).toContain("showToast('Home setup checklist reset');");
});

test('the tracks lists are lists (#1386)', () => {
  const lists = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/track-lists.js'), 'utf8');
  expect(lists).toContain("role: 'listitem',\n        ref: virtualizer.measureElement,");
  // Fresh Drops' grid is in its own module now (#1451).
  const fresh = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/fresh-drops-page.js'), 'utf8');
  expect(((app + fresh).match(/role: 'list',/g) || []).length).toBeGreaterThanOrEqual(11);
});
