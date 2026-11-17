// What a plug-in's manifest shows people: its description and "needs" line
// are the first text in its settings dialog, and each capability becomes a
// chip there. The 2026-11-17 plug-in settings audit
// (docs/plans/2026-11-17-plugin-settings-audit.md, #1498) found developer
// text in them ("resolver", window.achordion.fetchEntityLink) and chips that
// fell back to their code names ("Html5 stream", "Widevine", "Mobile"),
// because nothing checked either.
//
// This test fails on a NEW offender. The ones already there are listed in
// KNOWN_* below; fixing one means deleting its line (the test fails while a
// fixed one is still listed), so the lists only shrink. #1498 step 1 empties
// them.

const fs = require('fs');
const path = require('path');
const { CAPABILITY_LABELS } = require('../../src/renderer/lib/capability-labels');

const PLUGINS = path.join(__dirname, '../../plugins-src');

// Developer text in a description or "needs" line. UI copy never says
// "resolver" (CLAUDE.md "Copy"); code and raw URLs belong in docs.
const DEV_TEXT = [
  [/\bresolvers?\b/i, 'resolver'],
  [/\bwindow\.\w/, 'window.'],
  [/\b\w+\.\w+\(/, 'a code call'],
  [/https?:\/\//, 'a raw URL'],
];

const KNOWN_TEXT = new Set([
  'achordion.description: resolver',
  'achordion.description: window.',
]);

// Capabilities with no label in lib/capability-labels.js (they show as their
// spelled-out code name). Each needs a user-facing label, or hiding from the
// dialog if it isn't something a listener cares about (widevine, mobile,
// html5Stream, playbackTelemetry).
const KNOWN_UNLABELLED = new Set([
  'achordion: playbackTelemetry',
  'amazonmusic: artistImage',
  'amazonmusic: widevine',
  'applemusic: historyMixes',
  'discogs: biography',
  'discogs: artistImages',
  'lastfm: similarUsers',
  'listenbrainz: historyMixes',
  'listenbrainz: similarUsers',
  'listenbrainz: listeningHistory',
  'subsonic: mobile',
  'subsonic: html5Stream',
  'subsonic: artistImage',
  'wikipedia: biography',
  'wikipedia: artistImages',
]);

function manifests() {
  return fs.readdirSync(PLUGINS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PLUGINS, d.name, 'manifest.json')))
    .map((d) => [d.name, JSON.parse(fs.readFileSync(path.join(PLUGINS, d.name, 'manifest.json'), 'utf8'))]);
}

function textOffenders() {
  const out = [];
  for (const [id, m] of manifests()) {
    const meta = m.manifest || m;
    for (const field of ['description', 'requirement']) {
      const v = meta[field];
      if (typeof v !== 'string') continue;
      for (const [re, why] of DEV_TEXT) if (re.test(v)) out.push(`${id}.${field}: ${why}`);
    }
  }
  return out;
}

function unlabelled() {
  const out = [];
  for (const [id, m] of manifests()) {
    for (const [cap, on] of Object.entries(m.capabilities || {})) {
      if (on && !CAPABILITY_LABELS[cap]) out.push(`${id}: ${cap}`);
    }
  }
  return out;
}

test('no new developer text in a plug-in description or "needs" line', () => {
  const now = textOffenders();
  expect(now.filter((o) => !KNOWN_TEXT.has(o))).toEqual([]);
  // A fixed one comes off the list.
  expect([...KNOWN_TEXT].filter((o) => !now.includes(o))).toEqual([]);
});

test('every capability a plug-in declares has a label (no new code names as chips)', () => {
  const now = unlabelled();
  expect(now.filter((o) => !KNOWN_UNLABELLED.has(o))).toEqual([]);
  expect([...KNOWN_UNLABELLED].filter((o) => !now.includes(o))).toEqual([]);
});
