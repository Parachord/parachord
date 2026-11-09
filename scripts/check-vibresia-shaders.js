#!/usr/bin/env node
// Check that the shader Parachord assembles is the shader Vibresia assembles.
//
// The visualiser draws Vibresia's scenes, so the GLSL has to be the same
// shader, not a lookalike: the same prelude, the same scene body, the same
// palette grade. If the two drift, a scene that looks right in Vibresia
// looks wrong here, or not at all.
//
// This checks the two sides against each other, on the real files:
//
//   - Parachord's PRELUDE (src/renderer/lib/vibresia-visualizer.js) against
//     Vibresia's prelude (FunShaders.swift).
//   - Parachord's GRADE_FS against Vibresia's gradeFS (Shaders.swift).
//   - Parachord's LIQUID_VS against Vibresia's liquidVS.
//   - The scene bodies in src/renderer/lib/vibresia-scenes.js against
//     FunShaders.swift.
//
// Vibresia's own check-preview-glsl.py keeps its share page in step with
// the app; this keeps Parachord in step with both.
//
//   node scripts/check-vibresia-shaders.js [--app <path-to-vibresia-repo>]
//
// Exits non-zero when the two differ.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const vibresiaRoot = arg('--app', '/Users/sydlawrence/minithlabs/visualiser');
const funPath = path.join(vibresiaRoot, 'VisualiserMac/Sources/VisualiserMac/Render/FunShaders.swift');
const shaPath = path.join(vibresiaRoot, 'VisualiserMac/Sources/VisualiserMac/Render/Shaders.swift');

if (!fs.existsSync(funPath) || !fs.existsSync(shaPath)) {
  console.log(`[shaders] no Vibresia source at ${vibresiaRoot} — skipping the drift check.`);
  process.exit(0);
}

/** The body of a Swift `static let <name> = """..."""`, dedented. */
function swiftBlock(src, name) {
  const m = src.match(new RegExp(`static let ${name} = """\\n([\\s\\S]*?)\\n    """`));
  if (!m) throw new Error(`no \`static let ${name}\``);
  return m[1].split('\n').map((l) => (l.startsWith('    ') ? l.slice(4) : l)).join('\n');
}

/** The body of a JS template literal, with the escapes undone. */
function jsTemplate(src, name) {
  const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`no \`const ${name}\``);
  return m[1].replace(/\\\$\{/g, '${').replace(/\\`/g, '`').replace(/\\\\/g, '\\');
}

const funSrc = fs.readFileSync(funPath, 'utf8');
const shaSrc = fs.readFileSync(shaPath, 'utf8');
const vsSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/lib/vibresia-visualizer.js'), 'utf8');
const scenesSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/lib/vibresia-scenes.js'), 'utf8');

const problems = [];

function compare(label, expected, got) {
  if (expected === got) {
    console.log(`[shaders] ${label}: matches.`);
    return;
  }
  // Say which helper is missing or extra, because "the files differ" is
  // not something anybody can act on.
  const helpers = (s) => {
    const out = new Set();
    for (const m of s.matchAll(/\b(?:float|vec[234]|mat[234])\s+(\w+)\s*\(/g)) out.add(m[1]);
    return out;
  };
  const want = helpers(expected);
  const have = helpers(got);
  const missing = [...want].filter((h) => !have.has(h));
  const extra = [...have].filter((h) => !want.has(h));
  const detail = [];
  if (missing.length) detail.push(`Parachord is missing ${missing.join(', ')}`);
  if (extra.length) detail.push(`Parachord has extra ${extra.join(', ')}`);
  if (!detail.length) {
    const a = expected.split('\n');
    const b = got.split('\n');
    detail.push(`${b.length} lines vs ${a.length}`);
  }
  problems.push(`${label}: ${detail.join('; ')}`);
  console.error(`[shaders] ${label}: differs — ${detail.join('; ')}`);
}

compare('the prelude', swiftBlock(funSrc, 'prelude'), jsTemplate(vsSrc, 'PRELUDE'));
compare('the vertex shader', swiftBlock(shaSrc, 'liquidVS'), jsTemplate(vsSrc, 'LIQUID_VS'));
compare('the palette grade', swiftBlock(shaSrc, 'gradeFS'), jsTemplate(vsSrc, 'GRADE_FS'));

// The scene bodies: each one Parachord ships must match the same scene in
// Vibresia's source, byte for byte.
const { SCENES } = require(path.join(ROOT, 'src/renderer/lib/vibresia-scenes.js'));
for (const scene of SCENES) {
  let expected;
  try {
    expected = swiftBlock(funSrc, scene.id);
  } catch (e) {
    problems.push(`${scene.id}: ${e.message}`);
    console.error(`[shaders] ${scene.id}: ${e.message}`);
    continue;
  }
  compare(`the ${scene.id} scene`, expected, scene.body);
}

if (problems.length) {
  console.error(`[shaders] ${problems.length} block(s) differ from Vibresia.`);
  console.error('[shaders] A scene that looks right in Vibresia would look wrong here.');
  process.exit(1);
}
console.log(`[shaders] Parachord's shaders match Vibresia's (${SCENES.length + 3} blocks).`);
