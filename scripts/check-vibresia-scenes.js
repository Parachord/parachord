#!/usr/bin/env node
// Check that every scene Parachord ships compiles.
//
// The visualiser draws Vibresia's scenes, and a scene that will not compile
// shows a black rectangle with nothing saying why. The compiler in the app
// explains errors in words, which is what the panel shows; here the same
// check runs over every scene in lib/vibresia-scenes.js, so a scene that
// stops compiling is caught here rather than by a user.
//
// It needs a GLSL compiler. Vibresia's own app is one: it compiles a
// vibescape and draws it, and reports the driver's error. So this points the
// scene at the app's MCP preview tool when the app is built, and skips with
// a clear message when it is not.
//
//   node scripts/check-vibresia-scenes.js [--app <path-to-vibresia-repo>]
//
// Exits non-zero when a scene fails to compile.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { SCENES } = require(path.join(ROOT, 'src/renderer/lib/vibresia-scenes.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

// The Vibresia repository, which holds the app that compiles the scenes.
// Overridable so the check can run against a checkout somewhere else.
const vibresiaRoot = arg('--app', '/Users/sydlawrence/minithlabs/visualiser');
const previewTool = path.join(vibresiaRoot, 'scripts/vibresia-preview.mjs');
const appBinary = path.join(vibresiaRoot, 'VisualiserMac/build/Vibresia.app/Contents/MacOS/Vibresia');

if (!fs.existsSync(previewTool) || !fs.existsSync(appBinary)) {
  console.log(`[scenes] no Vibresia build at ${vibresiaRoot} — skipping the compile check.`);
  console.log('[scenes] (build the Vibresia app to run it: the app is the GLSL compiler.)');
  process.exit(0);
}

// The tool compiles a vibescape written as `vec3 render(vec2 p, float t)`.
// A scene in Parachord is a full shader with its own main(), so it is
// wrapped the way the app wraps a custom vibescape: the same prelude and
// the same wrapper, with the scene's main() replaced by a render() that
// calls it. That is what the app does for a vibescape authored in the
// render() form, so compiling it here exercises the same GLSL.
const PRELUDE = fs.readFileSync(path.join(ROOT, 'src/renderer/lib/vibresia-visualizer.js'), 'utf8');
const preludeBody = PRELUDE.slice(
  PRELUDE.indexOf('const PRELUDE = `') + 'const PRELUDE = `'.length,
  PRELUDE.indexOf('`;\n\nconst WRAPPER')
);
// The app states the GLSL version itself, so the prelude's #version line has
// to come off before the scene is handed over.
const withoutVersion = preludeBody.replace(/^#version[^\n]*\n/, '');

const WRAPPER = `
void main() {
    vec2 p = screenP();
    vec3 c = render(p, uTime);
    fragColor = vec4(clamp(c, vec3(0.0), vec3(1.0)), 1.0);
}
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parachord-scenes-'));
let failed = 0;

for (const scene of SCENES) {
  // The scene's own main() writes fragColor. The wrapper needs a render()
  // instead, so the scene's main() is renamed and called from render().
  const renamed = scene.body.replace(/\bvoid\s+main\s*\(\s*\)/, 'void sceneMain()');
  if (renamed === scene.body) {
    console.error(`[scenes] ${scene.id}: the scene has no main() — the extractor is out of step with the source.`);
    failed++;
    continue;
  }
  const source = `${withoutVersion}\n${renamed}\nvec3 render(vec2 p, float t) {\n    sceneMain();\n    return vec3(0.0);\n}\n${WRAPPER}`;
  const file = path.join(tmp, `${scene.id}.glsl`);
  fs.writeFileSync(file, source, 'utf8');

  const result = spawnSync(process.execPath, [previewTool, file, '--w', '64', '--h', '36'], {
    encoding: 'utf8',
    timeout: 60000
  });

  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0 || /error|failed/i.test(out)) {
    console.error(`[scenes] ${scene.id}: did not compile.`);
    console.error(out.split('\n').slice(0, 12).map((l) => '    ' + l).join('\n'));
    failed++;
  } else {
    console.log(`[scenes] ${scene.id}: compiles.`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failed) {
  console.error(`[scenes] ${failed} of ${SCENES.length} scenes did not compile.`);
  process.exit(1);
}
console.log(`[scenes] all ${SCENES.length} scenes compile.`);
