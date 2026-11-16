// src/renderer/lib/track-slug.js: the renderer's path to the Unicode-aware
// track slugs. The code lives in sync-engine/track-slug.js, which the main
// process can load too (the collection id migration, #1401); see the notes
// there.
module.exports = require('../../../sync-engine/track-slug');
