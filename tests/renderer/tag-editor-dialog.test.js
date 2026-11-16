// #1451: the tag editor is its own memo'd dialog
// (components/tag-editor-dialog.js), fed only stable values.
const fs = require('fs');
const path = require('path');
global.React = global.React || require('react');
const { TagEditorDialog } = require('../../src/renderer/components/tag-editor-dialog');

test('is React.memo', () => {
  expect(TagEditorDialog.$$typeof).toBe(Symbol.for('react.memo'));
});

test('app.js passes it only useState values, their setters and showToast', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const at = app.indexOf('id3EditorOpen && React.createElement(TagEditorDialog, {');
  expect(at).toBeGreaterThan(-1);
  const props = app.slice(at, app.indexOf('})', at)).split('{')[1].split(',').map((p) => p.trim()).filter(Boolean);
  expect(props.length).toBeGreaterThan(5);
  for (const p of props) {
    const isState = new RegExp(`const \\[(${p}, set\\w+|\\w+, ${p})\\] = useState\\(`).test(app);
    expect([p, isState || p === 'showToast']).toEqual([p, true]);
  }
});
