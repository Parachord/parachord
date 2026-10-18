// ESLint flat config — maintainability plan Track 4.
//
// Adoption is per-directory (the plan's rule: no 67k-line reformat diff):
//  - STRICT on the extracted/new modules: main-process/, plugins-src/,
//    the root dual-load modules, and the build scripts. These are small,
//    reviewed surfaces — they get no-unused-vars, no-undef and the
//    correctness rules.
//  - PARSE-ONLY on everything else (src/renderer/app.js, main.js, tests,
//    the service trees): every recommended rule off, so lint is green from
//    day one while the decomposition shrinks the legacy files. As a legacy
//    file is extracted into a module it inherits the strict group — that is
//    the migration path.
//  - NO stylistic rules anywhere — formatting is prettier's domain where it
//    runs (plugins-src via build-axes --import); eslint does correctness only,
//    so a lint run can never churn a reformat diff through a 67k-line file.

const js = require('@eslint/js');

const strictRules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'warn',
  'no-constant-condition': 'warn',
  'no-fallthrough': 'error',
  'no-async-promise-executor': 'error',
  'no-self-compare': 'warn',
  'no-shadow-restricted-names': 'error',
  eqeqeq: ['warn', 'smart'],
  'prefer-const': ['warn', { destructuring: 'all' }],
  'no-var': 'warn',
};

const sharedGlobals = {
  window: 'writable',
  console: 'readonly',
  module: 'readonly',
  require: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  __dirname: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  AbortController: 'readonly',
  DOMException: 'readonly',
  FileReader: 'readonly',
  crypto: 'readonly',
  performance: 'readonly',
  structuredClone: 'readonly',
  queueMicrotask: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  addEventListener: 'readonly',
  removeEventListener: 'readonly',
  dispatchEvent: 'readonly',
  CustomEvent: 'readonly',
  MutationObserver: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  indexedDB: 'readonly',
  Worker: 'readonly',
  SharedWorker: 'readonly',
  MessageChannel: 'readonly',
  EventSource: 'readonly',
  MediaSource: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  WebSocket: 'readonly',
  XMLHttpRequest: 'readonly',
  Image: 'readonly',
  Audio: 'readonly',
  DOMParser: 'readonly',
  HTMLElement: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  React: 'readonly',
  ReactDOM: 'readonly',
  lucideReact: 'readonly',
  ReactVirtual: 'readonly',
};

const off = Object.fromEntries(Object.keys(js.configs.recommended.rules).map((r) => [r, 'off']));

const STRICT_FILES = [
  'main-process/**/*.js',
  'plugins-src/**/*.js',
  'src/renderer/components/**/*.js',
  'protocol-url.js',
  'stream-quality.js',
  'mbid-lookup.js',
  'recommendation-blocklist.js',
  'album-art-catalog.js',
  'resolver-loader.js',
  'scrobbler-loader.js',
  'resolution-scheduler.js',
  'resolver-limiter.js',
  'migration-plan.js',
  'scripts/build-axes.js',
  'scripts/build-renderer.js',
];

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'app.js', 'app.js.map', 'vendor/**', 'plugins/**', 'smart-links/**', 'parachord-extension/**', 'raycast-extension/**'] },

  // Parse-level errors everywhere first (syntax only).
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: sharedGlobals },
    rules: {},
  },

  // Strict on the extracted + new surfaces.
  {
    files: STRICT_FILES,
    rules: strictRules,
  },

  // plugins-src override (after the strict group so it wins): the
  // implementation files are verbatim machine-imported legacy plugin code
  // (prettier-formatted only) — var redeclaration is legal and idiomatic
  // there, so no-redeclare stays off for that tree.
  {
    files: ['plugins-src/**/implementation.js'],
    rules: { 'no-redeclare': 'off' },
  },

  // Everything else (the big legacy files, tests, service trees): recommended
  // preset fully off — parse-only until each file is extracted into a module.
  {
    files: ['**/*.js'],
    ignores: [...STRICT_FILES, "eslint.config.js"],
    rules: off,
  },
];
