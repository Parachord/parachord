// Every plug-in's settings are one layout, built from shared parts (CLAUDE.md
// invariant; docs/plans/2026-11-17-plugin-settings-audit.md, #1498). The
// plug-in settings dialog grew a hand-built section per service: its own
// account header, Connect button, accordion and on/off control. These counts
// are what's left of that. A count that rises fails (build it from the
// shared part instead); a count that falls fails until the number here is
// lowered, so they only go down. #1498 step 5 brought them to 0: the extra
// sections are components/plugin-extras.js, chosen by capability or manifest
// field, so the dialog and its extras are counted together.
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer/components', f), 'utf8');
const dialog = read('plugin-settings-dialog.js');
const extras = read('plugin-extras.js');
const src = `${dialog}\n${extras}`;
const count = (re) => (src.match(re) || []).length;

const LEFT = {
  // Sections keyed by one plug-in's id: every one is chosen by a capability
  // or a manifest field now (#1498 step 5).
  serviceBranches: 0,
  // Raw <button>s: the close button and Ollama's download link are Buttons now.
  rawButtons: 0,
  // Connect/Disconnect buttons: every account is an AccountRow now (#1498 step 3b).
  connectButtons: 0,
  // Hand-built accordions: every one is a Disclosure now.
  handBuiltAccordions: 0,
};

const now = {
  serviceBranches: count(/(?:selectedResolver|plugin)\.id [!=]== '[a-z]+'/g),
  rawButtons: count(/createElement\('button'/g),
  connectButtons: count(/'(?:Connect|Disconnect)'\)/g),
  handBuiltAccordions: count(/AdvancedOpen \? 'rotate-90'/g),
};

test.each(Object.keys(LEFT))('%s only goes down', (k) => {
  if (now[k] > LEFT[k]) throw new Error(`${k} rose from ${LEFT[k]} to ${now[k]}: build it from the shared part (AccountRow, Disclosure, SettingRow, pluginSwitchState) so every plug-in gets it.`);
  if (now[k] < LEFT[k]) throw new Error(`${k} fell from ${LEFT[k]} to ${now[k]}: lower it in this test.`);
});

test('signing in and out is only ever AccountRow', () => {
  // A sign-in or sign-out button drawn by hand, outside AccountRow.
  expect(src).not.toMatch(/\}, '(?:Sign in|Sign out)'\)/);
  // The status-capable plug-in's row in the dialog; the app's own sign-ins
  // and username accounts in the shared extras.
  expect(count(/React\.createElement\(AccountRow, \{/g) + count(/\be\(AccountRow, \{/g)).toBeGreaterThanOrEqual(3);
});

test('one on/off control: the plug-in switch', () => {
  expect((dialog.match(/pluginSwitchState\(/g) || []).length).toBe(1);
  expect(src).not.toMatch(/showEnable|'Enable Ollama'/);
  // "Enable X" is the one switch's label (#1505); a second one would be a copy.
  expect((src.match(/`Enable \$\{selectedResolver\.name\}`/g) || []).length).toBe(1);
});
