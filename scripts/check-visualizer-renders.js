// An end-to-end check that a Vibresia scene really draws in Parachord.
//
// The unit tests prove the wiring and the arithmetic; they cannot prove that
// a pixel comes out. This does: it launches Electron, opens a window with a
// WebGL2 canvas, compiles a scene with the same code the visualiser uses,
// draws a frame, and reads the pixels back.
//
// A scene that compiles but draws nothing — a black frame where the picture
// should be — passes every other check. This is the one that catches it.
//
// It is a separate script rather than a Jest test because it needs a GPU and
// a window: it is run by hand, and by the release script on a machine with a
// display.
//
//   node scripts/check-visualizer-renders.js
//
// Exits non-zero when a scene does not draw.

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// The page Electron loads. It is the visualiser's own engine, driven from a
// plain HTML file, so what is measured is the real code path.
//
// The two modules are CommonJS, so they are given a `module`/`exports` to
// write to — the same code, the same way, only the packaging differs.
const browserModule = (source, name) => `
var module = { exports: {} };
var exports = module.exports;
${source}
window.__viz = Object.assign(window.__viz || {}, module.exports);
`;

const PAGE = `<!DOCTYPE html>
<html><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas>
<script>
${browserModule(fs.readFileSync(path.join(ROOT, 'src/renderer/lib/vibresia-visualizer.js'), 'utf8'), 'visualizer')}
${browserModule(fs.readFileSync(path.join(ROOT, 'src/renderer/lib/vibresia-scenes.js'), 'utf8'), 'scenes')}
</script>
<script>
(function () {
  var VibresiaRenderer = window.__viz.VibresiaRenderer;
  var SCENES = window.__viz.SCENES;
  var results = [];
  var canvas = document.getElementById('c');
  var renderer = new VibresiaRenderer(canvas);
  for (var i = 0; i < SCENES.length; i++) {
    var scene = SCENES[i];
    var setup = renderer.setup(scene);
    if (!setup.ok) { results.push({ id: scene.id, ok: false, error: setup.error }); continue; }
    // Draw with the music on: a scene that only draws in silence would be a
    // scene that never draws.
    var a = {
      time: 12.0, beats: 24.0, scroll: 8.4, clock: 12.0,
      bass: 0.7, mid: 0.5, treble: 0.4, level: 0.6, levelSmooth: 0.55,
      bassSmooth: 0.65, beat: 1, beatStrength: 0.6, idle: 0, active: 1,
      presence: 0.9, bands: [], trackPos: 0, trackDuration: 0,
      trackProgress: 0, trackKnown: 0, mouseX: 0, mouseY: 0, mouseDown: 0,
      mouseHere: 0
    };
    for (var b = 0; b < 96; b++) a.bands.push(0.2 + 0.6 * Math.abs(Math.sin(b * 0.31)));
    renderer.draw(a);
    // Read the pixels back. The framebuffer is the default one, because the
    // grade pass ends on the default framebuffer.
    var gl = renderer.gl;
    var px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var lit = 0, sum = 0, max = 0;
    for (var p = 0; p < px.length; p += 4) {
      var v = Math.max(px[p], Math.max(px[p + 1], px[p + 2]));
      sum += v; if (v > 8) lit++; if (v > max) max = v;
    }
    var total = px.length / 4;
    results.push({
      id: scene.id,
      ok: lit > total * 0.02 && max > 40,
      litRatio: lit / total,
      max: max,
      mean: sum / total
    });
  }
  window.__results = results;
  window.__done = true;
  console.log('VISUALIZER_RESULTS ' + JSON.stringify(results));
})();
</script>
</body></html>`;

const pageFile = path.join(ROOT, 'node_modules/.visualizer-check.html');
fs.writeFileSync(pageFile, PAGE, 'utf8');

// A tiny main process: one window, then wait for the page to say it is done.
const mainFile = path.join(ROOT, 'node_modules/.visualizer-check-main.js');
fs.writeFileSync(mainFile, `
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration = false;
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400, height: 260, show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false }
  });
  win.webContents.on('console-message', (_e, _lvl, msg) => {
    if (msg) console.log('[page]', msg);
  });
  await win.loadFile(${JSON.stringify(pageFile)});
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const done = await win.webContents.executeJavaScript('window.__done === true');
    if (done) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const results = await win.webContents.executeJavaScript('window.__results || []');
  app.exit(results.length ? 0 : 1);
});
`, 'utf8');

const electron = require('electron');
const run = spawnSync(electron, [mainFile], {
  encoding: 'utf8',
  timeout: 180000,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
});

const out = `${run.stdout || ''}${run.stderr || ''}`;

// The page prints its results as JSON on one line, so they can be read back.
// Electron prefixes the page's console output, so the marker is looked for
// anywhere in the line rather than at the start of it.
const line = out.split('\n').find((l) => l.includes('VISUALIZER_RESULTS '));
if (!line) {
  console.error('[render] the page did not report any results.');
  console.error(out.split('\n').slice(0, 30).map((l) => '    ' + l).join('\n'));
  fs.unlinkSync(pageFile);
  fs.unlinkSync(mainFile);
  process.exit(1);
}

const json = line.slice(line.indexOf('VISUALIZER_RESULTS ') + 'VISUALIZER_RESULTS '.length).trim();
const results = JSON.parse(json);
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`[render] ${r.id}: drew (${(r.litRatio * 100).toFixed(1)}% of pixels lit, peak ${r.max}).`);
  } else {
    console.error(`[render] ${r.id}: drew nothing (${(r.litRatio * 100).toFixed(1)}% lit, peak ${r.max})${r.error ? ': ' + r.error : ''}`);
    failed++;
  }
}

fs.unlinkSync(pageFile);
fs.unlinkSync(mainFile);

if (failed) {
  console.error(`[render] ${failed} of ${results.length} scenes drew nothing.`);
  process.exit(1);
}
console.log(`[render] all ${results.length} scenes drew.`);
