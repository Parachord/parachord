const fs = require('fs');
const path = require('path');
const { statusBadgeStyle } = require('../../src/renderer/lib/status-badge');

test('on and off badges read theme tokens only', () => {
  for (const on of [true, false]) {
    const s = statusBadgeStyle(on);
    for (const v of Object.values(s)) expect(v).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  }
  expect(statusBadgeStyle(true).color).toBe('var(--text-success)');
  expect(statusBadgeStyle(false).color).toBe('var(--text-secondary)');
});

test('Settings > Dialogs badges use it, not pastel palette fills', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(src.match(/style: statusBadgeStyle\(!skip(ExternalPrompt|UnsavedFriendWarning)\)/g)).toHaveLength(2);
  expect(src).not.toMatch(/bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700/);
});
