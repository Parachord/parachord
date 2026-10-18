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

const path = require('path');
const esbuild = require('esbuild');

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
