// What a plug-in's manifest shows people: its description and "needs" line
// are the first text in its settings dialog, and each capability becomes a
// chip there. The 2026-11-17 plug-in settings audit
// (docs/plans/2026-11-17-plugin-settings-audit.md, #1498) found developer
// text in them ("resolver", window.achordion.fetchEntityLink) and chips that
// fell back to their code names ("Html5 stream", "Widevine", "Mobile"),
// because nothing checked either.
//
// The known lists started with today's offenders and only shrink; #1498
// step 1 rewrote the descriptions and labelled or hid every capability, so
// they're empty. Keep them empty: fix new text, and give a new capability a
// label in lib/capability-labels.js or add it to HIDDEN there if it's
// internal.

const fs = require('fs');
const path = require('path');
const { CAPABILITY_LABELS, HIDDEN_CAPABILITIES } = require('../../src/renderer/lib/capability-labels');

const PLUGINS = path.join(__dirname, '../../plugins-src');

// Developer text in a description or "needs" line. UI copy never says
// "resolver" (CLAUDE.md "Copy"); code and raw URLs belong in docs.
const DEV_TEXT = [
  [/\bresolvers?\b/i, 'resolver'],
  [/\bwindow\.\w/, 'window.'],
  [/\b\w+\.\w+\(/, 'a code call'],
  [/https?:\/\//, 'a raw URL'],
];

const KNOWN_TEXT = new Set([]);

// Capabilities with no label in lib/capability-labels.js (they show as their
// spelled-out code name). Each needs a user-facing label, or hiding from the
// dialog if it isn't something a listener cares about (widevine, mobile,
// html5Stream, playbackTelemetry).
const KNOWN_UNLABELLED = new Set([]);

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
      if (on && !CAPABILITY_LABELS[cap] && !HIDDEN_CAPABILITIES.has(cap)) out.push(`${id}: ${cap}`);
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

test('every capability a plug-in declares has a label or is hidden (no code names as chips)', () => {
  const now = unlabelled();
  expect(now.filter((o) => !KNOWN_UNLABELLED.has(o))).toEqual([]);
  expect([...KNOWN_UNLABELLED].filter((o) => !now.includes(o))).toEqual([]);
});
