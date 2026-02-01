/**
 * Jest Configuration for Parachord
 */
module.exports = {
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],

  // Ignore legacy test files (they use custom framework)
  testPathIgnorePatterns: [
    '/node_modules/',
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
