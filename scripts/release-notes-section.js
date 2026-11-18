#!/usr/bin/env node
// scripts/release-notes-section.js vX.Y.Z: print one version's section of
// RELEASE_NOTES.md, ready to be a GitHub release's body.
//
// The tag's Build publishes the GitHub release with an auto-generated list of
// PRs as its body. The app's What's New reads the GitHub release body first
// (parseHighlights in main.js: each `##` section's first bullet) and falls back
// to the bundled RELEASE_NOTES.md only when that fails, so after every release
// the body is replaced with this section (CLAUDE.md "Releasing"):
//
//   node scripts/release-notes-section.js v0.9.13 | gh release edit v0.9.13 --notes-file -
//
// Prints everything under `# Parachord vX.Y.Z` up to the next `# Parachord `
// heading, without the heading itself (the release's title is the tag) and
// without a trailing `---`. Exits 1 when the version has no section.

'use strict';

const fs = require('fs');
const path = require('path');

function releaseNotesSection(markdown, version) {
  const v = String(version || '').replace(/^v/, '');
  const lines = String(markdown).split('\n');
  const start = lines.findIndex((l) => l.trim() === `# Parachord v${v}`);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^# Parachord /.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end);
  while (body.length && (!body[body.length - 1].trim() || body[body.length - 1].trim() === '---')) body.pop();
  while (body.length && !body[0].trim()) body.shift();
  return body.join('\n') + '\n';
}

if (require.main === module) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/release-notes-section.js vX.Y.Z');
    process.exit(2);
  }
  const notes = fs.readFileSync(path.join(__dirname, '..', 'RELEASE_NOTES.md'), 'utf8');
  const section = releaseNotesSection(notes, version);
  if (!section) {
    console.error(`No "# Parachord ${version.startsWith('v') ? version : 'v' + version}" section in RELEASE_NOTES.md`);
    process.exit(1);
  }
  process.stdout.write(section);
}

module.exports = { releaseNotesSection };
