#!/usr/bin/env node
// scripts/build-axes.js — the source-of-truth pipeline for bundled .axe plugins.
//
// Direction (one way only):
//
//   plugins-src/<id>/manifest.json       ─┐ the .axe minus its implementation
//   plugins-src/<id>/implementation.js    ─┤ real module: module.exports = { search: fn, ... }
//   plugins-src/<id>/build.json   (opt)  ─┘ generator flags (see below)
//                     │
//                     ▼  node scripts/build-axes.js
//       plugins/<id>.axe                  (wire format — UNCHANGED; what the
//                                         renderer AND the mobile runtime load)
//       app.js FALLBACK_RESOLVERS entry   (compact one-line copy, replaced in place)
//       marketplace-manifest.json         (entry version sync)
//
// Modes:
//   (default)      write all three artifacts for every plugins-src plugin
//   --check        verify only — byte-compare everything, exit 1 with a report
//   --import       plugins/<id>.axe → plugins-src/<id>/ for plugins not yet
//                  migrated, and for absorbing a reverse-sync community edit
//                  of an .axe. Prettifies the imported source by default
//                  (readable source is the point); --no-prettify imports the
//                  strings verbatim (byte-stable, but single-line blobs stay
//                  single-line blobs).
//   --plugin <id>  restrict any mode to one plugin
//
// Review flow: PRs are reviewed on plugins-src/*.js (normal code diffs). The
// .axe is a generated artifact — verify it with `node scripts/build-axes.js
// --check` instead of reading 4KB JSON string lines. Jest runs the same check
// on every PR (tests/plugins/axes-drift.test.js).
//
// Version bumps: edit manifest.version in plugins-src/<id>/manifest.json, then
// run the writer. It syncs the marketplace entry version and warns when .axe
// content changed without a version bump (marketplace clients won't re-download
// until the version moves). marketplace-manifest.json's other entry fields
// (category, tags, downloadUrl, capabilities, ...) are editorial and
// hand-maintained; a missing entry is an error — add it by hand first.
//
// Reverse-sync (a community edit landing in plugins/<id>.axe via
// .github/workflows/reverse-sync.yml): --check FAILS until `--import --plugin
// <id>` absorbs the edit into plugins-src. Do not hand-edit the .axe to make
// the check pass — import, review the plugins-src diff, then regenerate.
//
// build.json flags:
//   es5: true — transpile implementation.js through esbuild --target=es5
//   before serializing, for engine-portable plugins the mobile runtime also
//   evaluates (the mobile note in parachord-mobile loads these same strings).
//   Requires esbuild installed (the renderer bundler brings it).
//
// Why functions are serialized with String(fn): the .axe materializes each
// implementation entry with `new Function('return ' + src)()` in
// resolver-loader.js, so functions are fully isolated — no shared scope. That
// is also why implementation.js exports plain functions and nothing else.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'plugins-src');
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const APP_PATH = path.join(ROOT, 'app.js');
const MARKETPLACE_PATH = path.join(ROOT, 'marketplace-manifest.json');

const FALLBACK_START = 'const FALLBACK_RESOLVERS = [';

const args = process.argv.slice(2);
const MODE = args.includes('--check') ? 'check' : args.includes('--import') ? 'import' : 'write';
const pluginFlagIdx = args.indexOf('--plugin');
const ONLY = pluginFlagIdx !== -1 ? args[pluginFlagIdx + 1] : null;
const PRETTIFY = !args.includes('--no-prettify');

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Source discovery
// ---------------------------------------------------------------------------

function listSourcePlugins() {
  if (!fs.existsSync(SRC_DIR)) return [];
  return fs
    .readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(SRC_DIR, name, 'manifest.json')))
    .sort();
}

function listAxePlugins() {
  return fs
    .readdirSync(PLUGINS_DIR)
    .filter((f) => f.endsWith('.axe'))
    .map((f) => f.replace(/\.axe$/, ''))
    .sort();
}

// ---------------------------------------------------------------------------
// plugins-src → .axe object
// ---------------------------------------------------------------------------

function loadModule(filePath) {
  delete require.cache[require.resolve(filePath)];
  // eslint-disable-next-line global-require
  return require(filePath);
}

function buildAxe(id) {
  const dir = path.join(SRC_DIR, id);
  const manifestJson = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifestJson.implementation !== undefined) {
    fail(`plugins-src/${id}/manifest.json must not carry an "implementation" key — implementations live in implementation.js`);
  }
  const manifestId = manifestJson.manifest && manifestJson.manifest.id;
  if (manifestId !== id) {
    fail(`plugins-src/${id}/manifest.json: manifest.id is ${JSON.stringify(manifestId)}, expected "${id}"`);
  }

  const implPath = path.join(dir, 'implementation.js');
  let exportsBy = {};
  if (fs.existsSync(implPath)) {
    const buildFlagsPath = path.join(dir, 'build.json');
    const buildFlags = fs.existsSync(buildFlagsPath)
      ? JSON.parse(fs.readFileSync(buildFlagsPath, 'utf8'))
      : {};
    if (buildFlags.es5) {
      // Transpile the whole module before require() so String(fn) yields ES5 text.
      let esbuild;
      try {
        // eslint-disable-next-line global-require
        esbuild = require('esbuild');
      } catch (e) {
        fail(`plugins-src/${id} is flagged es5 but esbuild is not installed — npm install --save-dev esbuild`);
      }
      const transpiled = esbuild.transformSync(fs.readFileSync(implPath, 'utf8'), {
        target: 'es5',
        loader: 'js',
      }).code;
      const tmp = path.join(require('os').tmpdir(), `axes-es5-${id}-${process.pid}-${Date.now()}.js`);
      fs.writeFileSync(tmp, transpiled);
      try {
        exportsBy = loadModule(tmp);
      } finally {
        fs.unlinkSync(tmp);
      }
    } else {
      exportsBy = loadModule(implPath);
    }
  }

  const impl = {};
  for (const [key, value] of Object.entries(exportsBy)) {
    if (typeof value !== 'function') {
      fail(`plugins-src/${id}/implementation.js: export "${key}" must be a function (got ${typeof value}) — the .axe materializes every implementation entry as a function`);
    }
    impl[key] = String(value);
  }

  const axe = { ...manifestJson };
  if (Object.keys(impl).length > 0) axe.implementation = impl;
  return axe;
}

// Content resolvers (resolve/stream/search) need a FALLBACK_RESOLVERS entry so
// the app can boot them when the disk copy is missing; meta-services do not.
// This exactly matches the current membership of the block.
function isContentResolver(axe) {
  const c = axe.capabilities || {};
  return !!(c.resolve || c.stream || c.search);
}

// ---------------------------------------------------------------------------
// app.js FALLBACK_RESOLVERS block
// ---------------------------------------------------------------------------

function readFallbackBlock() {
  const lines = fs.readFileSync(APP_PATH, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(FALLBACK_START));
  if (start === -1) fail(`app.js: "${FALLBACK_START}" not found`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('];'));
  if (end === -1) fail('app.js: FALLBACK_RESOLVERS closing "];" not found');
  const entryLines = new Map();
  for (let i = start + 1; i < end; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    let parsed;
    try {
      parsed = JSON.parse(t.replace(/,$/, ''));
    } catch (e) {
      fail(`app.js FALLBACK_RESOLVERS line ${i + 1} does not parse — the block must stay one compact entry per line`);
    }
    const id = parsed.manifest && parsed.manifest.id;
    if (!id) fail(`app.js FALLBACK_RESOLVERS line ${i + 1} has no manifest.id`);
    entryLines.set(id, i);
  }
  return { lines, start, end, entryLines };
}

function fallbackLineFor(axe) {
  return '  ' + JSON.stringify(axe) + ',';
}

function applyFallbackEdits(block, edits) {
  // block = { lines, start, end, entryLines } from readFallbackBlock(). Replaces
  // entries in place; appends new ids before the closing bracket (all entries
  // carry trailing commas, matching the block's existing convention).
  for (const edit of edits) {
    const idx = block.entryLines.get(edit.id);
    if (idx !== undefined) {
      block.lines[idx] = edit.expectedLine;
    } else {
      block.lines.splice(block.end, 0, edit.expectedLine);
      block.end += 1;
      block.entryLines.set(edit.id, block.end - 1);
      console.log(`➕ app.js FALLBACK_RESOLVERS: added ${edit.id} entry`);
    }
  }
}

// ---------------------------------------------------------------------------
// marketplace-manifest.json
// ---------------------------------------------------------------------------

function readMarketplace() {
  return JSON.parse(fs.readFileSync(MARKETPLACE_PATH, 'utf8'));
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function runImport() {
  const candidates = listAxePlugins().filter((id) => !ONLY || id === ONLY);
  let migrated = 0;
  for (const id of candidates) {
    const dir = path.join(SRC_DIR, id);
    if (fs.existsSync(path.join(dir, 'manifest.json'))) {
      console.log(`↩︎  skip ${id}: plugins-src/${id} already exists (delete it first to re-import)`);
      continue;
    }
    const axe = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, id + '.axe'), 'utf8'));
    const { implementation, ...rest } = axe;

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(rest, null, 2) + '\n');

    const entries = Object.entries(implementation || {});
    const parts = [
      `// Source of truth for plugins/${id}.axe${axe.manifest ? ' v' + axe.manifest.version : ''}.`,
      '// Imported from the .axe by `node scripts/build-axes.js --import`.',
      '// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.',
      '// The functions materialize fully isolated (resolver-loader.js uses',
      '// new Function) — no shared scope between them; helpers must be embedded per function.',
      'module.exports = {',
    ];
    for (const [key, fnText] of entries) parts.push(`  ${key}: ${fnText},`);
    parts.push('};');
    let implSource = parts.join('\n') + '\n';
    if (entries.length === 0) {
      implSource = implSource.replace(
        'module.exports = {\n};',
        'module.exports = {};\n// (no capabilities require an implementation — add functions here when one does)'
      );
    }
    if (PRETTIFY && entries.length > 0) {
      // eslint-disable-next-line global-require
      const prettier = require('prettier');
      implSource = await prettier.format(implSource, { parser: 'babel', singleQuote: true, printWidth: 100 });
    }
    fs.writeFileSync(path.join(dir, 'implementation.js'), implSource);
    migrated += 1;
    console.log(`✅ imported plugins-src/${id}/ (${entries.length} implementation fn${entries.length === 1 ? '' : 's'}${PRETTIFY && entries.length ? ', prettified' : ''})`);
  }
  if (migrated > 0) {
    console.log(`\nNext: node scripts/build-axes.js${ONLY ? ' --plugin ' + ONLY : ''} regenerates plugins/, app.js and marketplace-manifest.json from the new sources.`);
    console.log('Expect .axe churn only where prettify reformatted single-line strings — all whitespace/quote-level, verified by --check and the jest suite.');
  } else {
    console.log('Nothing to import.');
  }
}

function collectExpected() {
  const sourceIds = listSourcePlugins().filter((id) => !ONLY || id === ONLY);
  const plans = [];
  for (const id of sourceIds) {
    const axe = buildAxe(id);
    const plan = { id, axe, axeText: JSON.stringify(axe, null, 2) + '\n' };
    if (isContentResolver(axe)) plan.fallbackLine = fallbackLineFor(axe);
    plans.push(plan);
  }
  return plans;
}

function runWrite() {
  const plans = collectExpected();
  const fallbackEdits = [];
  const marketplace = readMarketplace();
  let marketplaceDirty = false;

  for (const plan of plans) {
    const axePath = path.join(PLUGINS_DIR, plan.id + '.axe');
    const existing = fs.existsSync(axePath) ? fs.readFileSync(axePath, 'utf8') : null;
    if (existing !== plan.axeText) {
      if (existing !== null) {
        const oldVersion = JSON.parse(existing).manifest.version;
        if (oldVersion === plan.axe.manifest.version) {
          console.warn(`⚠️  plugins/${plan.id}.axe content changed but manifest.version is still ${plan.axe.manifest.version} — marketplace clients will not re-download until the version moves`);
        }
      }
      fs.writeFileSync(axePath, plan.axeText);
      console.log(`✅ plugins/${plan.id}.axe v${plan.axe.manifest.version} written`);
    }
    if (plan.fallbackLine) fallbackEdits.push({ id: plan.id, expectedLine: plan.fallbackLine });

    const entry = (marketplace.plugins || []).find((p) => p.id === plan.id);
    if (!entry) {
      fail(`marketplace-manifest.json has no "${plan.id}" entry — add one by hand first (copy a sibling entry's shape; category/tags/downloadUrl are editorial)`);
    }
    if (entry.version !== plan.axe.manifest.version) {
      entry.version = plan.axe.manifest.version;
      marketplaceDirty = true;
      console.log(`✅ marketplace-manifest.json: ${plan.id} → v${plan.axe.manifest.version}`);
    }
  }

  if (fallbackEdits.length > 0) {
    const block = readFallbackBlock();
    const before = block.lines.join('\n');
    applyFallbackEdits(block, fallbackEdits);
    const after = block.lines.join('\n');
    if (after !== before) {
      fs.writeFileSync(APP_PATH, after);
      console.log(`✅ app.js FALLBACK_RESOLVERS entries regenerated (${fallbackEdits.map((e) => e.id).join(', ')})`);
    }
  }

  if (marketplaceDirty) {
    fs.writeFileSync(MARKETPLACE_PATH, JSON.stringify(marketplace, null, 2) + '\n');
  }
  if (plans.length === 0) console.log('No plugins-src plugins found — nothing to do.');
}

function runCheck() {
  const plans = collectExpected();
  const failures = [];

  const sourceIds = new Set(plans.map((p) => p.id));
  for (const id of listAxePlugins()) {
    if (!sourceIds.has(id) && (!ONLY || id === ONLY)) {
      failures.push(`plugins/${id}.axe has no plugins-src/${id}/ — run: node scripts/build-axes.js --import --plugin ${id}`);
    }
  }

  const marketplace = readMarketplace();
  let block = null;
  for (const plan of plans) {
    const axePath = path.join(PLUGINS_DIR, plan.id + '.axe');
    if (!fs.existsSync(axePath)) {
      failures.push(`plugins/${plan.id}.axe missing — run the writer`);
    } else if (fs.readFileSync(axePath, 'utf8') !== plan.axeText) {
      failures.push(`plugins/${plan.id}.axe does not match plugins-src/${plan.id}/ — run: node scripts/build-axes.js --plugin ${plan.id}`);
    }

    if (plan.fallbackLine) {
      block = block || readFallbackBlock();
      const idx = block.entryLines.get(plan.id);
      if (idx === undefined) {
        failures.push(`app.js FALLBACK_RESOLVERS has no "${plan.id}" entry — run the writer`);
      } else if (block.lines[idx] !== plan.fallbackLine) {
        failures.push(`app.js FALLBACK_RESOLVERS "${plan.id}" entry is stale — run: node scripts/build-axes.js --plugin ${plan.id}`);
      }
    }

    const entry = (marketplace.plugins || []).find((p) => p.id === plan.id);
    if (!entry) {
      failures.push(`marketplace-manifest.json has no "${plan.id}" entry`);
    } else if (entry.version !== plan.axe.manifest.version) {
      failures.push(`marketplace-manifest.json ${plan.id} version ${entry.version} ≠ .axe ${plan.axe.manifest.version} — run the writer`);
    }
  }

  if (failures.length > 0) {
    console.error('Plugin source drift:\n- ' + failures.join('\n- '));
    console.error('\nplugins-src is the source of truth. If an .axe was edited directly (reverse-sync), absorb it first: node scripts/build-axes.js --import --plugin <id>');
    process.exit(1);
  }
  console.log(`✅ all ${plans.length} plugins-src plugins match plugins/, app.js FALLBACK_RESOLVERS and marketplace-manifest.json`);
}

(async () => {
  if (MODE === 'import') await runImport();
  else if (MODE === 'check') runCheck();
  else runWrite();
})();
