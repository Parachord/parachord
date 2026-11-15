/**
 * #1387 "Silent failures": a failed marketplace load and a failed folder
 * add used to show nothing.
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const body = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

test('a failed marketplace load shows an error with Try again on Plug-Ins', () => {
  const load = body('const loadMarketplaceManifest = async', 'const handleInstallFromMarketplace');
  expect(load).toMatch(/setMarketplaceError\(!result\.success\)/);
  expect(load).toMatch(/catch \(error\) \{[\s\S]*setMarketplaceError\(true\)/);
  expect(app).toMatch(/marketplaceError && React\.createElement\('div'[\s\S]{0,120}ErrorState, \{\s*title: 'Couldn’t load the plug-in marketplace',[\s\S]{0,200}onRetry: \(\) => loadMarketplaceManifest\(\)/);
});

test('adding or rescanning a music folder says when it fails; a cancelled picker says nothing', () => {
  const add = body('const handleAddWatchFolder = async', 'const handleRemoveWatchFolder');
  expect(add).toMatch(/\} else if \(result\) \{[\s\S]*showToast\('Couldn’t add that folder\./);
  expect(add).toMatch(/catch \(error\) \{[\s\S]*showToast\('Couldn’t add that folder\./);
  const rescan = body('const handleRescanFolder = async', '// "Remove Missing Files"');
  expect(rescan).toMatch(/rescan\.success === false[\s\S]*showToast\('Couldn’t rescan that folder\./);
});
