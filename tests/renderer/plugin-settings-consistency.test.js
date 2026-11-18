// Every plug-in's settings are one layout, built from shared parts (CLAUDE.md
// invariant; docs/plans/2026-11-17-plugin-settings-audit.md, #1498). The
// plug-in settings dialog grew a hand-built section per service: its own
// account header, Connect button, accordion and on/off control. These counts
// are what's left of that. A count that rises fails (build it from the
// shared part instead); a count that falls fails until the number here is
// lowered, so they only go down. #1498's remaining steps bring them to 0.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/plugin-settings-dialog.js'), 'utf8');
const count = (re) => (src.match(re) || []).length;

const LEFT = {
  // Sections keyed by one plug-in's id (Spotify's extras, Local Files' folders,
  // Ollama, Libre.fm, the scrobblers…): steps 4–5 make them manifest-driven.
  serviceBranches: 12,
  // Raw <button>s: the dialog's close button and Ollama's download link.
  rawButtons: 2,
  // Connect/Disconnect buttons: every account is an AccountRow now (#1498 step 3b).
  connectButtons: 0,
  // Hand-built accordions: every one is a Disclosure now.
  handBuiltAccordions: 0,
};

const now = {
  serviceBranches: count(/selectedResolver\.id === '[a-z]+'/g),
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
  expect(count(/React\.createElement\(AccountRow, \{/g)).toBeGreaterThanOrEqual(4);
});

test('one on/off control: the plug-in switch', () => {
  expect(count(/pluginSwitchState\(/g)).toBe(1);
  expect(src).not.toMatch(/showEnable|'Enable Ollama'/);
  // "Enable X" is the one switch's label (#1505); a second one would be a copy.
  expect((src.match(/`Enable \$\{selectedResolver\.name\}`/g) || []).length).toBe(1);
});
