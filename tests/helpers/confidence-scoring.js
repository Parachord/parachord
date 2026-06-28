// Test-side accessor for the resolver confidence scoring + threshold gate.
//
// This was a parallel byte-copy of the canonical functions; it is now a thin
// re-export of the production module `sync-providers/confidence-scoring.js` so
// the two can never drift. The cross-platform SYNC invariant (app.js inline
// copy + Android `ResolverModels.kt#scoreConfidence` /
// `ResolverScoring.kt#MIN_CONFIDENCE_THRESHOLD`) still applies — keep those
// byte-identical with the production module's function bodies.
module.exports = require('../../sync-providers/confidence-scoring');
