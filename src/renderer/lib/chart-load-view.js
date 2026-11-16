// src/renderer/lib/chart-load-view.js: which of a chart's three states the
// page shows: its loading skeleton, its error, or its list.
//
// A failed load used to settle `loading` to false while `loaded` stayed
// false, and the skeleton's test was `loading || !loaded`, so a failed Apple
// Music tracks chart (a 504 from Apple, 2026-11-16) shimmered forever. An
// error wins over a not-yet-loaded chart; the skeleton is for a load in
// flight or one about to start. Plain module; loads under plain Node.

function chartLoadView({ loading = false, loaded = false, error = null } = {}) {
  if (loading) return 'skeleton';
  if (error) return 'error';
  if (loaded) return 'list';
  return 'skeleton';
}

module.exports = { chartLoadView };
