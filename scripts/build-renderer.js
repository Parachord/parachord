// scripts/build-renderer.js — bundle the renderer entry into app.js.
//
// app.js is a GENERATED artifact (gitignored): the source of truth is
// src/renderer/app.js. esbuild bundles it as a classic IIFE script with no
// code transforms (target esnext, no minify) — vendor React and the loader
// globals stay as classic <script> tags loaded before the bundle in
// index.html. Output: app.js + app.js.map (sourcemapped stack traces).
//
// Run automatically by pretest / prestart / predev / prebuild. Dev watch:
//   node scripts/build-renderer.js --watch

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

// esbuild resolves the gitignored fallback-resolvers module lazily; on a
// fresh clone or after a manual clean, nothing has generated it yet, and
// the failure surfaces as esbuild's "Could not resolve ./lib/fallback-
// resolvers.generated.js". Name the fix instead of the symptom here (the
// reviewer-nit case: bare `npm run build:renderer` / `dev:renderer`).
const GENERATED_FALLBACK = path.join(__dirname, '..', 'src', 'renderer', 'lib', 'fallback-resolvers.generated.js');
if (!fs.existsSync(GENERATED_FALLBACK)) {
  console.error('[renderer] ' + path.relative(path.join(__dirname, '..'), GENERATED_FALLBACK) + ' is missing — run: node scripts/build-axes.js');
  process.exit(1);
}

const opts = {
  entryPoints: [path.join(__dirname, '..', 'src', 'renderer', 'app.js')],
  bundle: true,
  format: 'iife',
  target: 'esnext',
  outfile: path.join(__dirname, '..', 'app.js'),
  sourcemap: true,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = esbuild.context(opts);
  ctx.then((context) => context.watch()).then(() => {
    console.log('[renderer] watching src/renderer/app.js');
  });
} else {
  esbuild.build(opts).then(() => {
    console.log('[renderer] bundle written: app.js (+ app.js.map)');
  });
}
