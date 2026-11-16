/**
 * Settings › Dialogs: each prompt is a SettingRow with a Switch, like every
 * other setting, instead of a read-only Hidden / Showing badge.
 */
const fs = require('fs');
const path = require('path');
const app = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;

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
  // A list is a role="list" container, or a VirtualizedTrackList, which draws
  // one (Charts and History moved to it in #767).
  const lists_ = (app.match(/role: 'list',/g) || []).length + (app.match(/React\.createElement\(VirtualizedTrackList, \{/g) || []).length;
  expect(lists_).toBeGreaterThanOrEqual(11);
});
