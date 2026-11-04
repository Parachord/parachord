// The code lives in sync-providers/, which ships in the packaged app: the main
// process loads it through tools/dj-tools.js, and package.json excludes src/.
module.exports = require('../../../sync-providers/track-variants');
