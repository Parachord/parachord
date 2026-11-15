/**
 * #1386: the keyboard shortcuts dialog. Every listed shortcut must exist
 * in its source, so the list can't outlive a removed shortcut.
 */
global.React = require('react');
global.ReactDOM = require('react-dom');
const fs = require('fs');
const path = require('path');
const { SHORTCUT_GROUPS, keyLabel } = require('../../src/renderer/components/keyboard-shortcuts');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const main = read('main.js');
const app = read('src/renderer/app.js');
const card = read('src/renderer/components/card-button.js');
const menu = read('src/renderer/components/menu.js');

const all = SHORTCUT_GROUPS.flatMap((g) => g.items);
const has = (label) => all.find((i) => i.label === label);

test('menu accelerators listed are the ones main.js sets', () => {
  const accel = {
    'Previous track': 'CmdOrCtrl+Left', 'Next track': 'CmdOrCtrl+Right', 'Shuffle on or off': 'CmdOrCtrl+S',
    Search: 'CmdOrCtrl+F', Settings: 'CmdOrCtrl+,', 'New playlist': 'CmdOrCtrl+N',
  };
  for (const [label, a] of Object.entries(accel)) {
    expect(has(label)).toBeTruthy();
    expect(main).toContain(`accelerator: '${a}'`);
  }
  expect(main).toMatch(/label: 'Keyboard Shortcuts',\s*accelerator: 'CmdOrCtrl\+\/',\s*click: \(\) => safeSendToRenderer\('menu-action', 'show-shortcuts'\)/);
  expect(main).toContain("'Cmd+Shift+L' : 'Ctrl+Shift+L'");
});

test('renderer shortcuts listed exist', () => {
  expect(has('Play or pause')).toBeTruthy();
  expect(app).toMatch(/e\.key === ' ' \|\| e\.code === 'Space'/);
  expect(app).toMatch(/e\.key === '\?'[\s\S]{0,200}setShortcutsOpen\(true\)/);
  expect(app).toMatch(/case 'show-shortcuts':\s*setShortcutsOpen\(true\);/);
  expect(card).toMatch(/F10/);
  expect(menu).toMatch(/ArrowDown/);
});

test('Mod reads ⌘ on a Mac and Ctrl elsewhere', () => {
  expect(keyLabel('Mod', true)).toBe('⌘');
  expect(keyLabel('Mod', false)).toBe('Ctrl');
  expect(keyLabel('Shift', true)).toBe('⇧');
});

test('the dialog is mounted once at the app root', () => {
  expect(app.match(/React\.createElement\(KeyboardShortcutsDialog, \{ open: shortcutsOpen/g)).toHaveLength(1);
});
