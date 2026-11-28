// The renderer's page markup for source-marker tests: src/renderer/app.js
// plus the pages, panels and helpers moved out of it into their own modules
// (#1451). A test that
// reads a page's markup from app.js reads this instead, so moving the page
// (verbatim) doesn't move it out of the test's sight. Each extraction PR adds
// its module here.
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');
const PAGE_MODULES = [
  'components/fresh-drops-page.js',
  'components/recommendations-page.js',
  'components/concerts-page.js',
  'components/charts-page.js',
  'components/critics-picks-page.js',
  'components/history-page.js',
  'components/friend-history-page.js',
  'components/tag-editor-dialog.js',
  'components/results-panel.js',
  'components/queue-drawer.js',
  'components/drop-zone-overlay.js',
  'components/add-to-playlist-panel.js',
  'components/sync-setup-dialog.js',
  'components/sync-status-dialog.js',
  'components/settings-page.js',
  'components/playbar.js',
  'components/sidebar.js',
  'components/plugin-settings-dialog.js',
  'components/first-run-tutorial.js',
  'components/external-track-prompt.js',
  'components/unsaved-friend-dialog.js',
  'components/new-playlist-dialog.js',
  'components/queue-save-dialog.js',
  'components/url-import-dialog.js',
  'components/plugin-sign-in-dialog.js',
  'components/sync-delete-dialog.js',
  'components/nway-migration-dialog.js',
  'components/sync-channel-disable-dialog.js',
  'components/stop-sync-dialog.js',
  'components/extension-info-dialog.js',
  'components/raycast-info-dialog.js',
  'components/playlists-page.js',
  'components/playlist-view-page.js',
  // State-domain hooks moved out of the Parachord component (#1487).
  'hooks/use-local-files.js',
  'hooks/use-loves.js',
  // Module-level code moved out of app.js with them.
  'lib/resolver-order.js',
  'lib/ai-services.js',
  'lib/playlist-mirrors.js',
];

function read(rel) {
  return fs.readFileSync(path.join(RENDERER, rel), 'utf8');
}

// app.js, then each moved page, one after another.
function appWithPages() {
  return [read('app.js'), ...PAGE_MODULES.map(read)].join('\n');
}

module.exports = { appWithPages, PAGE_MODULES, readRenderer: read };
