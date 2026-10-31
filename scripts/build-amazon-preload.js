#!/usr/bin/env node
// scripts/build-amazon-preload.js — codegen for the sandboxed trap/capture/
// hijack function copies inside amazon-player-preload.js (parachord#1099
// bucket D).
//
// Why this exists: amazon-player-preload.js runs sandboxed in Amazon's WebView
// — a sandboxed preload can only require 'electron'/'events'/'timers'/'url',
// never local files — so the four page-world functions
// (installMediaSessionHijack from embedded-player-kit.js)
// must be INLINED as literal copies. They used to be maintained by hand with
// a behavioral parity test policing drift. This generator makes the copies
// mechanically: it .toString()s the source functions and rewrites the
// GENERATED-BEGIN/END blocks in the preload, so editing the source is the
// whole change. The behavioral parity test (tests/resolver/amazon-player-
// preload.test.js) stays as the semantic safety net, plus the no-local-
// require guard, both of which generation doesn't affect.
//
// Function.prototype.toString output is V8-version-noisy at the surface
// level, so the emitted text is canonicalized through the SAME prettier
// options the plugin generator uses — a local Node-26 regen and CI's Node-24
// regen must produce identical bytes, or the drift gate below would churn.
//
// Modes:
//   (default)  write the four generated sections in place
//   --check    verify only — byte-compare against the sources, exit 1 with a
//              report naming the drifted sections
//
// The file STAYS TRACKED (it also carries handwritten preload code around
// the generated sections): the pretest/prestart/predev/prebuild* hooks all
// run this script, and the committed-state drift gate in
// .github/workflows/test.yml verifies the committed file is a writer no-op
// (github.com/Parachord/parachord pattern from the marketplace-manifest gate).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRELOAD_PATH = path.join(ROOT, 'amazon-player-preload.js');

const SECTIONS = [
  { id: 'installMediaSessionHijack', from: 'embedded-player-kit' },
  { id: 'applyMediaSessionMirror', from: 'embedded-player-kit' },
];

const PRETTIER_OPTS = { parser: 'babel', singleQuote: true, printWidth: 100 };

function fail(msg) {
  console.error(`build-amazon-preload: ${msg}`);
  process.exit(1);
}

async function sectionTexts() {
  const prettier = require('prettier');
  const out = [];
  for (const section of SECTIONS) {
    let fn;
    try {
      fn = require(path.join(ROOT, section.from))[section.id];
    } catch (error) {
      fail(`loading ${section.id} from ${section.from}.js failed: ${error.message}`);
    }
    if (typeof fn !== 'function') {
      fail(`${section.from}.js no longer exports ${section.id} — did it move? Update SECTIONS.`);
    }
    // Upstream holds the copy under its declaration form; toString() emits the
    // declaration back verbatim (same name preserved). prettier canonicalizes.
    const formatted = await prettier.format(fn.toString(), PRETTIER_OPTS);
    out.push({ ...section, text: formatted.trimEnd() });
  }
  return out;
}

const BEGIN = (id) => `// GENERATED-BEGIN ${id}`;
const END = (id) => `// GENERATED-END ${id}`;

async function expectedContents() {
  const sections = await sectionTexts();
  if (!fs.existsSync(PRELOAD_PATH)) {
    fail(`${path.relative(ROOT, PRELOAD_PATH)} missing — it is the tracked skeleton the sections are written into; restore it`);
  }
  let src = fs.readFileSync(PRELOAD_PATH, 'utf8');
  for (const section of sections) {
    const begin = src.indexOf(BEGIN(section.id));
    const end = src.indexOf(END(section.id));
    if (begin === -1 || end === -1 || end < begin) {
      fail(`GENERATED-BEGIN/END markers for ${section.id} missing or mis-ordered in ${path.relative(ROOT, PRELOAD_PATH)} — restore them`);
    }
    const head = src.slice(0, src.indexOf('\n', begin) + 1);
    const tail = src.slice(end);
    src = head + section.text + '\n' + tail;
  }
  return src;
}

function driftReport(existing, expected) {
  const mismatches = [];
  for (const section of SECTIONS) {
    const b = existing.indexOf(BEGIN(section.id));
    const e = existing.indexOf(END(section.id));
    const b2 = expected.indexOf(BEGIN(section.id));
    const e2 = expected.indexOf(END(section.id));
    if (b === -1 || e === -1 || b2 === -1 || e2 === -1) {
      mismatches.push(`${section.id} (markers missing)`);
      continue;
    }
    if (existing.slice(b, e) !== expected.slice(b2, e2)) mismatches.push(section.id);
  }
  return mismatches;
}

async function runWrite() {
  const expected = await expectedContents();
  const existing = fs.readFileSync(PRELOAD_PATH, 'utf8');
  if (existing !== expected) {
    fs.writeFileSync(PRELOAD_PATH, expected);
    console.log(`✅ ${path.relative(ROOT, PRELOAD_PATH)} regenerated (${SECTIONS.map((s) => s.id).join(', ')})`);
  } else {
    console.log(`✅ ${path.relative(ROOT, PRELOAD_PATH)} already in sync`);
  }
}

async function runCheck() {
  const expected = await expectedContents();
  const existing = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const mismatches = driftReport(existing, expected);
  if (mismatches.length > 0) {
    console.error(`❌ amazon-player-preload.js drifted in: ${mismatches.join(', ')}`);
    console.error(`   regenerate with: node scripts/build-amazon-preload.js`);
    process.exit(1);
  }
  console.log(`✅ amazon-player-preload.js matches amazon-music-logic.js + embedded-player-kit.js`);
}

const mode = process.argv.slice(2).includes('--check') ? 'check' : 'write';
(mode === 'check' ? runCheck() : runWrite()).catch((error) => fail(error.message));
