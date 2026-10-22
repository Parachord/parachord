/**
 * Jest Configuration for Parachord
 */
module.exports = {
  testEnvironment: 'node',

  // music-metadata (and other ESM-only packages the main process loads
  // through Node's require(esm)) publish their entry under the `module-sync`
  // export condition and no `require` condition. Node's require(esm) adds
  // that condition; jest's resolver must too or the package is "not found".
  // Loading it then needs jest's own require(esm), which exists on Node
  // 24.9+ with vm modules enabled — the `test` scripts pass
  // --experimental-vm-modules for that reason.
  testEnvironmentOptions: { customExportConditions: ['node', 'node-addons', 'module-sync'] },

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],

  // Ignore legacy test files (they use custom framework)
  testPathIgnorePatterns: [
    '/node_modules/',
    // Git worktrees checked out under the repo (gitignored) carry their own
    // copy of tests/; a stale one ran 22 duplicate suites for months.
    // Anchored to <rootDir>: an unanchored '/.claude/' also matches every
    // path when jest runs INSIDE an agent worktree (which lives under
    // .claude/worktrees/), and the run then finds no tests at all.
    '<rootDir>/.worktrees/',
    // Same for agent worktrees the Claude Code app creates under .claude/
    // (they tripled the suite count while two agents had worktrees open).
    '<rootDir>/.claude/',
    // Legacy tests use custom framework, run with npm run test:legacy
    'tests/resolution-scheduler.test.js',
    'tests/youtube-resolver.test.js',
    'tests/browser-extension.test.js'
  ],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/test-utils/setup.js'],

  // Coverage configuration
  collectCoverageFrom: [
    '**/*.js',
    '!node_modules/**',
    '!dist/**',
    '!coverage/**',
    '!jest.config.js',
    '!tests/**',
    '!app.js', // Bundled file
    '!parachord-extension/**' // Extension has its own tests
  ],

  // Module paths
  moduleDirectories: ['node_modules', '<rootDir>'],

  // Timeout for async tests
  testTimeout: 10000,

  // Verbose output
  verbose: true
};
