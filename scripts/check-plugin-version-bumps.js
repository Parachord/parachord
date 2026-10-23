#!/usr/bin/env node
// @ts-check
// CI gate (parachord#1099): replaces build-axes' local "content changed but
// manifest.version didn't" warning. That warning compared against the
// on-disk plugins/*.axe — meaningless once the artifacts are untracked
// generated files (a fresh clone has nothing to compare against, and a
// local run compares against your own last build). A missed bump is silent
// in the field: marketplace clients never re-download the plugin.
//
// Rule: a PR that touches plugins-src/<id>/ in any way must change that
// plugin's manifest.version. New plugins are exempt (no baseline), and so
// is deleting a plugin. The version is read from the nested .manifest
// field — plugins-src/<id>/manifest.json is the .axe shell minus its
// implementation.
//
// Usage: node scripts/check-plugin-version-bumps.js [baseRef]
//   baseRef defaults to origin/main (CI passes FETCH_HEAD after a
//   `git fetch origin $GITHUB_BASE_REF --depth=1`). The diff is a direct
//   tree-vs-tree comparison, so no merge-base history is needed.
//
// LOCAL-RUN CAVEAT: with the default baseRef the diff compares against
// origin/main's TIP, so on a branch behind main a plugin version bump that
// LANDED on main looks like your PR's own unbumped edit (false positive).
// git fetch + rebase (or pass your merge-base explicitly) first. In CI
// this can't happen: HEAD is the merge commit against a fresh base fetch.
//
// Exit codes: 0 pass / nothing to check, 1 one or more bumps missing,
// 2 the check itself could not run (bad ref, etc.).

const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const baseRef = process.argv[2] || 'origin/main';

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function readVersionAtRef(ref, id) {
  try {
    // stdio pipe-ignore: a missing path (plugin new in this PR) makes git
    // print a fatal line before the caught throw — keep it out of CI logs.
    const out = execSync(`git show "${ref}:plugins-src/${id}/manifest.json"`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(out);
    return parsed && parsed.manifest && typeof parsed.manifest.version === 'string'
      ? parsed.manifest.version
      : null;
  } catch {
    return null;
  }
}

function readVersionInWorktree(id) {
  const manifestPath = path.join(ROOT, 'plugins-src', id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return parsed && parsed.manifest ? parsed.manifest.version || null : null;
}

function main() {
  let changed;
  try {
    // Two-dot tree diff against the base ref — no merge-base required, so a
    // depth-1 fetch of the base branch in CI is enough.
    changed = sh(`git diff --name-only "${baseRef}" HEAD -- plugins-src`);
  } catch (error) {
    console.error(`version-bump check: cannot diff against ${baseRef}: ${error.message}`);
    process.exit(2);
  }
  if (!changed) {
    console.log('plugins-src/ unchanged — no plugin version check needed');
    return;
  }

  const ids = [
    ...new Set(
      changed
        .split('\n')
        .map((line) => line.split('/')[1])
        .filter(Boolean),
    ),
  ];
  console.log(`plugins-src/ changed for: ${ids.join(', ')}`);

  const failures = [];
  for (const id of ids) {
    const headVersion = readVersionInWorktree(id);
    if (headVersion === null) continue; // plugin deleted in this PR
    const baseVersion = readVersionAtRef(baseRef, id);
    if (baseVersion === null) {
      console.log(`  ${id}: new plugin @ ${headVersion} — exempt from the bump rule`);
      continue;
    }
    if (headVersion === baseVersion) {
      failures.push(
        `plugins-src/${id}/ changed but manifest.version is still ${headVersion} ` +
          `— bump it in plugins-src/${id}/manifest.json so marketplace clients re-download`,
      );
    } else {
      console.log(`  ${id}: ${baseVersion} → ${headVersion} OK`);
    }
  }

  if (failures.length > 0) {
    console.error(failures.map((f) => `\n❌ ${f}`).join(''));
    process.exit(1);
  }
  console.log('plugin version-bump check passed');
}

main();
